import { useEffect, useRef, useState } from 'react';
import type { ComponentType, Ref } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import PdfThumbnail from 'react-native-pdf-thumbnail';
import { TEXT_IMAGE_HTML } from '../watermark/textImageHtml';
import { watermarkLayout } from '../lib/pdf';
import { Theme, useStyles, useTheme } from '../theme';

type WebViewHandle = { injectJavaScript: (code: string) => void };
const WebView = RNWebView as unknown as ComponentType<{
  ref?: Ref<WebViewHandle>;
  source: { html: string };
  originWhitelist: string[];
  onMessage: (e: { nativeEvent: { data: string } }) => void;
  style?: object;
}>;

export type WatermarkSettings = {
  text: string;
  color: string;
  size: 'S' | 'M' | 'L';
  opacity: number;
  angle: number;
  layout: 'center' | 'tile';
};
export type WatermarkImage = { base64: string; width: number; height: number };

export const DEFAULT_WATERMARK: WatermarkSettings = {
  text: 'CONFIDENTIAL',
  color: '#E5322D',
  size: 'M',
  opacity: 0.3,
  angle: 45,
  layout: 'center',
};
export const SIZE_SCALE = { S: 0.45, M: 0.7, L: 0.95 } as const;

const COLORS = ['#E5322D', '#1B1E28', '#7A7F8C', '#1F8FE5', '#2BA84A', '#D98E04'];
const OPACITY = [
  { label: 'Light', v: 0.15 },
  { label: 'Medium', v: 0.3 },
  { label: 'Strong', v: 0.55 },
];
const ANGLES = [
  { label: '↗ 45°', v: 45 },
  { label: '→ 0°', v: 0 },
  { label: '↘ -45°', v: -45 },
];

