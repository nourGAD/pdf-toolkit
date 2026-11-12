import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PickedFile, pickImages, pickPdfs, shareFile } from '../lib/files';
import { COMPRESS_LEVELS, CompressLevel, fileSize, formatBytes, scanDocuments, rotateImage } from '../lib/images';
import { Tool, ToolOptions, ToolResult } from '../tools';
import PagePicker, { toRange } from '../components/PagePicker';
import CropModal from '../components/CropModal';
import ConfirmSheet from '../components/ConfirmSheet';
import ResultPreview from '../components/ResultPreview';
import WatermarkOptions, { DEFAULT_WATERMARK } from '../components/WatermarkOptions';
import PdfEditor from '../components/PdfEditor';
import { reportError } from '../lib/crash';
import { countSuccessAndMaybeAskForReview } from '../lib/rating';
import WatermarkRemover from '../components/WatermarkRemover';
import PageReorder from '../components/PageReorder';
import FormFiller from '../components/FormFiller';
import EngineHost, { EngineHandle } from '../engines/EngineHost';
import TextRenderer, { TextRendererHandle } from '../edit/TextRenderer';
import { EngineName, LANG_LABEL, OcrLang } from '../tools';
import { PDF_COMPRESS, PdfCompressLevel } from '../lib/compress';
import { pickDocx } from '../lib/files';
import { Theme, useStyles, useTheme } from '../theme';

type Props = { tool: Tool; onBack: () => void; onRead: (f: PickedFile) => void; autoScan?: boolean };

