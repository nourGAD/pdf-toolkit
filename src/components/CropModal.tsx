import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ComponentType, Ref } from 'react';
import { WebView as RNWebView } from 'react-native-webview';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { PickedFile } from '../lib/files';
import { imageSize } from '../lib/images';
import { CROP_HTML } from '../crop/cropHtml';

type WebViewHandle = { injectJavaScript: (code: string) => void };
const WebView = RNWebView as unknown as ComponentType<{
  ref?: Ref<WebViewHandle>;
  source: { html: string };
  originWhitelist: string[];
  onMessage: (e: { nativeEvent: { data: string } }) => void;
  scrollEnabled?: boolean;
  style?: object;
}>;

const WORK_MAX = 2400; // downscale before editing — fast and memory-safe
const OUT_MAX = 2480; // ≈ A4 @ 300 dpi

/**
 * CamScanner-style crop: drag the 4 corners onto the document's corners,
 * the page is straightened (perspective correction) when you tap Done.
 */
export default function CropModal({
  image,
  index,
  total,
  onDone,
  onCancel,
}: {
  image: PickedFile | null;
  index?: number;
  total?: number;
  onDone: (img: PickedFile) => void;
  onCancel: () => void;
}) {
  const web = useRef<WebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const js = (c: string) => web.current?.injectJavaScript(`${c};true;`);

  useEffect(() => {
    setReady(false);
    setBusy(true);
  }, [image?.uri]);

  async function sendImage() {
    if (!image) return;
    try {
      const { width, height } = await imageSize(image.uri);
      const k = Math.min(1, WORK_MAX / Math.max(width, height));
      const r = await manipulateAsync(
        image.uri,
        k < 1 ? [{ resize: { width: Math.round(width * k), height: Math.round(height * k) } }] : [],
        { compress: 0.9, format: SaveFormat.JPEG, base64: true },
      );
      js(`window.__setImage(${JSON.stringify('data:image/jpeg;base64,' + r.base64)})`);
    } catch (e: any) {
      Alert.alert('Could not open image', e?.message ?? String(e));
      onCancel();
    }
  }

  function onMessage(e: { nativeEvent: { data: string } }) {
    const m = JSON.parse(e.nativeEvent.data);
    if (m.type === 'ready') sendImage();
    else if (m.type === 'loaded') {
      setReady(true);
      setBusy(false);
    } else if (m.type === 'result') {
      try {
        const out = new File(Paths.cache, `crop_${Date.now()}.jpg`);
        out.create({ overwrite: true });
        out.write(m.data, { encoding: 'base64' });
        onDone({ uri: out.uri, name: (image?.name ?? 'page').replace(/\.\w+$/, '') + '.jpg', mimeType: 'image/jpeg' });
      } catch (err: any) {
        Alert.alert('Could not save crop', err?.message ?? String(err));
      } finally {
        setBusy(false);
      }
    } else if (m.type === 'error') {
      setBusy(false);
      Alert.alert('Crop error', m.message);
    }
  }

  return (
    <Modal visible={!!image} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.root}>
        <View style={styles.top}>
          <Pressable onPress={onCancel} hitSlop={10}>
            <Text style={styles.topBtn}>Keep original</Text>
          </Pressable>
          <Text style={styles.title}>{total && total > 1 ? `Crop ${(index ?? 0) + 1}/${total}` : 'Crop'}</Text>
          <Pressable
            onPress={() => {
              setBusy(true);
              setTimeout(() => js(`window.__apply(${OUT_MAX})`), 30);
            }}
            hitSlop={10}
            disabled={!ready || busy}
          >
            <Text style={[styles.topBtn, styles.done, (!ready || busy) && { opacity: 0.4 }]}>Done ✓</Text>
          </Pressable>
        </View>

        <View style={{ flex: 1 }}>
          {image && (
            <WebView
              key={image.uri}
              ref={web}
              source={{ html: CROP_HTML }}
              originWhitelist={['*']}
              onMessage={onMessage}
              scrollEnabled={false}
              style={{ flex: 1, backgroundColor: '#111' }}
            />
          )}
          {busy && (
            <View style={styles.busy}>
              <ActivityIndicator color="#fff" size="large" />
            </View>
          )}
        </View>

        <View style={styles.bottom}>
          <Text style={styles.hint}>اسحب الـ 4 أركان على أطراف الورقة · Drag the 4 corners onto the document</Text>
          <View style={styles.row}>
            <Pressable style={styles.tool} onPress={() => js('window.__rotate()')} disabled={!ready}>
              <Text style={styles.toolText}>⟳ Rotate</Text>
            </Pressable>
            <Pressable style={styles.tool} onPress={() => js('window.__reset()')} disabled={!ready}>
              <Text style={styles.toolText}>⛶ Full image</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 44 },
  topBtn: { color: '#AAB0BC', fontSize: 16 },
  done: { color: '#3DDC6A', fontWeight: '800', fontSize: 17 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  busy: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  bottom: { padding: 16, paddingBottom: 34, gap: 12 },
  hint: { color: '#AAB0BC', fontSize: 13, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  tool: { flex: 1, borderWidth: 1, borderColor: '#444', borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  toolText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