/** Text, style and live preview for the watermark tool. Renders the text to a PNG via a hidden WebView. */
export default function WatermarkOptions({
  fileUri,
  value,
  onChange,
  onImage,
  color,
}: {
  fileUri: string;
  value: WatermarkSettings;
  onChange: (v: WatermarkSettings) => void;
  onImage: (img: WatermarkImage | null) => void;
  color: string;
}) {
  const styles = useStyles(makeStyles);
  const { theme } = useTheme();
  const web = useRef<WebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const [img, setImg] = useState<WatermarkImage | null>(null);
  const [page, setPage] = useState<{ uri: string; width: number; height: number } | null>(null);
  const { width: screenW } = useWindowDimensions();
  const set = (p: Partial<WatermarkSettings>) => onChange({ ...value, ...p });

  // first page for the preview
  useEffect(() => {
    let alive = true;
    PdfThumbnail.generate(fileUri, 0, { quality: 70, maxWidth: 700, maxHeight: 990 })
      .then((r) => alive && setPage(r))
      .catch(() => alive && setPage(null));
    return () => {
      alive = false;
    };
  }, [fileUri]);

  // re-render the text image when text/colour changes (debounced while typing)
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      web.current?.injectJavaScript(
        `window.__render(${JSON.stringify({ text: value.text, color: value.color })});true;`,
      );
    }, 250);
    return () => clearTimeout(t);
  }, [ready, value.text, value.color]);

  function onMessage(e: { nativeEvent: { data: string } }) {
    const m = JSON.parse(e.nativeEvent.data);
    if (m.type === 'ready') setReady(true);
    if (m.type === 'png') {
      const next = m.data ? { base64: m.data, width: m.width, height: m.height } : null;
      setImg(next);
      onImage(next);
    }
  }

  // preview geometry (same layout function as the PDF writer)
  const boxW = Math.min(screenW - 40, 420);
  const boxH = page ? (boxW * page.height) / page.width : boxW * 1.414;
  const stamps =
    img && page
      ? watermarkLayout(boxW, boxH, img.width, img.height, {
          angle: value.angle,
          layout: value.layout,
          scale: SIZE_SCALE[value.size],
        })
      : [];

  return (
    <View>
      {/* hidden renderer */}
      <View style={styles.hidden} pointerEvents="none">
        <WebView ref={web} source={{ html: TEXT_IMAGE_HTML }} originWhitelist={['*']} onMessage={onMessage} />
      </View>

      <Text style={styles.label}>Watermark text · اكتب أي حاجة (عربي أو إنجليزي)</Text>
      <TextInput
        placeholderTextColor={theme.muted}
        style={styles.input}
        value={value.text}
        onChangeText={(text) => set({ text })}
        placeholder="مثال: سري جداً — CONFIDENTIAL — اسم شركتك"
        multiline
        maxLength={80}
      />
      <View style={styles.presets}>
        {['CONFIDENTIAL', 'سري', 'DRAFT', 'مسودة', 'COPY', 'نسخة'].map((p) => (
          <Pressable key={p} onPress={() => set({ text: p })} style={styles.preset}>
            <Text style={styles.presetText}>{p}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Color</Text>
      <View style={styles.row}>
        {COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => set({ color: c })}
            style={[styles.swatch, { backgroundColor: c }, value.color === c && styles.swatchOn]}
            accessibilityLabel={`Color ${c}`}
          />
        ))}
      </View>

      <Seg label="Size" options={(['S', 'M', 'L'] as const).map((v) => ({ label: { S: 'Small', M: 'Medium', L: 'Large' }[v], v }))} value={value.size} onPick={(size) => set({ size })} color={color} />
      <Seg label="Opacity" options={OPACITY} value={value.opacity} onPick={(opacity) => set({ opacity })} color={color} />
      <Seg label="Angle" options={ANGLES} value={value.angle} onPick={(angle) => set({ angle })} color={color} />
      <Seg
        label="Layout"
        options={[
          { label: '◉ Center', v: 'center' as const },
          { label: '▦ Repeat', v: 'tile' as const },
        ]}
        value={value.layout}
        onPick={(layout) => set({ layout })}
        color={color}
      />

      <Text style={[styles.label, { marginTop: 16 }]}>Preview · معاينة (page 1)</Text>
      <View style={[styles.preview, { width: boxW, height: boxH }]}>
        {page ? (
          <Image source={{ uri: page.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : (
          <ActivityIndicator style={{ marginTop: boxH / 2 - 10 }} color={theme.accent} />
        )}
        {img &&
          stamps.map((s, i) => (
            <Image
              key={i}
              source={{ uri: `data:image/png;base64,${img.base64}` }}
              style={{
                position: 'absolute',
                width: s.w,
                height: s.h,
                left: s.cx - s.w / 2,
                top: boxH - s.cy - s.h / 2, // PDF y-up → screen y-down
                opacity: value.opacity,
                transform: [{ rotate: `${-value.angle}deg` }],
              }}
            />
          ))}
      </View>
    </View>
  );
}

function Seg<T extends string | number>({
  label,
  options,
  value,
  onPick,
  color,
}: {
  label: string;
  options: { label: string; v: T }[];
  value: T;
  onPick: (v: T) => void;
  color: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.seg}>
        {options.map((o) => {
          const on = o.v === value;
          return (
            <Pressable key={String(o.v)} onPress={() => onPick(o.v)} style={[styles.segBtn, on && { backgroundColor: color }]}>
              <Text style={[styles.segText, on && { color: '#fff' }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  label: { fontSize: 13, fontWeight: '700', color: t.sub, marginBottom: 6 },
  input: {
    color: t.text,
    backgroundColor: t.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    minHeight: 52,
    textAlign: 'auto',
  },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 12 },
  preset: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  presetText: { fontSize: 13, color: t.text, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: t.card },
  swatchOn: { borderColor: t.text },
  seg: { flexDirection: 'row', backgroundColor: t.bg2, borderRadius: 12, padding: 3, gap: 3 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  segText: { fontSize: 14, fontWeight: '700', color: t.text },
  preview: {
    alignSelf: 'center',
    backgroundColor: t.card,
    borderRadius: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
});
