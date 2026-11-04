import React, { useRef, useState } from 'react';
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
import { scanDocuments, rotateImage } from '../lib/images';
import { Tool, ToolOptions, ToolResult } from '../tools';
import PagePicker, { toRange } from '../components/PagePicker';
import CropModal from '../components/CropModal';
import ConfirmSheet from '../components/ConfirmSheet';
import ResultPreview from '../components/ResultPreview';

type Props = { tool: Tool; onBack: () => void; onRead: (f: PickedFile) => void };

export default function ToolScreen({ tool, onBack, onRead }: Props) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [opts, setOpts] = useState<ToolOptions>({ range: '', angle: 90, text: 'CONFIDENTIAL' });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const isImages = tool.input === 'images';
  const multi = tool.input !== 'pdf';
  const minFiles = tool.input === 'pdfs' ? 2 : 1;
  const needPages = tool.pages?.required && selected.size === 0;
  const canRun = files.length >= minFiles && !needPages && !busy;

  // ---------- input ----------
  async function add(source: 'pdf' | 'gallery' | 'scan') {
    try {
      const picked =
        source === 'scan' ? await scanDocuments() : source === 'gallery' ? await pickImages() : await pickPdfs(multi);
      if (!picked.length) return;
      setResult(null);
      setSelected(new Set());
      setFiles((prev) => (multi ? [...prev, ...picked] : picked));
    } catch (e: any) {
      Alert.alert(source === 'scan' ? 'Scanner not available' : 'Could not open file', e?.message ?? String(e));
    }
  }

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
  const runOpts = (): ToolOptions => ({ ...opts, range: toRange(selected) });

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
    setBusy(true);
    try {
      const r = await tool.run(files, runOpts());
      setResult(r);
      setTimeout(() => scroll.current?.scrollTo({ y: 0, animated: true }), 50);
    } catch (e: any) {
      Alert.alert('Something went wrong', e?.message ?? String(e));
    } finally {
      setBusy(false);
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
          ? 'Add images first'
          : 'Select a PDF first'
      : needPages
        ? 'Tap the pages to delete'
        : `Continue · ${tool.title}`;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
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
            <Step n={1} label={isImages ? 'Add pages' : multi ? 'Choose files' : 'Choose a PDF'} />
            {isImages ? (
              <View style={styles.row}>
                <BigBtn icon="📷" label="Scan with camera" sub="Auto crop" color={tool.color} onPress={() => add('scan')} />
                <BigBtn icon="🖼️" label="From gallery" sub="Crop after" color={tool.color} onPress={() => add('gallery')} />
              </View>
            ) : (
              <Pressable style={[styles.pick, { borderColor: tool.color }]} onPress={() => add('pdf')}>
                <Text style={[styles.pickText, { color: tool.color }]}>
                  {files.length && multi ? '+ Add more PDFs' : files.length ? '↺ Choose another PDF' : 'Select PDF'}
                </Text>
              </Pressable>
            )}

            {isImages && files.length > 0 && (
              <View style={styles.images}>
                {files.map((f, i) => (
                  <View key={f.uri + i} style={styles.imgCard}>
                    <Image source={{ uri: f.uri }} style={styles.img} resizeMode="cover" />
                    <Text style={styles.imgNo}>{i + 1}</Text>
                    <View style={styles.imgActions}>
                      <Icon label="✂️" onPress={() => setCropIndex(i)} />
                      <Icon label="⟳" onPress={async () => replace(i, await rotateImage(f, 90))} />
                      <Icon label="◀" onPress={() => move(i, -1)} />
                      <Icon label="▶" onPress={() => move(i, 1)} />
                      <Icon label="✕" danger onPress={() => remove(i)} />
                    </View>
                  </View>
                ))}
              </View>
            )}
            {isImages && files.length > 0 && (
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
                <Step n={2} label={tool.pages ? 'Choose pages' : 'Options'} />

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

                {tool.fields?.includes('text') && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={styles.label}>Watermark text (English)</Text>
                    <TextInput
                      style={styles.input}
                      value={opts.text}
                      onChangeText={(text) => setOpts((o) => ({ ...o, text }))}
                      autoCapitalize="characters"
                    />
                  </View>
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
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{ctaLabel}</Text>}
          </Pressable>
        </View>
      )}

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
        image={cropIndex != null ? files[cropIndex] : null}
        onCancel={() => setCropIndex(null)}
        onDone={(img) => {
          if (cropIndex != null) replace(cropIndex, img);
          setCropIndex(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function Step({ n, label }: { n: number; label: string }) {
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
  return (
    <Pressable onPress={p.onPress} style={[styles.big, { borderColor: p.color }]}>
      <Text style={{ fontSize: 30 }}>{p.icon}</Text>
      <Text style={[styles.bigLabel, { color: p.color }]}>{p.label}</Text>
      <Text style={styles.bigSub}>{p.sub}</Text>
    </Pressable>
  );
}

function Icon({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.iconBtn}>
      <Text style={[styles.iconText, danger && { color: '#C0392B' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 120 },
  back: { fontSize: 17, color: '#1F8FE5', marginBottom: 12 },
  h1: { fontSize: 26, fontWeight: '800', color: '#1B1E28' },
  sub: { fontSize: 15, color: '#5B6170', marginTop: 2 },
  desc: { fontSize: 14, color: '#8A8F9C', marginTop: 8, lineHeight: 20 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22, marginBottom: 10 },
  stepN: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#1B1E28', alignItems: 'center', justifyContent: 'center' },
  stepNText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  stepLabel: { fontSize: 16, fontWeight: '700', color: '#1B1E28' },
  row: { flexDirection: 'row', gap: 10 },
  pick: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 24,
    alignItems: 'center',
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  pickText: { fontSize: 17, fontWeight: '700' },
  big: { flex: 1, borderWidth: 2, borderRadius: 16, paddingVertical: 18, alignItems: 'center', backgroundColor: '#fff' },
  bigLabel: { fontSize: 15, fontWeight: '800', marginTop: 6 },
  bigSub: { fontSize: 12, color: '#8A8F9C', marginTop: 2 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  imgCard: { width: '47%', backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden' },
  img: { width: '100%', aspectRatio: 0.75, backgroundColor: '#EEF0F4' },
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
  imgActions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8 },
  iconBtn: { paddingHorizontal: 4 },
  iconText: { fontSize: 17, color: '#5B6170' },
  tip: { fontSize: 12, color: '#8A8F9C', marginTop: 8 },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  fileName: { flex: 1, fontSize: 14, color: '#1B1E28' },
  ctrls: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#5B6170', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E1E4EC',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  chip: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: '#E1E4EC', borderRadius: 999, paddingVertical: 10, backgroundColor: '#fff' },
  chipText: { fontSize: 15, fontWeight: '700', color: '#1B1E28' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    paddingBottom: 18,
    backgroundColor: 'rgba(246,247,251,0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#D5D8E0',
  },
  cta: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
