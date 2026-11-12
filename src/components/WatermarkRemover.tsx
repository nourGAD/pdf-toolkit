import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import PdfThumbnail from 'react-native-pdf-thumbnail';
import { readBytes, saveTemp } from '../lib/files';
import { WatermarkCandidate, detectWatermarks, findText, removeWatermarks } from '../lib/unwatermark';
import { Theme, useStyles, useTheme } from '../theme';

export type UnwatermarkChoice = { ids: string[]; text: string };

/** Finds removable watermarks, lets the user pick, and shows a before/after preview. */
export default function WatermarkRemover({
  fileUri,
  value,
  onChange,
  color,
}: {
  fileUri: string;
  value: UnwatermarkChoice;
  onChange: (v: UnwatermarkChoice) => void;
  color: string;
}) {
  const styles = useStyles(makeStyles);
  const { theme } = useTheme();
  const { width: screenW } = useWindowDimensions();
  const bytes = useRef<Uint8Array | null>(null);
  const [cands, setCands] = useState<WatermarkCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [textHits, setTextHits] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ before: string; after: string; page: number } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // analyse once per file
  useEffect(() => {
    let alive = true;
    setCands(null);
    setError(null);
    setPreview(null);
    (async () => {
      try {
        bytes.current = await readBytes(fileUri);
        const c = await detectWatermarks(bytes.current);
        if (!alive) return;
        setCands(c);
        // pre-select everything that clearly looks like a watermark
        onChange({ ids: c.filter((x) => x.kind !== 'ocg' || /water|draft|confidential|stamp/i.test(x.label)).map((x) => x.id), text: '' });
      } catch (e: any) {
        if (alive) setError(e?.message ?? String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [fileUri]);

  // search typed text (debounced)
  useEffect(() => {
    setTextHits(null);
    if (!value.text.trim() || !bytes.current) return;
    const t = setTimeout(() => findText(bytes.current!, value.text).then((p) => setTextHits(p.length)), 400);
    return () => clearTimeout(t);
  }, [value.text]);

  // before/after preview of the first affected page
  useEffect(() => {
    setPreview(null);
    if (!bytes.current || (!value.ids.length && !value.text.trim())) return;
    const pages = (cands ?? []).filter((c) => value.ids.includes(c.id)).flatMap((c) => c.pages);
    const pg = pages.length ? Math.min(...pages) : 0;
    let alive = true;
    const t = setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const one = await removeWatermarks(bytes.current!, value.ids, value.text, pg);
        const tmp = saveTemp(one, 'preview.pdf');
        const [before, after] = await Promise.all([
          PdfThumbnail.generate(fileUri, pg, { quality: 70, maxWidth: 700, maxHeight: 1000 }),
          PdfThumbnail.generate(tmp, 0, { quality: 70, maxWidth: 700, maxHeight: 1000 }),
        ]);
        if (alive) setPreview({ before: before.uri, after: after.uri, page: pg });
      } catch {
        /* preview is best-effort */
      } finally {
        if (alive) setPreviewBusy(false);
      }
    }, 500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [cands, value.ids.join('|'), value.text]);

  const toggle = (id: string) =>
    onChange({ ...value, ids: value.ids.includes(id) ? value.ids.filter((x) => x !== id) : [...value.ids, id] });

  if (error) return <Text style={styles.err}>Could not read this PDF: {error}</Text>;
  if (!cands)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color} />
        <Text style={styles.muted}>Looking for watermarks… · بيدوّر على العلامات المائية</Text>
      </View>
    );

  const half = (Math.min(screenW, 600) - 40 - 12) / 2;

  return (
    <View>
      {cands.length ? (
        <>
          <Text style={styles.label}>Found {cands.length} · لقينا {cands.length}</Text>
          {cands.map((c) => {
            const on = value.ids.includes(c.id);
            return (
              <Pressable key={c.id} onPress={() => toggle(c.id)} style={[styles.cand, on && { borderColor: color, backgroundColor: color + '12' }]}>
                <View style={[styles.box, on && { backgroundColor: color, borderColor: color }]}>{on && <Text style={styles.tick}>✓</Text>}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.candTitle}>{c.label}</Text>
                  <Text style={styles.muted}>
                    on {c.pages.length} page{c.pages.length > 1 ? 's' : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </>
      ) : (
        <View style={styles.none}>
          <Text style={styles.noneTitle}>No removable watermark found automatically</Text>
          <Text style={styles.muted}>
            If the watermark is text, type it below. Watermarks that are part of a scanned image or flattened into the page
            can't be removed.
          </Text>
        </View>
      )}

      <Text style={[styles.label, { marginTop: 14 }]}>Remove a specific text · امسح كلمة معينة</Text>
      <TextInput
        style={styles.input}
        value={value.text}
        onChangeText={(text) => onChange({ ...value, text })}
        placeholder="e.g. CONFIDENTIAL, DRAFT, SAMPLE"
        placeholderTextColor={theme.muted}
        autoCapitalize="characters"
      />
      {value.text.trim() !== '' && (
        <Text style={[styles.muted, { marginTop: 6 }]}>
          {textHits == null
            ? 'Searching…'
            : textHits
              ? `Found on ${textHits} page${textHits > 1 ? 's' : ''}`
              : 'Not found as removable text (it may be part of an image, or use a special font).'}
        </Text>
      )}

      {(value.ids.length > 0 || value.text.trim() !== '') && (
        <>
          <Text style={[styles.label, { marginTop: 16 }]}>
            Preview {preview ? `· page ${preview.page + 1}` : ''}
          </Text>
          {previewBusy && !preview ? (
            <ActivityIndicator color={color} style={{ marginVertical: 20 }} />
          ) : (
            preview && (
              <View style={styles.compare}>
                <View style={{ width: half }}>
                  <Image source={{ uri: preview.before }} style={[styles.thumb, { width: half, height: half * 1.4 }]} resizeMode="contain" />
                  <Text style={styles.cap}>Before</Text>
                </View>
                <View style={{ width: half }}>
                  <Image source={{ uri: preview.after }} style={[styles.thumb, { width: half, height: half * 1.4 }]} resizeMode="contain" />
                  <Text style={[styles.cap, { color }]}>After</Text>
                </View>
              </View>
            )
          )}
        </>
      )}
      <Text style={styles.legal}>Use only on documents you own or have permission to edit.</Text>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    loading: { alignItems: 'center', padding: 24, gap: 10 },
    err: { color: '#C0392B' },
    label: { fontSize: 13, fontWeight: '700', color: t.sub, marginBottom: 8 },
    muted: { fontSize: 12, color: t.muted, lineHeight: 17 },
    cand: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderColor: t.border, borderRadius: 14, padding: 12, marginBottom: 8, backgroundColor: t.card },
    box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
    tick: { color: '#fff', fontWeight: '900' },
    candTitle: { fontSize: 15, fontWeight: '700', color: t.text },
    none: { borderWidth: 1, borderColor: t.border, borderRadius: 14, padding: 14, backgroundColor: t.card, gap: 6 },
    noneTitle: { fontWeight: '800', color: t.text },
    input: { backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.text },
    compare: { flexDirection: 'row', gap: 12 },
    thumb: { backgroundColor: '#fff', borderRadius: 8 },
    cap: { textAlign: 'center', fontWeight: '800', marginTop: 6, color: t.sub },
    legal: { fontSize: 11, color: t.faint, marginTop: 14, textAlign: 'center' },
  });
