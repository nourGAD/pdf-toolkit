import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import PdfThumbnail from 'react-native-pdf-thumbnail';
import { Theme, useStyles, useTheme } from '../theme';

export type PageMode = 'select' | 'rotate' | 'delete';

type Props = {
  fileUri: string;
  mode: PageMode;
  selected: Set<number>; // 1-based page numbers
  onChange: (s: Set<number>) => void;
  angle?: number; // rotate preview
  color: string;
  help: string;
};

/** Thumbnail grid: tap pages to select them. Replaces typing "1-3,5". */
export default function PagePicker({ fileUri, mode, selected, onChange, angle = 90, color, help }: Props) {
  const styles = useStyles(makeStyles);
  const { theme } = useTheme();
  const [thumbs, setThumbs] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const cols = width > 600 ? 5 : 3;
  const size = (width - 40 - (cols - 1) * 10) / cols;

  useEffect(() => {
    let alive = true;
    setThumbs(null);
    setError(null);
    PdfThumbnail.generateAllPages(fileUri, { quality: 55, maxWidth: 260, maxHeight: 360 })
      .then((r) => alive && setThumbs(r.map((t) => t.uri)))
      .catch((e) => alive && setError(e?.message ?? String(e)));
    return () => {
      alive = false;
    };
  }, [fileUri]);

  const total = thumbs?.length ?? 0;
  const all = useMemo(() => [...Array(total)].map((_, i) => i + 1), [total]);

  const toggle = (p: number) => {
    const s = new Set(selected);
    s.has(p) ? s.delete(p) : s.add(p);
    onChange(s);
  };

  if (error) return <Text style={styles.err}>Could not preview pages: {error}</Text>;
  if (!thumbs)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color} />
        <Text style={styles.loadingText}>Loading pages…</Text>
      </View>
    );

  return (
    <View>
      <View style={[styles.help, { borderColor: color + '55', backgroundColor: color + '10' }]}>
        <Text style={styles.helpText}>💡 {help}</Text>
      </View>

      <View style={styles.quick}>
        <Text style={styles.count}>
          {selected.size} / {total} selected
        </Text>
        <QuickBtn label="All" onPress={() => onChange(new Set(all))} />
        <QuickBtn label="None" onPress={() => onChange(new Set())} />
        <QuickBtn label="Odd" onPress={() => onChange(new Set(all.filter((p) => p % 2 === 1)))} />
        <QuickBtn label="Even" onPress={() => onChange(new Set(all.filter((p) => p % 2 === 0)))} />
      </View>

      <View style={styles.grid}>
        {thumbs.map((uri, i) => {
          const p = i + 1;
          const on = selected.has(p);
          const rot = mode === 'rotate' && on ? angle : 0;
          return (
            <Pressable
              key={uri}
              onPress={() => toggle(p)}
              style={[
                styles.cell,
                { width: size },
                on && { borderColor: mode === 'delete' ? '#C0392B' : color, backgroundColor: theme.card },
              ]}
              accessibilityLabel={`Page ${p}${on ? ', selected' : ''}`}
            >
              <View style={[styles.thumbBox, { height: size * 1.3 }]}>
                <Image
                  source={{ uri }}
                  style={[
                    styles.thumb,
                    { transform: [{ rotate: `${rot}deg` }] },
                    mode === 'delete' && on && { opacity: 0.25 },
                  ]}
                  resizeMode="contain"
                />
                {mode === 'delete' && on && <Text style={styles.cross}>✕</Text>}
              </View>
              <View style={styles.cellFoot}>
                <Text style={styles.pageNo}>{p}</Text>
                <View
                  style={[
                    styles.check,
                    on && { backgroundColor: mode === 'delete' ? '#C0392B' : color, borderColor: 'transparent' },
                  ]}
                >
                  {on && <Text style={styles.checkMark}>{mode === 'delete' ? '✕' : '✓'}</Text>}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function QuickBtn({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={styles.qbtn} hitSlop={6}>
      <Text style={styles.qbtnText}>{label}</Text>
    </Pressable>
  );
}

/** {1,2,3,5} → "1-3,5" (what the PDF functions expect) */
export function toRange(sel: Set<number>): string {
  const pages = [...sel].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(i === j ? `${pages[i]}` : `${pages[i]}-${pages[j]}`);
    i = j;
  }
  return parts.join(',');
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  loading: { padding: 24, alignItems: 'center', gap: 8 },
  loadingText: { color: t.muted },
  err: { color: '#C0392B', padding: 12 },
  help: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  helpText: { fontSize: 14, color: t.text, lineHeight: 21 },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  count: { flex: 1, fontWeight: '700', color: t.text, minWidth: 110 },
  qbtn: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  qbtnText: { fontSize: 13, fontWeight: '600', color: t.sub },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { borderWidth: 2, borderColor: 'transparent', borderRadius: 12, padding: 4, backgroundColor: t.card2 },
  thumbBox: { alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%' },
  cross: { position: 'absolute', fontSize: 40, color: '#C0392B', fontWeight: '900' },
  cellFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 4 },
  pageNo: { fontWeight: '700', color: t.sub },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 12 },
});
