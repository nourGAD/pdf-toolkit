import { useEffect, useRef, useState } from 'react';
import type { ComponentType, Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import PdfThumbnail from 'react-native-pdf-thumbnail';
import { File } from 'expo-file-system';
import { REORDER_HTML } from '../reorder/reorderHtml';
import { Theme, useStyles, useTheme } from '../theme';

type WebViewHandle = { injectJavaScript: (code: string) => void };
const WebView = RNWebView as unknown as ComponentType<{
  ref?: Ref<WebViewHandle>;
  source: { html: string };
  originWhitelist: string[];
  onMessage: (e: { nativeEvent: { data: string } }) => void;
  scrollEnabled?: boolean;
  style?: object;
}>;

/** Reorder pages: tap-then-tap, or hold-and-drag, in one screen. Reports the new order (original 0-based indexes). */
export default function PageReorder({
  fileUri,
  onChange,
  onDragging,
  color,
}: {
  fileUri: string;
  onChange: (order: number[], changed: boolean) => void;
  onDragging: (d: boolean) => void;
  color: string;
}) {
  const styles = useStyles(makeStyles);
  const { theme } = useTheme();
  const web = useRef<WebViewHandle>(null);
  const [height, setHeight] = useState(400);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [changed, setChanged] = useState(false);
  const js = (c: string) => web.current?.injectJavaScript(`${c};true;`);

  useEffect(() => js(`window.__setDark(${theme.dark})`), [theme.dark]);

  async function load() {
    js(`window.__setDark(${theme.dark})`);
    const thumbs = await PdfThumbnail.generateAllPages(fileUri, { quality: 50, maxWidth: 220, maxHeight: 310 });
    setCount(thumbs.length);
    onChange(thumbs.map((_, i) => i), false);
    for (let i = 0; i < thumbs.length; i++) {
      const b64 = await new File(thumbs[i].uri).base64();
      js(`window.__add(${i}, ${JSON.stringify('data:image/jpeg;base64,' + b64)})`);
    }
    js('window.__done()');
    setLoading(false);
  }

  return (
    <View>
      <View style={[styles.web, { height }]}>
        <WebView
          ref={web}
          source={{ html: REORDER_HTML }}
          originWhitelist={['*']}
          scrollEnabled={false}
          style={{ backgroundColor: 'transparent' }}
          onMessage={(e) => {
            const m = JSON.parse(e.nativeEvent.data);
            if (m.type === 'ready') load().catch(() => setLoading(false));
            if (m.type === 'height') setHeight(Math.max(200, m.h));
            if (m.type === 'drag') onDragging(m.on);
            if (m.type === 'order') {
              const ch = m.order.some((v: number, i: number) => v !== i);
              setChanged(ch);
              onChange(m.order, ch);
            }
          }}
        />
        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator color={color} />
            <Text style={styles.muted}>Loading pages…</Text>
          </View>
        )}
      </View>
      {changed && (
        <Pressable onPress={() => js('window.__reset()')} style={styles.reset}>
          <Text style={styles.resetText}>↺ Back to original order</Text>
        </Pressable>
      )}
      {!loading && count > 0 && <Text style={[styles.muted, { textAlign: 'center' }]}>{count} pages</Text>}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    web: { width: '100%' },
    loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.bg },
    muted: { color: t.muted, fontSize: 12 },
    reset: { alignSelf: 'center', marginVertical: 8, borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: t.card },
    resetText: { color: t.text, fontWeight: '700' },
  });
