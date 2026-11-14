import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Buffer } from 'buffer';
import EngineHost, { EngineHandle } from '../engines/EngineHost';
import { INSIGHTS_HTML } from '../insights/insightsHtml';
import { summarizeText, TextSummary } from '../insights/summarize';
import {
  AGG_LABEL,
  Agg,
  ChartSpec,
  ChartType,
  Dataset,
  RawTable,
  autoCharts,
  autoKpis,
  autoDateUnit,
  dataHighlights,
  newId,
  toDataset,
} from '../insights/analyze';
import { dashboardHtml } from '../insights/dashboardHtml';
import { PickedFile, baseName, readBytes, saveOutput, shareFile } from '../lib/files';
import { extOf, MIME } from '../lib/incoming';
import { reportError } from '../lib/crash';
import { countSuccessAndMaybeAskForReview } from '../lib/rating';
import { Theme, useStyles, useTheme } from '../theme';

const WebView = RNWebView as unknown as ComponentType<{
  source: { html: string };
  originWhitelist: string[];
  onMessage?: (e: { nativeEvent: { data: string } }) => void;
  style?: object;
}>;

type Extracted = { pages: number; text: string; headings: string[]; tables: RawTable[] };
type Kind = 'pdf' | 'docx' | 'xlsx' | 'xls' | 'csv';
const KIND_ICON: Record<Kind, string> = { pdf: '📄', docx: '📝', xlsx: '📊', xls: '📊', csv: '📊' };

export async function pickForInsights(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: [MIME.pdf, MIME.docx, MIME.xlsx, MIME.xls, 'text/csv', 'text/comma-separated-values', 'application/csv', 'text/plain'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined };
}

type Props = { file: PickedFile | null; onBack: () => void; onOpenTool: (id: string) => void };

