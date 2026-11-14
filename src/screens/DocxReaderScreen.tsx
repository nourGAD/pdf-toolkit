import type { PickedFile } from '../lib/files';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType, Ref } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import * as Speech from 'expo-speech';
import { File } from 'expo-file-system';
import { DOCX_HTML } from '../docx/docxHtml';
import { LibraryDoc, updateDoc } from '../lib/library';
import { Theme, settings, useStyles, useTheme } from '../theme';

type WebViewHandle = { injectJavaScript: (code: string) => void };
const WebView = RNWebView as unknown as ComponentType<{
  ref?: Ref<WebViewHandle>;
  source: { html: string };
  originWhitelist: string[];
  onMessage: (e: { nativeEvent: { data: string } }) => void;
  style?: object;
}>;

const MAX_MB = 30; // .docx files are usually small; very large ones are mostly images
const RATES = [0.8, 1, 1.25, 1.5] as const;
const FONT_STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75];

/** Word (.docx) reader: clean reflowed text, dark mode, text size, read aloud, resume position. */
export default function DocxReaderScreen({
  doc,
  onBack,
  onSummary,
}: {
  doc: LibraryDoc;
  onBack: () => void;
  onSummary?: (f: PickedFile) => void;
}) {
  const styles = useStyles(makeStyles);
  const { theme, cycle } = useTheme();
  const web = useRef<WebViewHandle>(null);
  const [loading, setLoading] = useState(true);
  const [font, setFont] = useState<number>(() => Number(settings.read().docxFont) || 1);
  const [speaking, setSpeaking] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const ttsOn = useRef(false);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const waiters = useRef(new Map<string, (items: { i: number; text: string }[]) => void>());
  const js = (c: string) => web.current?.injectJavaScript(`${c};true;`);

  useEffect(() => js(`window.__setDark(${theme.dark})`), [theme.dark]);
  useEffect(() => {
    js(`window.__setFont(${font})`);
    settings.write({ docxFont: font });
  }, [font]);
  useEffect(
    () => () => {
      ttsOn.current = false;
      Speech.stop();
    },
    [],
  );

  async function onMessage(e: { nativeEvent: { data: string } }) {
    const m = JSON.parse(e.nativeEvent.data);
    switch (m.type) {
      case 'ready':
        try {
          const f = new File(doc.uri);
          const mb = (f.size ?? 0) / 1048576;
          if (mb > MAX_MB) throw new Error(`This Word file is ${Math.round(mb)} MB — the reader supports up to ${MAX_MB} MB.`);
          const b64 = await f.base64();
          js(`window.__load(${JSON.stringify(b64)}, ${JSON.stringify({ dark: theme.dark, font, pos: doc.pos ?? 0 })})`);
        } catch (err: any) {
          setLoading(false);
          Alert.alert('Could not open file', err?.message ?? String(err));
        }
        break;
      case 'loaded':
        setLoading(false);
        updateDoc(doc.id, { openedAt: Date.now() });
        break;
      case 'scroll':
        updateDoc(doc.id, { pos: m.pos });
        break;
      case 'paras':
        waiters.current.get(m.reqId)?.(m.items);
        waiters.current.delete(m.reqId);
        break;
      case 'error':
        setLoading(false);
        Alert.alert(
          'Could not open this document',
          `${m.message}\n\nOnly .docx files are supported (not the old .doc format).`,
        );
        break;
    }
  }

  // ---- read aloud: paragraph by paragraph, highlighted and scrolled into view ----
  const getParas = () =>
    new Promise<{ i: number; text: string }[]>((resolve) => {
      const id = `${Date.now()}`;
      waiters.current.set(id, resolve);
      js(`window.__parasFromVisible(${JSON.stringify(id)})`);
    });

  const speak = (text: string, language: string) =>
    new Promise<void>((resolve) =>
      Speech.speak(text, { language, rate: rateRef.current, onDone: () => resolve(), onStopped: () => resolve(), onError: () => resolve() }),
    );

  async function readAloud() {
    ttsOn.current = true;
    setSpeaking(true);
    const items = await getParas();
    for (const p of items) {
      if (!ttsOn.current) break;
      js(`window.__highlight(${p.i})`);
      const language = /[؀-ۿ]/.test(p.text) ? 'ar' : 'en-US';
      for (let k = 0; k < p.text.length && ttsOn.current; k += 3000) await speak(p.text.slice(k, k + 3000), language);
    }
    if (ttsOn.current) js('window.__highlight(-1)'); // finished the document
    stop();
  }

  // the highlight stays, so pressing ▶ again continues from the same paragraph
  function stop() {
    ttsOn.current = false;
    Speech.stop();
    setSpeaking(false);
  }

  const fontIdx = FONT_STEPS.indexOf(font);

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          📝 {doc.name}
        </Text>
        {onSummary && (
          <Pressable
            onPress={() => onSummary({ uri: doc.uri, name: doc.name, mimeType: doc.kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf' })}
            hitSlop={8}
            accessibilityLabel="Summary and dashboard"
          >
            <Text style={{ fontSize: 19 }}>🧾</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => setFont(FONT_STEPS[Math.max(0, fontIdx - 1)])}
          hitSlop={6}
          style={styles.aBtn}
          disabled={fontIdx <= 0}
        >
          <Text style={[styles.aText, { fontSize: 13 }]}>A−</Text>
        </Pressable>
        <Pressable
          onPress={() => setFont(FONT_STEPS[Math.min(FONT_STEPS.length - 1, (fontIdx < 0 ? 1 : fontIdx) + 1)])}
          hitSlop={6}
          style={styles.aBtn}
          disabled={fontIdx >= FONT_STEPS.length - 1}
        >
          <Text style={[styles.aText, { fontSize: 17 }]}>A+</Text>
        </Pressable>
        <Pressable onPress={cycle} hitSlop={8} accessibilityLabel="Toggle dark mode">
          <Text style={{ fontSize: 20 }}>{theme.dark ? '☀️' : '🌙'}</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        <WebView ref={web} source={{ html: DOCX_HTML }} originWhitelist={['*']} onMessage={onMessage} style={styles.web} />
        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={theme.accent} />
            <Text style={styles.loadingText}>Opening document…</Text>
          </View>
        )}
      </View>

      <View style={styles.bottom}>
        <Pressable style={styles.btn} onPress={() => setRate(RATES[(RATES.indexOf(rate as any) + 1) % RATES.length])}>
          <Text style={styles.btnIcon}>⏩</Text>
          <Text style={styles.btnText}>{rate}x</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.play, speaking && { backgroundColor: '#C0392B' }]}
          onPress={() => (speaking ? stop() : readAloud())}
          disabled={loading}
        >
          <Text style={[styles.btnIcon, { color: '#fff' }]}>{speaking ? '■' : '▶'}</Text>
          <Text style={[styles.btnText, { color: '#fff' }]}>{speaking ? 'Stop' : 'Read aloud'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg2 },
    top: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: t.card,
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    back: { fontSize: 30, color: t.accent, marginTop: -4 },
    title: { flex: 1, fontSize: 16, fontWeight: '700', color: t.text },
    aBtn: { borderWidth: 1, borderColor: t.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    aText: { color: t.text, fontWeight: '800' },
    web: { flex: 1, backgroundColor: t.bg2 },
    loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12 },
    loadingText: { color: t.sub, fontWeight: '600' },
    bottom: {
      flexDirection: 'row',
      backgroundColor: t.card,
      padding: 8,
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    btn: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 12 },
    play: { backgroundColor: '#1F8FE5', flex: 2.5 },
    btnIcon: { fontSize: 18, color: t.text },
    btnText: { fontSize: 11, color: t.sub, marginTop: 2, fontWeight: '600' },
  });
