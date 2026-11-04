import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import type { ComponentType, Ref } from 'react';
import * as Speech from 'expo-speech';
import { File } from 'expo-file-system';
import { Buffer } from 'buffer';
import { READER_HTML } from '../reader/readerHtml';
import { Bookmark, LibraryDoc, addBookmark, removeBookmark, updateDoc } from '../lib/library';

const RATES = [0.8, 1, 1.25, 1.5] as const;
const CHUNK = 512 * 1024; // bytes sent to the viewer per message

// react-native-webview's prop types currently collapse to `never` with RN 0.88 types; use a narrow typed wrapper.
type WebViewHandle = { injectJavaScript: (code: string) => void };
type WebViewMessageEvent = { nativeEvent: { data: string } };
const WebView = RNWebView as unknown as ComponentType<{
  ref?: Ref<WebViewHandle>;
  source: { html: string };
  originWhitelist: string[];
  onMessage: (e: WebViewMessageEvent) => void;
  javaScriptEnabled?: boolean;
  setBuiltInZoomControls?: boolean;
  style?: object;
}>;

export default function ReaderScreen({ doc, onBack }: { doc: LibraryDoc; onBack: () => void }) {
  const web = useRef<WebViewHandle>(null);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState(doc.pages);
  const [page, setPage] = useState(doc.lastPage);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(doc.bookmarks);
  const [showMarks, setShowMarks] = useState(false);
  const [newMark, setNewMark] = useState<string | null>(null); // label being typed
  const [gotoText, setGotoText] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [rate, setRate] = useState<number>(1);

  const pageRef = useRef(page);
  const pagesRef = useRef(pages);
  const ttsOn = useRef(false);
  const rateRef = useRef(rate);
  const textWaiters = useRef(new Map<string, (t: string) => void>());

  // Byte-range reader: pdf.js asks for pieces of the file, we read just those from disk.
  // (Reading the whole file at once crashed on big PDFs — OutOfMemoryError.)
  const handle = useRef<ReturnType<File['open']> | null>(null);
  const rangeQueue = useRef<{ begin: number; end: number }[]>([]);
  const pumping = useRef(false);

  async function pumpRanges() {
    if (pumping.current) return;
    pumping.current = true;
    try {
      while (rangeQueue.current.length) {
        const { begin, end } = rangeQueue.current.shift()!;
        if (!handle.current) handle.current = new File(doc.uri).open();
        for (let pos = begin; pos < end; pos += CHUNK) {
          const len = Math.min(CHUNK, end - pos);
          handle.current.offset = pos;
          const bytes = await handle.current.readBytes(len);
          js(`window.__chunk(${pos}, "${Buffer.from(bytes).toString('base64')}")`);
          await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
        }
      }
    } catch (err: any) {
      Alert.alert('Could not read file', err?.message ?? String(err));
    } finally {
      pumping.current = false;
    }
  }

  pageRef.current = page;
  pagesRef.current = pages;
  rateRef.current = rate;

  const js = (code: string) => web.current?.injectJavaScript(`${code};true;`);
  const goto = (p: number) => js(`window.__goto(${p})`);

  // ---- messages from the WebView ----
  const onMessage = useCallback(
    async (e: WebViewMessageEvent) => {
      const m = JSON.parse(e.nativeEvent.data);
      switch (m.type) {
        case 'ready': {
          try {
            const size = new File(doc.uri).size ?? 0;
            if (!size) throw new Error('The file is empty or missing');
            js(`window.__open(${size}, ${doc.lastPage}, ${CHUNK})`);
          } catch (err: any) {
            Alert.alert('Could not open file', err?.message ?? String(err));
          }
          break;
        }
        case 'range':
          rangeQueue.current.push({ begin: m.begin, end: m.end });
          pumpRanges();
          break;
        case 'loaded':
          setLoading(false);
          setPages(m.pages);
          updateDoc(doc.id, { pages: m.pages });
          break;
        case 'page':
          setPage(m.page);
          updateDoc(doc.id, { lastPage: m.page }); // resume here next time
          break;
        case 'text':
          textWaiters.current.get(m.reqId)?.(m.text ?? '');
          textWaiters.current.delete(m.reqId);
          break;
        case 'error':
          setLoading(false);
          Alert.alert('Reader error', m.message);
          break;
      }
    },
    [doc.id, doc.uri, doc.lastPage],
  );

  // ---- read aloud ----
  const getText = (p: number) =>
    new Promise<string>((resolve) => {
      const reqId = `${p}_${Date.now()}`;
      textWaiters.current.set(reqId, resolve);
      js(`window.__getText(${p}, ${JSON.stringify(reqId)})`);
    });

  const speakChunk = (text: string, language: string) =>
    new Promise<void>((resolve) => {
      Speech.speak(text, {
        language,
        rate: rateRef.current,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    });

  async function readAloud() {
    ttsOn.current = true;
    setSpeaking(true);
    js('window.__highlight(true)');
    let p = pageRef.current;
    let emptyRun = 0;
    while (ttsOn.current && p <= pagesRef.current) {
      const text = await getText(p);
      if (!text) {
        if (++emptyRun >= 3) {
          Alert.alert(
            'No text found',
            'These pages look like scanned images, so there is no text to read. OCR support is coming in a later update.',
          );
          break;
        }
      } else {
        emptyRun = 0;
        const language = /[؀-ۿ]/.test(text) ? 'ar' : 'en-US';
        for (const chunk of chunks(text, Math.min(Speech.maxSpeechInputLength || 4000, 3000))) {
          if (!ttsOn.current) break;
          await speakChunk(chunk, language);
        }
      }
      if (!ttsOn.current) break;
      p += 1;
      if (p <= pagesRef.current) goto(p);
    }
    stopReading();
  }

  function stopReading() {
    ttsOn.current = false;
    Speech.stop();
    setSpeaking(false);
    js('window.__highlight(false)');
  }

  useEffect(() => () => {
    ttsOn.current = false;
    Speech.stop();
    try {
      handle.current?.close();
    } catch {}
  }, []);

  // ---- bookmarks ----
  async function saveBookmark() {
    setBookmarks(await addBookmark(doc.id, pageRef.current, newMark ?? ''));
    setNewMark(null);
  }

  const isMarked = bookmarks.some((b) => b.page === page);

  return (
    <View style={styles.root}>
      {/* top bar */}
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {doc.name}
        </Text>
        <Pressable onPress={() => setShowMarks(true)} hitSlop={8}>
          <Text style={styles.pageNo}>
            {page} / {pages || '…'}
          </Text>
        </Pressable>
      </View>

      <WebView
        ref={web}
        source={{ html: READER_HTML }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        setBuiltInZoomControls={false}
        style={styles.web}
      />
      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
        </View>
      )}

      {/* bottom bar */}
      <View style={styles.bottom}>
        <Pressable style={styles.btn} onPress={() => (isMarked ? setShowMarks(true) : setNewMark(''))}>
          <Text style={styles.btnIcon}>{isMarked ? '🔖' : '📑'}</Text>
          <Text style={styles.btnText}>{isMarked ? 'Marked' : 'Bookmark'}</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => setShowMarks(true)}>
          <Text style={styles.btnIcon}>📚</Text>
          <Text style={styles.btnText}>Bookmarks{bookmarks.length ? ` (${bookmarks.length})` : ''}</Text>
        </Pressable>
        <Pressable
          style={styles.btn}
          onPress={() => setRate(RATES[(RATES.indexOf(rate as any) + 1) % RATES.length])}
        >
          <Text style={styles.btnIcon}>⏩</Text>
          <Text style={styles.btnText}>{rate}x</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.play, speaking && { backgroundColor: '#C0392B' }]}
          onPress={() => (speaking ? stopReading() : readAloud())}
          disabled={loading}
        >
          <Text style={[styles.btnIcon, { color: '#fff' }]}>{speaking ? '■' : '▶'}</Text>
          <Text style={[styles.btnText, { color: '#fff' }]}>{speaking ? 'Stop' : 'Read aloud'}</Text>
        </Pressable>
      </View>

      {/* bookmarks list + go to page */}
      <Modal visible={showMarks} animationType="slide" transparent onRequestClose={() => setShowMarks(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowMarks(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Bookmarks</Text>
            <View style={styles.gotoRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Go to page (1–${pages})`}
                keyboardType="number-pad"
                value={gotoText}
                onChangeText={setGotoText}
              />
              <Pressable
                style={styles.smallBtn}
                onPress={() => {
                  const n = parseInt(gotoText, 10);
                  if (n >= 1 && n <= pages) {
                    goto(n);
                    setGotoText('');
                    setShowMarks(false);
                  }
                }}
              >
                <Text style={styles.smallBtnText}>Go</Text>
              </Pressable>
            </View>
            <FlatList
              data={bookmarks}
              keyExtractor={(b) => b.id}
              style={{ maxHeight: 360 }}
              ListEmptyComponent={<Text style={styles.empty}>No bookmarks yet. Tap 📑 on any page to add one.</Text>}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.mark}
                  onPress={() => {
                    goto(item.page);
                    setShowMarks(false);
                  }}
                >
                  <Text style={styles.markPage}>p. {item.page}</Text>
                  <Text style={styles.markLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Pressable onPress={async () => setBookmarks(await removeBookmark(doc.id, item.id))} hitSlop={10}>
                    <Text style={styles.del}>✕</Text>
                  </Pressable>
                </Pressable>
              )}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* add bookmark */}
      <Modal visible={newMark !== null} transparent animationType="fade" onRequestClose={() => setNewMark(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
          <View style={styles.dialog}>
            <Text style={styles.sheetTitle}>Bookmark page {page}</Text>
            <TextInput
              style={styles.input}
              placeholder="Name (optional) — e.g. Chapter 3"
              value={newMark ?? ''}
              onChangeText={setNewMark}
              autoFocus
              onSubmitEditing={saveBookmark}
            />
            <View style={[styles.gotoRow, { justifyContent: 'flex-end', marginTop: 12 }]}>
              <Pressable onPress={() => setNewMark(null)} style={[styles.smallBtn, { backgroundColor: '#E1E4EC' }]}>
                <Text style={[styles.smallBtnText, { color: '#1B1E28' }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveBookmark} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/** Split text into TTS-sized chunks on sentence boundaries. */
function chunks(text: string, max: number): string[] {
  const parts = (text.match(/[^.!?؟\n]+[.!?؟\n]*/g) ?? [text]).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).length > max && cur) {
      out.push(cur);
      cur = '';
    }
    if (p.length > max) {
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
    } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E9EBF0' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#D5D8E0',
  },
  back: { fontSize: 30, color: '#1F8FE5', marginTop: -4 },
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: '#1B1E28' },
  pageNo: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F8FE5',
    backgroundColor: '#E8F2FC',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  web: { flex: 1, backgroundColor: '#E9EBF0' },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  bottom: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#D5D8E0',
  },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 12 },
  play: { backgroundColor: '#1F8FE5', flex: 1.3 },
  btnIcon: { fontSize: 18 },
  btnText: { fontSize: 11, color: '#5B6170', marginTop: 2, fontWeight: '600' },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 36 },
  sheetTitle: { fontSize: 18, fontWeight: '800', marginBottom: 12, color: '#1B1E28' },
  gotoRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#E1E4EC',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  smallBtn: { backgroundColor: '#1F8FE5', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  smallBtnText: { color: '#fff', fontWeight: '700' },
  empty: { color: '#8A8F9C', paddingVertical: 16, textAlign: 'center' },
  mark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E1E4EC',
  },
  markPage: { fontWeight: '800', color: '#1F8FE5', width: 54 },
  markLabel: { flex: 1, fontSize: 15, color: '#1B1E28' },
  del: { color: '#C0392B', fontSize: 16 },
  center: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: 18, padding: 18, alignSelf: 'stretch' },
});
