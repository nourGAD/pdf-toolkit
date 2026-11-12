import { useEffect, useRef, useState } from 'react';
import type { ComponentType, Ref } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import { SIGNATURE_HTML } from './signatureHtml';
import { SavedSignature, deleteSignature, listSignatures, saveSignature, signatureBase64 } from '../lib/signatures';
import { imageSize } from '../lib/images';
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

export type SignatureImage = { base64: string; width: number; height: number };
const INKS = ['#1B1E28', '#1F3FBF', '#C0392B'];

/** Pick a saved signature or draw a new one with your finger. */
export default function SignatureSheet({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (s: SignatureImage) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const { theme } = useTheme();
  const web = useRef<WebViewHandle>(null);
  const [saved, setSaved] = useState<SavedSignature[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [ink, setInk] = useState(INKS[0]);
  const js = (c: string) => web.current?.injectJavaScript(`${c};true;`);

  useEffect(() => {
    if (!visible) return;
    const list = listSignatures();
    setSaved(list);
    setDrawing(list.length === 0);
    setHasInk(false);
  }, [visible]);

  async function useSaved(s: SavedSignature) {
    const [base64, size] = await Promise.all([signatureBase64(s.uri), imageSize(s.uri)]);
    onPick({ base64, ...size });
  }

  function onMessage(e: { nativeEvent: { data: string } }) {
    const m = JSON.parse(e.nativeEvent.data);
    if (m.type === 'ready') js(`window.__setColor(${JSON.stringify(ink)})`);
    if (m.type === 'drawn') setHasInk(!m.empty);
    if (m.type === 'empty') Alert.alert('Draw your signature first');
    if (m.type === 'png') {
      saveSignature(m.data); // keep it for next time
      onPick({ base64: m.data, width: m.width, height: m.height });
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.bg}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>✍️ Signature · التوقيع</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {!drawing ? (
            <>
              <Text style={styles.label}>Your saved signatures — tap to use</Text>
              <ScrollView horizontal contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
                {saved.map((s) => (
                  <Pressable
                    key={s.id}
                    style={styles.savedCard}
                    onPress={() => useSaved(s)}
                    onLongPress={() =>
                      Alert.alert('Delete this signature?', '', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => (deleteSignature(s.id), setSaved(listSignatures())) },
                      ])
                    }
                  >
                    <Image source={{ uri: s.uri }} style={styles.savedImg} resizeMode="contain" />
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={styles.hint}>Long-press a signature to delete it</Text>
              <Pressable style={styles.primary} onPress={() => setDrawing(true)}>
                <Text style={styles.primaryText}>+ Draw a new signature</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.label}>Sign with your finger on the line · وقّع بصباعك</Text>
              <View style={styles.pad}>
                <WebView
                  ref={web}
                  source={{ html: SIGNATURE_HTML }}
                  originWhitelist={['*']}
                  onMessage={onMessage}
                  scrollEnabled={false}
                  style={{ flex: 1, backgroundColor: 'transparent' }}
                />
              </View>
              <View style={styles.row}>
                {INKS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => (setInk(c), js(`window.__setColor(${JSON.stringify(c)})`))}
                    style={[styles.ink, { backgroundColor: c }, ink === c && { borderColor: theme.accent }]}
                  />
                ))}
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => js('window.__clear()')} style={styles.ghost}>
                  <Text style={styles.ghostText}>Clear</Text>
                </Pressable>
                {saved.length > 0 && (
                  <Pressable onPress={() => setDrawing(false)} style={styles.ghost}>
                    <Text style={styles.ghostText}>Saved</Text>
                  </Pressable>
                )}
              </View>
              <Pressable
                style={[styles.primary, !hasInk && { opacity: 0.4 }]}
                disabled={!hasInk}
                onPress={() => js('window.__export()')}
              >
                <Text style={styles.primaryText}>Use this signature</Text>
              </Pressable>
              <Text style={styles.hint}>It's saved on your phone so you can reuse it next time.</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    bg: { flex: 1, backgroundColor: t.overlay },
    sheet: { backgroundColor: t.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 34 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    title: { fontSize: 19, fontWeight: '800', color: t.text },
    close: { fontSize: 20, color: t.muted },
    label: { fontSize: 13, fontWeight: '700', color: t.sub, marginVertical: 8 },
    hint: { fontSize: 12, color: t.muted, marginTop: 8, textAlign: 'center' },
    pad: { height: 220, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: '#FFFFFF', overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
    ink: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: t.card },
    ghost: { borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    ghostText: { color: t.text, fontWeight: '700' },
    primary: { marginTop: 14, backgroundColor: '#7B4FD6', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
    primaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
    savedCard: { width: 150, height: 80, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: '#FFFFFF', padding: 6 },
    savedImg: { width: '100%', height: '100%' },
  });