export default function InsightsScreen({ file: initial, onBack, onOpenTool }: Props) {
  const styles = useStyles(makeStyles);
  const { theme } = useTheme();
  const engine = useRef<EngineHandle>(null);
  const [file, setFile] = useState<PickedFile | null>(initial);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [data, setData] = useState<Extracted | null>(null);
  const [tab, setTab] = useState<'summary' | 'dashboard'>('summary');
  const [dsIndex, setDsIndex] = useState(0);
  const [charts, setCharts] = useState<Record<number, ChartSpec[]>>({});
  const [editing, setEditing] = useState<{ spec: ChartSpec; isNew: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);

  const kind = (file ? (extOf(file.name) || kindFromMime(file.mimeType)) : '') as Kind | '';
  const isSheet = kind === 'xlsx' || kind === 'xls' || kind === 'csv';

  // pick a file if we were opened without one
  useEffect(() => {
    if (initial) return;
    pickForInsights()
      .then((f) => (f ? setFile(f) : onBack()))
      .catch((e) => setError(e?.message ?? String(e)));
  }, []);

  useEffect(() => {
    if (!file) return;
    if (!kind) {
      setError('Choose a PDF, Word (.docx), Excel (.xlsx / .xls) or CSV file.');
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const b64 = Buffer.from(await readBytes(file.uri)).toString('base64');
        const fn = kind === 'pdf' ? '__pdf' : kind === 'docx' ? '__docx' : kind === 'csv' ? '__csv' : '__xlsx';
        const r = await engine.current!.call(fn, b64, [], (p) => alive && setProgress(p));
        if (!alive) return;
        const d = r.data as Extracted;
        setData(d);
        if (isSheet) setTab('dashboard');
      } catch (e: any) {
        if (!alive) return;
        if (e?.message === 'PASSWORD') setError('This PDF is password-protected. Unlock it first with “Unlock PDF”, then try again.');
        else {
          reportError(e, 'insights');
          setError(e?.message ?? String(e));
        }
      } finally {
        alive && setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file]);

  const datasets = useMemo(
    () => (data?.tables ?? []).map(toDataset).filter((d): d is Dataset => !!d && d.columns.length >= 1 && d.rows.length >= 2),
    [data],
  );
  const summary: TextSummary | null = useMemo(
    () => (data && !isSheet && data.text.trim() ? summarizeText(data.text) : null),
    [data],
  );
  const ds = datasets[dsIndex];
  const dsCharts = ds ? (charts[dsIndex] ?? autoCharts(ds)) : [];
  useEffect(() => {
    if (ds && !charts[dsIndex]) setCharts((c) => ({ ...c, [dsIndex]: autoCharts(ds) }));
  }, [ds, dsIndex]);

  const setDsCharts = (list: ChartSpec[]) => setCharts((c) => ({ ...c, [dsIndex]: list }));
  const title = file ? baseName(file.name) : '';
  const subtitle = ds ? `${ds.name} · ${ds.rows.length.toLocaleString('en-US')} rows` : '';

  const html = useMemo(
    () => (ds ? dashboardHtml(ds, autoKpis(ds), dsCharts, { dark: theme.dark, title, subtitle }) : ''),
    [ds, dsCharts, theme.dark],
  );

  function onDashMessage(e: { nativeEvent: { data: string } }) {
    const m = JSON.parse(e.nativeEvent.data) as { a: 'edit' | 'remove'; id: string };
    const spec = dsCharts.find((c) => c.id === m.id);
    if (!spec) return;
    if (m.a === 'edit') setEditing({ spec, isNew: false });
    else setDsCharts(dsCharts.filter((c) => c.id !== m.id));
  }

  function addChart() {
    if (!ds) return;
    const by = ds.columns.findIndex((c) => c.type === 'category' || c.type === 'date');
    const value = ds.columns.findIndex((c) => c.type === 'number');
    setEditing({ spec: { id: newId(), type: 'bar', by: by >= 0 ? by : 0, value, agg: value >= 0 ? 'sum' : 'count' }, isNew: true });
  }

  async function exportPdf(kindOut: 'dashboard' | 'summary') {
    if (!file) return;
    setExporting(true);
    try {
      const h =
        kindOut === 'dashboard' && ds
          ? dashboardHtml(ds, autoKpis(ds), dsCharts, { dark: false, print: true, title, subtitle })
          : summaryHtml(title, summary, isSheet ? datasets.flatMap(dataHighlights) : [], data?.headings ?? []);
      const { uri } = await Print.printToFileAsync({ html: h, width: 595, height: 842 });
      const tmp = new File(uri);
      const out = saveOutput(await tmp.bytes(), `${title}_${kindOut}.pdf`);
      tmp.delete();
      countSuccessAndMaybeAskForReview().catch(() => {});
      Alert.alert('Saved ✅', `${title}_${kindOut}.pdf`, [
        { text: 'OK' },
        { text: 'Share / Save to…', onPress: () => shareFile(out, 'application/pdf').catch(() => {}) },
      ]);
    } catch (e: any) {
      reportError(e, 'insights-export');
      Alert.alert('Could not create the PDF', e?.message ?? String(e));
    } finally {
      setExporting(false);
    }
  }

  function copySummary() {
    const lines = [
      title,
      '',
      ...(summary?.keyPoints.map((p, i) => `${i + 1}. ${p}`) ?? []),
      ...(isSheet ? datasets.flatMap(dataHighlights).map((l) => `• ${l}`) : []),
    ];
    Clipboard.setStringAsync(lines.join('\n')).then(() => Alert.alert('Copied ✅', 'Summary copied to the clipboard.'));
  }

  const aiSoon = () =>
    Alert.alert(
      '✨ AI summary — coming soon',
      'AI summary is under construction 🚧 and will be added in a future update.\n\nملخص الذكاء الاصطناعي تحت الإنشاء وهيتضاف في تحديث قريب.\n\nFor now, the offline summary works without internet and your file never leaves your phone.',
    );

  // ---------------- render ----------------
  const header = (
    <View style={styles.top}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.back}>‹</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.topTitle} numberOfLines={1}>
          {kind ? KIND_ICON[kind] : '📊'} {file?.name ?? 'Summary & Dashboard'}
        </Text>
        <Text style={styles.topSub}>Summary & Dashboard · ملخص وداشبورد</Text>
      </View>
    </View>
  );

  if (error || loading || !data) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          {error ? (
            <>
              <Text style={styles.err}>{error}</Text>
              <Pressable style={styles.primary} onPress={() => pickForInsights().then((f) => f && setFile(f))}>
                <Text style={styles.primaryText}>Choose another file</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={theme.accent} />
              <Text style={styles.loading}>
                {file ? `Reading the file… ${progress > 0 ? Math.round(progress * 100) + '%' : ''}` : 'Choose a file…'}
              </Text>
              <Text style={styles.hint}>🔒 Offline — your file stays on your phone</Text>
            </>
          )}
        </View>
        <EngineHost ref={engine} html={INSIGHTS_HTML} />
      </View>
    );
  }

  const scanned = kind === 'pdf' && (summary?.words ?? 0) < 25 && !datasets.length;

  return (
    <View style={styles.root}>
      {header}
      <View style={styles.tabs}>
        {(['summary', 'dashboard'] as const).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
              {t === 'summary' ? '🧾 Summary · ملخص' : `📊 Dashboard${datasets.length ? ` · ${datasets.length}` : ''}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'summary' ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Pressable style={styles.ai} onPress={aiSoon}>
            <Text style={styles.aiIcon}>✨</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.aiTitle}>AI summary · ملخص بالذكاء الاصطناعي</Text>
              <Text style={styles.aiSub}>Under construction 🚧 · تحت الإنشاء</Text>
            </View>
            <View style={styles.soon}>
              <Text style={styles.soonText}>Soon · قريبًا</Text>
            </View>
          </Pressable>

          <View style={styles.chips}>
            {kind !== 'csv' && !isSheet && <Chip label={`${data.pages} page${data.pages === 1 ? '' : 's'}`} />}
            {summary && <Chip label={`${summary.words.toLocaleString('en-US')} words`} />}
            {summary && <Chip label={`~${summary.readMinutes} min read`} />}
            {summary && <Chip label={summary.language === 'ar' ? 'Arabic' : summary.language === 'en' ? 'English' : 'Arabic + English'} />}
            {isSheet && <Chip label={`${datasets.length} sheet${datasets.length === 1 ? '' : 's'}`} />}
            {!isSheet && datasets.length > 0 && <Chip label={`${datasets.length} table${datasets.length === 1 ? '' : 's'} → Dashboard`} />}
          </View>

          {scanned ? (
            <View style={styles.card}>
              <Text style={styles.h}>No text found</Text>
              <Text style={styles.p}>
                This PDF looks scanned (pages are photos). Run OCR first to turn the photos into text, then open the result here.
              </Text>
              <Pressable style={styles.primary} onPress={() => onOpenTool('ocr-pdf')}>
                <Text style={styles.primaryText}>Open OCR · استخراج النص</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.h}>{isSheet ? 'Highlights · أهم الأرقام' : 'Key points · أهم النقاط'}</Text>
                {(isSheet ? datasets.flatMap((d) => dataHighlights(d).map((l) => `${datasets.length > 1 ? `[${d.name}] ` : ''}${l}`)) : summary?.keyPoints ?? []).map(
                  (p, i) => (
                    <View key={i} style={styles.point}>
                      <Text style={styles.num}>{i + 1}</Text>
                      <Text style={styles.pointText}>{p}</Text>
                    </View>
                  ),
                )}
                {!isSheet && !summary?.keyPoints.length && <Text style={styles.p}>The text is too short to summarize.</Text>}
              </View>

              {!!summary?.keywords.length && (
                <View style={styles.card}>
                  <Text style={styles.h}>Main topics · المواضيع الأساسية</Text>
                  <View style={styles.chips}>
                    {summary.keywords.map((k) => (
                      <Chip key={k.word} label={`${k.word} · ${k.count}`} />
                    ))}
                  </View>
                </View>
              )}

              {!isSheet && data.headings.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.h}>Sections · الأقسام</Text>
                  {data.headings.slice(0, 15).map((h, i) => (
                    <Text key={i} style={styles.section}>
                      • {h}
                    </Text>
                  ))}
                </View>
              )}
              <Text style={styles.hint}>Offline summary: picks the most important sentences from the file itself.</Text>
            </>
          )}

          {!scanned && (
            <View style={styles.row}>
              <Pressable style={styles.secondary} onPress={copySummary}>
                <Text style={styles.secondaryText}>📋 Copy</Text>
              </Pressable>
              <Pressable style={[styles.primary, { flex: 1.4, marginTop: 0 }]} onPress={() => exportPdf('summary')} disabled={exporting}>
                <Text style={styles.primaryText}>{exporting ? 'Saving…' : '⬇ Download PDF'}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      ) : !ds ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>📊</Text>
          <Text style={styles.h}>No tables found</Text>
          <Text style={[styles.p, { textAlign: 'center' }]}>
            Dashboards are made from tables. Open an Excel or CSV file, or a Word/PDF file that has a table with numbers.
          </Text>
          <Pressable style={styles.primary} onPress={() => pickForInsights().then((f) => f && (setData(null), setCharts({}), setDsIndex(0), setFile(f)))}>
            <Text style={styles.primaryText}>Open an Excel file</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {datasets.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dsBar} contentContainerStyle={{ gap: 6, paddingHorizontal: 12 }}>
              {datasets.map((d, i) => (
                <Pressable key={i} style={[styles.dsChip, i === dsIndex && styles.dsChipOn]} onPress={() => setDsIndex(i)}>
                  <Text style={[styles.dsText, i === dsIndex && { color: '#fff' }]} numberOfLines={1}>
                    {d.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <View style={styles.toolbar}>
            <Pressable style={styles.tb} onPress={addChart}>
              <Text style={styles.tbText}>＋ Add chart</Text>
            </Pressable>
            <Pressable style={styles.tb} onPress={() => setDsCharts(autoCharts(ds))}>
              <Text style={styles.tbText}>✨ Auto</Text>
            </Pressable>
            <Pressable style={[styles.tb, { backgroundColor: theme.accent, borderColor: theme.accent }]} onPress={() => exportPdf('dashboard')} disabled={exporting}>
              <Text style={[styles.tbText, { color: '#fff' }]}>{exporting ? 'Saving…' : '⬇ PDF'}</Text>
            </Pressable>
          </View>
          <Text style={styles.tip}>Tap ✎ on a chart to choose what it shows · اضغط ✎ لتغيير الرسم</Text>
          <WebView key={`${dsIndex}`} source={{ html }} originWhitelist={['*']} onMessage={onDashMessage} style={{ flex: 1, backgroundColor: theme.bg }} />
        </View>
      )}

      {editing && ds && (
        <ChartEditor
          ds={ds}
          spec={editing.spec}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSave={(s) => {
            setDsCharts(editing.isNew ? [...dsCharts, s] : dsCharts.map((c) => (c.id === s.id ? s : c)));
            setEditing(null);
          }}
          onDelete={() => {
            setDsCharts(dsCharts.filter((c) => c.id !== editing.spec.id));
            setEditing(null);
          }}
        />
      )}
      <EngineHost ref={engine} html={INSIGHTS_HTML} />
    </View>
  );
}

function kindFromMime(m?: string): string {
  if (!m) return '';
  return Object.entries(MIME).find(([, v]) => v === m)?.[0] ?? (/csv/.test(m) ? 'csv' : '');
}

function Chip({ label }: { label: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

// ---------------- chart editor ----------------
const TYPE_LABEL: Record<ChartType, string> = { bar: '📊 Bar', line: '📈 Line', pie: '🥧 Pie' };
const COL_ICON = { number: '#', date: '📅', category: '🏷️', text: 'Aa' } as const;

function ChartEditor({
  ds,
  spec,
  isNew,
  onSave,
  onCancel,
  onDelete,
}: {
  ds: Dataset;
  spec: ChartSpec;
  isNew: boolean;
  onSave: (s: ChartSpec) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [s, setS] = useState<ChartSpec>(spec);
  const groupCols = ds.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.type !== 'number' || c.distinct <= 30);
  const numCols = ds.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.type === 'number');
  const byDate = ds.columns[s.by]?.type === 'date';

  const Opt = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <Pressable style={[styles.opt, on && styles.optOn]} onPress={onPress}>
      <Text style={[styles.optText, on && { color: '#fff' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.sheetBg}>
        <Pressable style={{ flex: 1 }} onPress={onCancel} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{isNew ? 'Add chart · رسم جديد' : 'Edit chart · تعديل الرسم'}</Text>
          <ScrollView style={{ maxHeight: 460 }}>
            <Text style={styles.label}>Chart type</Text>
            <View style={styles.opts}>
              {(['bar', 'line', 'pie'] as ChartType[]).map((t) => (
                <Opt key={t} on={s.type === t} label={TYPE_LABEL[t]} onPress={() => setS({ ...s, type: t })} />
              ))}
            </View>

            <Text style={styles.label}>Group by · حسب</Text>
            <View style={styles.opts}>
              {groupCols.map(({ c, i }) => (
                <Opt
                  key={i}
                  on={s.by === i}
                  label={`${COL_ICON[c.type]} ${c.name}`}
                  onPress={() => setS({ ...s, by: i, dateUnit: c.type === 'date' ? autoDateUnit(ds, i) : undefined })}
                />
              ))}
            </View>

            {byDate && (
              <>
                <Text style={styles.label}>Period</Text>
                <View style={styles.opts}>
                  {(['day', 'month', 'year'] as const).map((u) => (
                    <Opt key={u} on={(s.dateUnit ?? autoDateUnit(ds, s.by)) === u} label={u[0].toUpperCase() + u.slice(1)} onPress={() => setS({ ...s, dateUnit: u })} />
                  ))}
                </View>
              </>
            )}

            <Text style={styles.label}>Value · القيمة</Text>
            <View style={styles.opts}>
              <Opt on={s.value < 0} label="Count rows · عدد" onPress={() => setS({ ...s, value: -1, agg: 'count' })} />
              {numCols.map(({ c, i }) => (
                <Opt key={i} on={s.value === i} label={`# ${c.name}`} onPress={() => setS({ ...s, value: i, agg: s.agg === 'count' ? 'sum' : s.agg })} />
              ))}
            </View>

            {s.value >= 0 && (
              <>
                <Text style={styles.label}>Calculation</Text>
                <View style={styles.opts}>
                  {(['sum', 'avg', 'max', 'min'] as Agg[]).map((a) => (
                    <Opt key={a} on={s.agg === a} label={AGG_LABEL[a]} onPress={() => setS({ ...s, agg: a })} />
                  ))}
                </View>
              </>
            )}

            {!byDate && (
              <>
                <Text style={styles.label}>Show top</Text>
                <View style={styles.opts}>
                  {[5, 10, 20].map((n) => (
                    <Opt key={n} on={(s.top ?? (s.type === 'pie' ? 6 : 10)) === n} label={String(n)} onPress={() => setS({ ...s, top: n })} />
                  ))}
                </View>
              </>
            )}
          </ScrollView>
          <View style={styles.row}>
            {!isNew && (
              <Pressable style={styles.secondary} onPress={onDelete}>
                <Text style={[styles.secondaryText, { color: '#E5322D' }]}>Delete</Text>
              </Pressable>
            )}
            <Pressable style={styles.secondary} onPress={onCancel}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.primary, { flex: 1.4, marginTop: 0 }]} onPress={() => onSave(s)}>
              <Text style={styles.primaryText}>{isNew ? 'Add' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------- printable summary ----------------
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
function summaryHtml(title: string, s: TextSummary | null, highlights: string[], headings: string[]): string {
  const points = s?.keyPoints.length ? s.keyPoints : highlights;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{size:A4;margin:18mm 16mm}body{font:12pt/1.6 -apple-system,Roboto,"Noto Sans Arabic",sans-serif;color:#1B1E28}
h1{font-size:20pt;margin:0 0 4pt}.meta{color:#7A808C;font-size:10pt;margin-bottom:14pt}h2{font-size:13pt;margin:16pt 0 6pt;color:#1F8FE5}
li{margin:0 0 7pt}.kw{display:inline-block;background:#EEF4FB;border-radius:10pt;padding:2pt 8pt;margin:0 4pt 4pt 0;font-size:10pt}
.foot{color:#9AA0AC;font-size:9pt;margin-top:24pt}</style></head><body>
<h1 dir="auto">${esc(title)}</h1>
<div class="meta">${s ? `${s.words.toLocaleString('en-US')} words · ~${s.readMinutes} min read` : ''}</div>
<h2>Key points</h2><ol>${points.map((p) => `<li dir="auto">${esc(p)}</li>`).join('')}</ol>
${s?.keywords.length ? `<h2>Main topics</h2><div>${s.keywords.map((k) => `<span class="kw" dir="auto">${esc(k.word)}</span>`).join('')}</div>` : ''}
${headings.length && s ? `<h2>Sections</h2><ul>${headings.slice(0, 20).map((h) => `<li dir="auto">${esc(h)}</li>`).join('')}</ul>` : ''}
<div class="foot">Offline summary made with PDF Toolkit</div></body></html>`;
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
    back: { fontSize: 34, color: t.text, marginTop: -6, width: 22 },
    topTitle: { fontSize: 16, fontWeight: '800', color: t.text },
    topSub: { fontSize: 12, color: t.muted },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
    loading: { color: t.text, fontSize: 15, marginTop: 8 },
    err: { color: '#E5322D', fontSize: 15, textAlign: 'center' },
    hint: { color: t.muted, fontSize: 12, textAlign: 'center', marginTop: 6 },
    tabs: { flexDirection: 'row', marginHorizontal: 14, backgroundColor: t.bg2, borderRadius: 12, padding: 3 },
    tab: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
    tabOn: { backgroundColor: t.card },
    tabText: { color: t.muted, fontWeight: '700', fontSize: 13.5 },
    tabTextOn: { color: t.text },
    scroll: { padding: 14, gap: 12, paddingBottom: 40 },
    ai: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.border, borderStyle: 'dashed' },
    aiIcon: { fontSize: 24 },
    aiTitle: { color: t.text, fontWeight: '800', fontSize: 14.5 },
    aiSub: { color: t.muted, fontSize: 12, marginTop: 2 },
    soon: { backgroundColor: '#F2A20C', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    soonText: { color: '#fff', fontWeight: '800', fontSize: 11.5 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    chipText: { color: t.sub, fontSize: 12.5, fontWeight: '600' },
    card: { backgroundColor: t.card, borderRadius: 16, padding: 14, gap: 8, borderWidth: 1, borderColor: t.border },
    h: { color: t.text, fontWeight: '800', fontSize: 15.5 },
    p: { color: t.sub, fontSize: 14, lineHeight: 20 },
    point: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    num: { backgroundColor: t.accent, color: '#fff', width: 22, height: 22, borderRadius: 11, textAlign: 'center', lineHeight: 22, fontSize: 12, fontWeight: '800', overflow: 'hidden' },
    pointText: { flex: 1, color: t.text, fontSize: 14.5, lineHeight: 21, writingDirection: 'auto' },
    section: { color: t.sub, fontSize: 13.5 },
    row: { flexDirection: 'row', gap: 10, marginTop: 6 },
    primary: { flex: 1, backgroundColor: t.accent, borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 10, paddingHorizontal: 18 },
    primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    secondary: { flex: 1, backgroundColor: t.card2, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
    secondaryText: { color: t.text, fontWeight: '700', fontSize: 15 },
    dsBar: { flexGrow: 0, marginTop: 10 },
    dsChip: { borderRadius: 999, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, paddingHorizontal: 12, paddingVertical: 6, maxWidth: 180 },
    dsChipOn: { backgroundColor: t.accent, borderColor: t.accent },
    dsText: { color: t.text, fontWeight: '600', fontSize: 13 },
    toolbar: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10 },
    tb: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, paddingVertical: 9, alignItems: 'center' },
    tbText: { color: t.text, fontWeight: '700', fontSize: 13.5 },
    tip: { color: t.muted, fontSize: 11.5, textAlign: 'center', marginTop: 6 },
    sheetBg: { flex: 1, backgroundColor: t.overlay },
    sheet: { backgroundColor: t.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 30 },
    sheetTitle: { color: t.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
    label: { color: t.muted, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', marginTop: 12, marginBottom: 6 },
    opts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    opt: { borderRadius: 999, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: t.bg, maxWidth: '100%' },
    optOn: { backgroundColor: t.accent, borderColor: t.accent },
    optText: { color: t.text, fontSize: 13, fontWeight: '600' },
  });