export default function ToolScreen({ tool, onBack, onRead, autoScan }: Props) {
  const styles = useStyles(makeStyles);
  const { theme } = useTheme();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [opts, setOpts] = useState<ToolOptions>({
    range: '',
    angle: 90,
    wm: DEFAULT_WATERMARK,
    wmImage: null,
    compress: 'medium',
    edits: [],
    unwm: { ids: [], text: '' },
    ocrLang: 'ara+eng',
    password: '',
    order: [],
    orderChanged: false,
    form: { values: {}, flatten: false, fields: 0 },
    pdfCompress: 'medium',
    ctx: null as any, // filled in when the tool runs
  });
  const [password2, setPassword2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [progress, setProgress] = useState('');
  const engineRefs = useRef<Partial<Record<EngineName, EngineHandle | null>>>({});
  const textRenderer = useRef<TextRendererHandle>(null);
  // heavy engine pages are loaded only for the tools that need them (the OCR one is ~10 MB)
  const engineHtml = useRef<Partial<Record<EngineName, string>>>({});
  for (const e of tool.engines ?? []) {
    if (!engineHtml.current[e])
      engineHtml.current[e] =
        e === 'ocr'
          ? require('../ocr/ocrHtml').OCR_HTML
          : e === 'codec'
            ? require('../codec/codecHtml').CODEC_HTML
            : require('../convert/convertHtml').CONVERT_HTML;
  }
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  // indexes waiting to be cropped (gallery photos open the crop editor one after another)
  const [cropQueue, setCropQueue] = useState<number[]>([]);
  const [cropTotal, setCropTotal] = useState(0);
  const cropIndex = cropQueue.length ? cropQueue[0] : null;
  const nextCrop = () => setCropQueue((q) => q.slice(1));
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const isImages = tool.input === 'images';
  const scanMode = isImages && tool.imageSource !== 'gallery'; // scanner + crop tools vs plain photo picking
  const multi = tool.input === 'pdfs' || tool.input === 'images';
  const minFiles = tool.input === 'pdfs' ? 2 : 1;
  const needPages = tool.pages?.required && selected.size === 0;
  const needText = !!tool.fields?.includes('watermark') && (!opts.wm.text.trim() || !opts.wmImage);
  const needEdits = !!tool.fields?.includes('edit') && opts.edits.length === 0;
  const needUnwm = !!tool.fields?.includes('unwatermark') && !opts.unwm.ids.length && !opts.unwm.text.trim();
  const pwField = !!tool.fields?.includes('password');
  const needPw =
    pwField &&
    (tool.passwordMode === 'protect' ? opts.password.length < 4 || opts.password !== password2 : opts.password.length === 0);
  const needOrder = !!tool.fields?.includes('reorder') && !opts.orderChanged;
  const needForm = !!tool.fields?.includes('form') && opts.form.fields === 0;
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const canRun = files.length >= minFiles && !needPages && !needText && !needEdits && !needUnwm && !needPw && !needOrder && !needForm && !busy;

  // ---------- input ----------
  async function add(source: 'pdf' | 'gallery' | 'scan') {
    try {
      let picked: PickedFile[];
      let cropAfter = source === 'gallery' && scanMode;
      if (source === 'scan') {
        const r = await scanDocuments();
        picked = r.files;
        cropAfter = r.needsCrop; // plain-camera fallback → let the user set the 4 corners
      } else
        picked =
          source === 'gallery'
            ? await pickImages(scanMode ? 0.9 : 1)
            : tool.input === 'docx'
              ? await pickDocx()
              : await pickPdfs(multi);
      if (!picked.length) return;
      setResult(null);
      setSelected(new Set());
      setOpts((o) => ({ ...o, edits: [], unwm: { ids: [], text: '' }, order: [], orderChanged: false, form: { ...o.form, values: {}, fields: 0 } }));
      const startAt = multi ? files.length : 0;
      setFiles((prev) => (multi ? [...prev, ...picked] : picked));
      if (cropAfter) {
        const q = picked.map((_, k) => startAt + k);
        setCropQueue(q);
        setCropTotal(q.length);
      }
    } catch (e: any) {
      Alert.alert(source === 'scan' ? 'Scanner not available' : 'Could not open file', e?.message ?? String(e));
    }
  }

  // opened from the home-screen widget → go straight to the scanner
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoScan && !autoStarted.current) {
      autoStarted.current = true;
      add('scan');
    }
  }, [autoScan]);

  const move = (i: number, dir: -1 | 1) =>
    setFiles((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setFiles((p) => p.filter((_, k) => k !== i));
  const replace = (i: number, f: PickedFile) => setFiles((p) => p.map((x, k) => (k === i ? f : x)));

  // ---------- run ----------
  const runOpts = (): ToolOptions => ({
    ...opts,
    range: toRange(selected),
    ctx: {
      engine: (name) => {
        const e = engineRefs.current[name];
        if (!e) throw new Error('Engine not ready — please try again');
        return e.call;
      },
      renderText: (text) => textRenderer.current?.render({ text, color: '#111111', bold: false }) ?? Promise.resolve(null),
      progress: setProgress,
    },
  });

  function confirmLines(): string[] {
    const lines = [tool.summary(files, runOpts(), selected.size)];
    if (multi) files.slice(0, 6).forEach((f, i) => lines.push(`${i + 1}. ${f.name}`));
    if (multi && files.length > 6) lines.push(`… and ${files.length - 6} more`);
    if (!multi && files[0]) lines.push(`File: ${files[0].name}`);
    if (tool.pages && selected.size) lines.push(`Pages: ${toRange(selected)}`);
    return lines;
  }

  async function run() {
    setConfirming(false);
    setProgress('');
    setBusy(true);
    try {
      const r = await tool.run(files, runOpts());
      setResult(r);
      countSuccessAndMaybeAskForReview();
      setTimeout(() => scroll.current?.scrollTo({ y: 0, animated: true }), 50);
    } catch (e: any) {
      reportError(e, `tool:${tool.id}`);
      Alert.alert('Something went wrong', e?.message ?? String(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  function startOver() {
    setResult(null);
    setFiles([]);
    setSelected(new Set());
  }

  const ctaLabel = busy
    ? 'Working…'
    : files.length < minFiles
      ? tool.input === 'pdfs'
        ? 'Select at least 2 PDFs'
        : isImages
          ? scanMode
            ? 'Add images first'
            : 'Select photos first'
          : tool.input === 'docx'
            ? 'Select a Word file first'
            : 'Select a PDF first'
      : needPages
        ? 'Tap the pages to delete'
        : needText
          ? 'Type the watermark text'
          : needEdits
            ? tool.editMode === 'sign'
              ? 'Add your signature to a page'
              : 'Add text or an image to a page'
            : needUnwm
              ? 'Choose what to remove'
              : needPw
                ? tool.passwordMode === 'protect'
                  ? opts.password.length < 4
                    ? 'Choose a password (4+ characters)'
                    : 'Type the same password twice'
                  : 'Type the password'
                : needOrder
                  ? 'Move a page to change the order'
                  : needForm
                    ? 'This PDF has no fields to fill'
        : `Continue · ${tool.title}`;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled" scrollEnabled={scrollEnabled}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.h1}>
          {tool.icon} {tool.title}
        </Text>
        <Text style={styles.sub}>{tool.titleAr}</Text>

        {result ? (
          <ResultPreview
            result={result}
            color={tool.color}
            onShare={() => shareFile(result.uri, result.mimeType).catch((e) => Alert.alert('Share failed', e.message))}
            onOpenReader={() => onRead({ uri: result.uri, name: result.label, mimeType: result.mimeType })}
            onAgain={startOver}
          />
        ) : (
          <>
            <Text style={styles.desc}>{tool.description}</Text>

            {/* STEP 1 — input */}
            <Step n={1} label={isImages ? 'Add pages' : multi ? 'Choose files' : tool.input === 'docx' ? 'Choose a Word file' : 'Choose a PDF'} />
            {isImages && !scanMode ? (
              <Pressable style={[styles.pick, { borderColor: tool.color }]} onPress={() => add('gallery')}>
                <Text style={[styles.pickText, { color: tool.color }]}>
                  {files.length ? '+ Add more photos' : '🖼️ Select photos'}
                </Text>
              </Pressable>
            ) : isImages ? (
              <View style={styles.row}>
                <BigBtn icon="📷" label="Scan with camera" sub="Auto-detects edges" color={tool.color} onPress={() => add('scan')} />
                <BigBtn icon="🖼️" label="From gallery" sub="Pick + crop corners" color={tool.color} onPress={() => add('gallery')} />
              </View>
            ) : (
              <Pressable style={[styles.pick, { borderColor: tool.color }]} onPress={() => add('pdf')}>
                <Text style={[styles.pickText, { color: tool.color }]}>
                  {tool.input === 'docx'
                    ? files.length
                      ? '↺ Choose another Word file'
                      : 'Select Word (.docx)'
                    : files.length && multi
                      ? '+ Add more PDFs'
                      : files.length
                        ? '↺ Choose another PDF'
                        : 'Select PDF'}
                </Text>
              </Pressable>
            )}

            {isImages && files.length > 0 && (
              <View style={styles.images}>
                {files.map((f, i) => (
                  <View key={f.uri + i} style={styles.imgCard}>
                    <Image source={{ uri: f.uri }} style={styles.img} resizeMode="cover" />
                    <Text style={styles.imgNo}>{i + 1}</Text>
                    {scanMode ? (
                      <View style={styles.imgActions}>
                        <Icon label="✂️" onPress={() => (setCropTotal(1), setCropQueue([i]))} />
                        <Icon label="⟳" onPress={async () => replace(i, await rotateImage(f, 90))} />
                        <Icon label="◀" onPress={() => move(i, -1)} />
                        <Icon label="▶" onPress={() => move(i, 1)} />
                        <Icon label="✕" danger onPress={() => remove(i)} />
                      </View>
                    ) : (
                      <View style={styles.imgActions}>
                        <Text style={styles.imgSize}>{formatBytes(fileSize(f.uri))}</Text>
                        <Icon label="✕" danger onPress={() => remove(i)} />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
            {scanMode && files.length > 0 && (
              <Text style={styles.tip}>✂️ crop · ⟳ rotate · ◀ ▶ change order · ✕ remove</Text>
            )}

            {!isImages &&
              files.map((f, i) => (
                <View key={f.uri + i} style={styles.file}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    📄 {multi ? `${i + 1}. ` : ''}
                    {f.name}
                  </Text>
                  {multi && (
                    <View style={styles.ctrls}>
                      <Icon label="▲" onPress={() => move(i, -1)} />
                      <Icon label="▼" onPress={() => move(i, 1)} />
                      <Icon label="✕" danger onPress={() => remove(i)} />
                    </View>
                  )}
                </View>
              ))}
            {tool.input === 'pdfs' && files.length > 1 && (
              <Text style={styles.tip}>The files will be merged in this order. Use ▲ ▼ to change it.</Text>
            )}

            {/* STEP 2 — options */}
            {files.length >= 1 && (tool.fields?.length || tool.pages) && (
              <>
                <Step
                  n={2}
                  label={
                    tool.pages
                      ? 'Choose pages'
                      : tool.fields?.includes('watermark')
                        ? 'Your watermark'
                        : tool.fields?.includes('compress')
                          ? 'How small?'
                          : tool.fields?.includes('edit')
                            ? tool.editMode === 'sign'
                              ? 'Sign the document'
                              : 'Edit the pages'
                            : tool.fields?.includes('unwatermark')
                              ? 'What to remove'
                              : 'Options'
                  }
                />

                {tool.fields?.includes('angle') && (
                  <View style={[styles.row, { marginBottom: 12 }]}>
                    {([90, 180, 270] as const).map((a) => (
                      <Pressable
                        key={a}
                        onPress={() => setOpts((o) => ({ ...o, angle: a }))}
                        style={[styles.chip, opts.angle === a && { backgroundColor: tool.color, borderColor: tool.color }]}
                      >
                        <Text style={[styles.chipText, opts.angle === a && { color: '#fff' }]}>⟳ {a}°</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {tool.fields?.includes('ocr') && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={styles.label}>Language of the text · لغة الكلام</Text>
                    <View style={styles.row}>
                      {(['ara+eng', 'ara', 'eng'] as OcrLang[]).map((l) => (
                        <Pressable
                          key={l}
                          onPress={() => setOpts((o) => ({ ...o, ocrLang: l }))}
                          style={[styles.chip, opts.ocrLang === l && { backgroundColor: tool.color, borderColor: tool.color }]}
                        >
                          <Text style={[styles.chipText, { fontSize: 13 }, opts.ocrLang === l && { color: '#fff' }]}>{LANG_LABEL[l]}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.tip}>
                      💡 Arabic-only pages: choose “Arabic” for the best result. لو الصفحة عربي بس اختار Arabic.
                    </Text>
                  </View>
                )}

                {tool.fields?.includes('pdfcompress') && (
                  <View style={{ gap: 8 }}>
                    <Text style={styles.tip}>Size now: {formatBytes(fileSize(files[0].uri))} · الحجم الحالي</Text>
                    {(Object.keys(PDF_COMPRESS) as PdfCompressLevel[]).map((k) => {
                      const L = PDF_COMPRESS[k];
                      const on = opts.pdfCompress === k;
                      return (
                        <Pressable
                          key={k}
                          onPress={() => setOpts((o) => ({ ...o, pdfCompress: k }))}
                          style={[styles.level, on && { borderColor: tool.color, backgroundColor: tool.color + '14' }]}
                        >
                          <View style={[styles.radio, on && { borderColor: tool.color }]}>
                            {on && <View style={[styles.radioDot, { backgroundColor: tool.color }]} />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.levelTitle}>
                              {L.label} · {L.labelAr}
                            </Text>
                            <Text style={styles.levelHint}>{L.hint}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {pwField && (
                  <View style={{ gap: 10 }}>
                    <TextInput
                      style={styles.input}
                      value={opts.password}
                      onChangeText={(password) => setOpts((o) => ({ ...o, password }))}
                      placeholder={tool.passwordMode === 'protect' ? 'New password' : 'Password of this PDF'}
                      placeholderTextColor={theme.muted}
                      secureTextEntry={!showPw}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {tool.passwordMode === 'protect' && (
                      <TextInput
                        style={styles.input}
                        value={password2}
                        onChangeText={setPassword2}
                        placeholder="Type it again"
                        placeholderTextColor={theme.muted}
                        secureTextEntry={!showPw}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    )}
                    <Pressable onPress={() => setShowPw((v) => !v)}>
                      <Text style={[styles.tip, { color: tool.color, fontWeight: '700' }]}>{showPw ? '🙈 Hide' : '👁 Show'} password</Text>
                    </Pressable>
                    <Text style={styles.tip}>
                      {tool.passwordMode === 'protect'
                        ? '⚠️ If you forget this password, the file cannot be opened again. لو نسيت الباسورد مش هتعرف تفتح الملف.'
                        : 'This removes the password from a file you are allowed to open. It does not guess passwords.'}
                    </Text>
                  </View>
                )}

                {tool.fields?.includes('reorder') && files[0] && (
                  <PageReorder
                    key={files[0].uri}
                    fileUri={files[0].uri}
                    color={tool.color}
                    onDragging={(d) => setScrollEnabled(!d)}
                    onChange={(order, orderChanged) => setOpts((o) => ({ ...o, order, orderChanged }))}
                  />
                )}

                {tool.fields?.includes('form') && files[0] && (
                  <FormFiller
                    key={files[0].uri}
                    fileUri={files[0].uri}
                    value={opts.form}
                    onChange={(form) => setOpts((o) => ({ ...o, form }))}
                    color={tool.color}
                  />
                )}

                {tool.fields?.includes('compress') && (
                  <View style={{ gap: 8 }}>
                    <Text style={styles.tip}>
                      Total now: {formatBytes(files.reduce((t, f) => t + fileSize(f.uri), 0))} · الحجم الحالي
                    </Text>
                    {(Object.keys(COMPRESS_LEVELS) as CompressLevel[]).map((k) => {
                      const L = COMPRESS_LEVELS[k];
                      const on = opts.compress === k;
                      return (
                        <Pressable
                          key={k}
                          onPress={() => setOpts((o) => ({ ...o, compress: k }))}
                          style={[styles.level, on && { borderColor: tool.color, backgroundColor: tool.color + '14' }]}
                        >
                          <View style={[styles.radio, on && { borderColor: tool.color }]}>
                            {on && <View style={[styles.radioDot, { backgroundColor: tool.color }]} />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.levelTitle}>
                              {L.label} · {L.labelAr}
                            </Text>
                            <Text style={styles.levelHint}>
                              {L.hint} · max {L.maxSide}px, quality {Math.round(L.quality * 100)}%
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {tool.fields?.includes('edit') && files[0] && (
                  <PdfEditor
                    key={files[0].uri}
                    fileUri={files[0].uri}
                    items={opts.edits}
                    onChange={(edits) => setOpts((o) => ({ ...o, edits }))}
                    onDragging={(d) => setScrollEnabled(!d)}
                    color={tool.color}
                    mode={tool.editMode ?? 'edit'}
                  />
                )}

                {tool.fields?.includes('unwatermark') && files[0] && (
                  <WatermarkRemover
                    key={files[0].uri}
                    fileUri={files[0].uri}
                    value={opts.unwm}
                    onChange={(unwm) => setOpts((o) => ({ ...o, unwm }))}
                    color={tool.color}
                  />
                )}

                {tool.fields?.includes('watermark') && files[0] && (
                  <WatermarkOptions
                    fileUri={files[0].uri}
                    value={opts.wm}
                    onChange={(wm) => setOpts((o) => ({ ...o, wm }))}
                    onImage={(wmImage) => setOpts((o) => ({ ...o, wmImage }))}
                    color={tool.color}
                  />
                )}

                {tool.pages && files[0] && (
                  <PagePicker
                    fileUri={files[0].uri}
                    mode={tool.pages.mode}
                    selected={selected}
                    onChange={setSelected}
                    angle={opts.angle}
                    color={tool.color}
                    help={tool.pages.help}
                  />
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* sticky action bar — always visible, no scrolling down to find it */}
      {!result && (
        <View style={styles.bar}>
          <Pressable
            disabled={!canRun}
            onPress={() => setConfirming(true)}
            style={[styles.cta, { backgroundColor: tool.color }, !canRun && { opacity: 0.4 }]}
          >
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color="#fff" />
                {!!progress && <Text style={styles.ctaText}>{progress}</Text>}
              </View>
            ) : (
              <Text style={styles.ctaText}>{ctaLabel}</Text>
            )}
          </Pressable>
        </View>
      )}

      {/* background engines (hidden) */}
      {(tool.engines ?? []).map((e) => (
        <EngineHost key={e} html={engineHtml.current[e]!} ref={(h) => void (engineRefs.current[e] = h)} />
      ))}
      {tool.fields?.includes('form') && <TextRenderer ref={textRenderer} />}

      <ConfirmSheet
        visible={confirming}
        title={tool.title}
        icon={tool.icon}
        color={tool.color}
        lines={confirming ? confirmLines() : []}
        onConfirm={run}
        onCancel={() => setConfirming(false)}
      />
      <CropModal
        image={cropIndex != null ? (files[cropIndex] ?? null) : null}
        index={cropTotal - cropQueue.length}
        total={cropTotal}
        onCancel={nextCrop}
        onDone={(img) => {
          if (cropIndex != null) replace(cropIndex, img);
          nextCrop();
        }}
      />
    </KeyboardAvoidingView>
  );
}

function Step({ n, label }: { n: number; label: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.step}>
      <View style={styles.stepN}>
        <Text style={styles.stepNText}>{n}</Text>
      </View>
      <Text style={styles.stepLabel}>{label}</Text>
    </View>
  );
}

function BigBtn(p: { icon: string; label: string; sub: string; color: string; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={p.onPress} style={[styles.big, { borderColor: p.color }]}>
      <Text style={{ fontSize: 30 }}>{p.icon}</Text>
      <Text style={[styles.bigLabel, { color: p.color }]}>{p.label}</Text>
      <Text style={styles.bigSub}>{p.sub}</Text>
    </Pressable>
  );
}

function Icon({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.iconBtn}>
      <Text style={[styles.iconText, danger && { color: '#C0392B' }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 120 },
  back: { fontSize: 17, color: t.accent, marginBottom: 12 },
  h1: { fontSize: 26, fontWeight: '800', color: t.text },
  sub: { fontSize: 15, color: t.sub, marginTop: 2 },
  desc: { fontSize: 14, color: t.muted, marginTop: 8, lineHeight: 20 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22, marginBottom: 10 },
  stepN: { width: 26, height: 26, borderRadius: 13, backgroundColor: t.text, alignItems: 'center', justifyContent: 'center' },
  stepNText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  stepLabel: { fontSize: 16, fontWeight: '700', color: t.text },
  row: { flexDirection: 'row', gap: 10 },
  pick: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 24,
    alignItems: 'center',
    backgroundColor: t.card,
    marginBottom: 10,
  },
  pickText: { fontSize: 17, fontWeight: '700' },
  big: { flex: 1, borderWidth: 2, borderRadius: 16, paddingVertical: 18, alignItems: 'center', backgroundColor: t.card },
  bigLabel: { fontSize: 15, fontWeight: '800', marginTop: 6 },
  bigSub: { fontSize: 12, color: t.muted, marginTop: 2 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  imgCard: { width: '47%', backgroundColor: t.card, borderRadius: 14, overflow: 'hidden' },
  img: { width: '100%', aspectRatio: 0.75, backgroundColor: t.card2 },
  imgNo: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: '#fff',
    fontWeight: '800',
    paddingHorizontal: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  imgActions: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: 8 },
  imgSize: { flex: 1, fontSize: 13, fontWeight: '700', color: t.sub, paddingLeft: 10 },
  level: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderColor: t.border, borderRadius: 14, padding: 14, backgroundColor: t.card },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  levelTitle: { fontSize: 15, fontWeight: '800', color: t.text },
  levelHint: { fontSize: 12, color: t.muted, marginTop: 2 },
  iconBtn: { paddingHorizontal: 4 },
  iconText: { fontSize: 17, color: t.sub },
  tip: { fontSize: 12, color: t.muted, marginTop: 8 },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  fileName: { flex: 1, fontSize: 14, color: t.text },
  ctrls: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 13, fontWeight: '600', color: t.sub, marginBottom: 6 },
  input: {
    backgroundColor: t.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  chip: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingVertical: 10, backgroundColor: t.card },
  chipText: { fontSize: 15, fontWeight: '700', color: t.text },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    paddingBottom: 18,
    backgroundColor: t.barBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  cta: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
