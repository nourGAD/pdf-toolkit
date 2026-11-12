import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import PdfThumbnail from 'react-native-pdf-thumbnail';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { EditItem } from '../lib/edit';
import { pickImages } from '../lib/files';
import { imageSize } from '../lib/images';
import { pageCount } from '../lib/pdf';
import TextRenderer, { TextRendererHandle } from '../edit/TextRenderer';
import SignatureSheet from '../edit/SignatureSheet';
import { Theme, useStyles, useTheme } from '../theme';

type Props = {
  fileUri: string;
  items: EditItem[];
  onChange: (items: EditItem[]) => void;
  /** lets the parent ScrollView stop scrolling while an item is being dragged */
  onDragging: (dragging: boolean) => void;
  color: string;
  mode: 'edit' | 'sign';
};

const TEXT_COLORS = ['#1B1E28', '#1F3FBF', '#C0392B', '#2BA84A', '#7A7F8C'];
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Visual PDF editor: place text, images and signatures on pages, drag to move, corner to resize. */
export default function PdfEditor({ fileUri, items, onChange, onDragging, color, mode }: Props) {
  const styles = useStyles(makeStyles);
  const { theme } = useTheme();
  const { width: screenW } = useWindowDimensions();
  const renderer = useRef<TextRendererHandle>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(0);
  const [thumb, setThumb] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [textEdit, setTextEdit] = useState<{ id: string | null; value: string; color: string; bold: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    pageCount({ uri: fileUri, name: 'doc.pdf' })
      .then(setPages)
      .catch((e) => Alert.alert('Could not open PDF', e?.message ?? String(e)));
  }, [fileUri]);

  useEffect(() => {
    let alive = true;
    setThumb(null);
    PdfThumbnail.generate(fileUri, page, { quality: 80, maxWidth: 1200, maxHeight: 1700 })
      .then((r) => alive && setThumb(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fileUri, page]);

  const W = Math.min(screenW - 40, 560);
  const H = thumb ? (W * thumb.height) / thumb.width : W * 1.414;
  const onPage = items.filter((i) => i.page === page);
  const sel = items.find((i) => i.id === selected) ?? null;
  const countOn = (p: number) => items.filter((i) => i.page === p).length;

  // ---------- add / update ----------
  function place(img: { base64: string; width: number; height: number; mime: EditItem['mime'] }, kind: EditItem['kind'], text?: EditItem['text']) {
    let w = kind === 'signature' ? 0.36 : kind === 'text' ? 0.55 : 0.5;
    let h = (w * W * (img.height / img.width)) / H;
    if (h > 0.6) {
      w *= 0.6 / h;
      h = 0.6;
    }
    const it: EditItem = {
      id: uid(),
      kind,
      page,
      x: (1 - w) / 2,
      y: kind === 'signature' ? Math.min(0.85 - h, 0.7) : (1 - h) / 2,
      w,
      h,
      base64: img.base64,
      mime: img.mime,
      text,
    };
    onChange([...itemsRef.current, it]);
    setSelected(it.id);
  }

  async function saveText() {
    if (!textEdit || !textEdit.value.trim()) return;
    setBusy(true);
    try {
      const r = await renderer.current?.render({ text: textEdit.value, color: textEdit.color, bold: textEdit.bold });
      if (!r) return;
      const text = { value: textEdit.value, color: textEdit.color, bold: textEdit.bold };
      if (textEdit.id) {
        onChange(
          itemsRef.current.map((i) =>
            i.id === textEdit.id ? { ...i, base64: r.base64, text, h: (i.w * W * (r.height / r.width)) / H } : i,
          ),
        );
      } else place({ ...r, mime: 'image/png' }, 'text', text);
      setTextEdit(null);
    } finally {
      setBusy(false);
    }
  }

  async function addImage() {
    try {
      const [img] = await pickImages(0.9);
      if (!img) return;
      setBusy(true);
      const { width, height } = await imageSize(img.uri);
      const k = Math.min(1, 1600 / Math.max(width, height));
      const png = img.mimeType === 'image/png' || /\.png$/i.test(img.name); // keep transparency for logos
      const r = await manipulateAsync(img.uri, k < 1 ? [{ resize: { width: Math.round(width * k) } }] : [], {
        compress: 0.88,
        format: png ? SaveFormat.PNG : SaveFormat.JPEG,
        base64: true,
      });
      place({ base64: r.base64!, width: r.width, height: r.height, mime: png ? 'image/png' : 'image/jpeg' }, 'image');
    } catch (e: any) {
      Alert.alert('Could not add image', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function copyToAllPages() {
    if (!sel) return;
    const copies: EditItem[] = [];
    for (let p = 0; p < pages; p++) if (p !== sel.page) copies.push({ ...sel, id: uid(), page: p });
    onChange([...itemsRef.current, ...copies]);
    Alert.alert('Done', `Copied to ${copies.length} other page${copies.length === 1 ? '' : 's'} at the same position.`);
  }

  // auto-open the signature pad when the user came for "Sign PDF"
  const autoOpened = useRef(false);
  useEffect(() => {
    if (mode === 'sign' && !autoOpened.current && thumb) {
      autoOpened.current = true;
      setSigOpen(true);
    }
  }, [mode, thumb]);

  return (
    <View>
      <TextRenderer ref={renderer} />

      {/* toolbar */}
      <View style={styles.tools}>
        <ToolBtn icon="✍️" label="Signature" onPress={() => setSigOpen(true)} accent={mode === 'sign' ? color : undefined} />
        <ToolBtn icon="T" label="Text" onPress={() => setTextEdit({ id: null, value: '', color: TEXT_COLORS[0], bold: false })} accent={mode === 'edit' ? color : undefined} />
        <ToolBtn icon="🖼️" label="Image" onPress={addImage} />
      </View>
      <Text style={styles.hint}>
        💡 Drag to move · pull the corner ⤡ to resize · اسحب للتحريك واسحب الركن للتكبير
      </Text>

      {/* page navigation */}
      <View style={styles.nav}>
        <Pressable disabled={page === 0} onPress={() => (setPage((p) => p - 1), setSelected(null))} style={[styles.navBtn, page === 0 && { opacity: 0.3 }]}>
          <Text style={styles.navText}>‹ Prev</Text>
        </Pressable>
        <Text style={styles.pageNo}>
          Page {page + 1} / {pages || '…'}
          {countOn(page) ? `  ·  ${countOn(page)} item${countOn(page) > 1 ? 's' : ''}` : ''}
        </Text>
        <Pressable disabled={page >= pages - 1} onPress={() => (setPage((p) => p + 1), setSelected(null))} style={[styles.navBtn, page >= pages - 1 && { opacity: 0.3 }]}>
          <Text style={styles.navText}>Next ›</Text>
        </Pressable>
      </View>

      {/* page + overlay */}
      <Pressable onPress={() => setSelected(null)} style={[styles.page, { width: W, height: H }]}>
        {thumb ? (
          <Image source={{ uri: thumb.uri }} style={{ width: W, height: H }} />
        ) : (
          <ActivityIndicator style={{ marginTop: H / 2 - 10 }} color={color} />
        )}
        {thumb &&
          onPage.map((it) => (
            <ItemView
              key={it.id}
              item={it}
              W={W}
              H={H}
              selected={it.id === selected}
              accent={color}
              onSelect={() => setSelected(it.id)}
              onDragging={onDragging}
              onMove={(patch) => onChange(itemsRef.current.map((i) => (i.id === it.id ? { ...i, ...patch } : i)))}
            />
          ))}
        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color="#fff" size="large" />
          </View>
        )}
      </Pressable>

      {/* actions for the selected item */}
      {sel && (
        <View style={styles.selBar}>
          {sel.kind === 'text' && sel.text && (
            <SelBtn label="✏️ Edit" onPress={() => setTextEdit({ id: sel.id, ...sel.text! })} />
          )}
          {pages > 1 && <SelBtn label="📑 All pages" onPress={copyToAllPages} />}
          <SelBtn
            label="🗑 Delete"
            danger
            onPress={() => {
              onChange(itemsRef.current.filter((i) => i.id !== sel.id));
              setSelected(null);
            }}
          />
        </View>
      )}
      {items.length > 0 && (
        <Text style={styles.summary}>
          {items.length} item{items.length > 1 ? 's' : ''} on {new Set(items.map((i) => i.page)).size} page
          {new Set(items.map((i) => i.page)).size > 1 ? 's' : ''}
        </Text>
      )}

      <SignatureSheet
        visible={sigOpen}
        onClose={() => setSigOpen(false)}
        onPick={(s) => {
          setSigOpen(false);
          place({ ...s, mime: 'image/png' }, 'signature');
        }}
      />

      {/* add / edit text */}
      <Modal visible={!!textEdit} transparent animationType="slide" onRequestClose={() => setTextEdit(null)}>
        <View style={styles.sheetBg}>
          <Pressable style={{ flex: 1 }} onPress={() => setTextEdit(null)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{textEdit?.id ? 'Edit text' : 'Add text'} · إضافة كلام</Text>
            <TextInput
              style={styles.input}
              value={textEdit?.value ?? ''}
              onChangeText={(value) => setTextEdit((t) => (t ? { ...t, value } : t))}
              placeholder="Type anything — Arabic or English"
              placeholderTextColor={theme.muted}
              multiline
              autoFocus
              maxLength={300}
            />
            <View style={styles.row}>
              {TEXT_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setTextEdit((t) => (t ? { ...t, color: c } : t))}
                  style={[styles.swatch, { backgroundColor: c }, textEdit?.color === c && { borderColor: color }]}
                />
              ))}
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => setTextEdit((t) => (t ? { ...t, bold: !t.bold } : t))}
                style={[styles.boldBtn, textEdit?.bold && { backgroundColor: color, borderColor: color }]}
              >
                <Text style={[styles.boldText, textEdit?.bold && { color: '#fff' }]}>B</Text>
              </Pressable>
            </View>
            <Pressable
              style={[styles.primary, { backgroundColor: color }, (!textEdit?.value.trim() || busy) && { opacity: 0.4 }]}
              disabled={!textEdit?.value.trim() || busy}
              onPress={saveText}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{textEdit?.id ? 'Update' : 'Add to page'}</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** One placed item: drag body to move, drag the corner handle to resize (keeps proportions). */
function ItemView({
  item,
  W,
  H,
  selected,
  accent,
  onSelect,
  onMove,
  onDragging,
}: {
  item: EditItem;
  W: number;
  H: number;
  selected: boolean;
  accent: string;
  onSelect: () => void;
  onMove: (p: Partial<EditItem>) => void;
  onDragging: (d: boolean) => void;
}) {
  const latest = useRef({ item, W, H, onMove, onSelect, onDragging });
  latest.current = { item, W, H, onMove, onSelect, onDragging };
  const [live, setLive] = useState<Partial<EditItem> | null>(null); // smooth drag without re-rendering parent

  const responder = (kind: 'move' | 'resize') => {
    let start: EditItem;
    let last: Partial<EditItem> = {};
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start = latest.current.item;
        last = {};
        latest.current.onSelect();
        latest.current.onDragging(true);
      },
      onPanResponderMove: (_, g) => {
        const { W, H } = latest.current;
        if (kind === 'move') {
          last = {
            x: Math.max(-start.w * 0.5, Math.min(1 - start.w * 0.5, start.x + g.dx / W)),
            y: Math.max(-start.h * 0.5, Math.min(1 - start.h * 0.5, start.y + g.dy / H)),
          };
        } else {
          const w = Math.max(0.06, Math.min(1.2, start.w + g.dx / W));
          last = { w, h: start.h * (w / start.w) };
        }
        setLive(last);
      },
      onPanResponderRelease: () => {
        latest.current.onDragging(false);
        if (Object.keys(last).length) latest.current.onMove(last);
        setLive(null);
      },
      onPanResponderTerminate: () => {
        latest.current.onDragging(false);
        setLive(null);
      },
    });
  };
  const moveR = useMemo(() => responder('move'), []);
  const sizeR = useMemo(() => responder('resize'), []);

  const it = { ...item, ...live };
  return (
    <View
      {...moveR.panHandlers}
      style={{
        position: 'absolute',
        left: it.x * W,
        top: it.y * H,
        width: it.w * W,
        height: it.h * H,
        borderWidth: selected ? 2 : 0,
        borderColor: accent,
        borderStyle: 'dashed',
      }}
    >
      <Image source={{ uri: `data:${item.mime};base64,${item.base64}` }} style={{ width: '100%', height: '100%' }} resizeMode="stretch" />
      {selected && (
        <View
          {...sizeR.panHandlers}
          hitSlop={{ top: 16, left: 16, right: 16, bottom: 16 }}
          style={{
            position: 'absolute',
            right: -14,
            bottom: -14,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: accent,
            borderWidth: 3,
            borderColor: '#fff',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>⤡</Text>
        </View>
      )}
    </View>
  );
}

function ToolBtn({ icon, label, onPress, accent }: { icon: string; label: string; onPress: () => void; accent?: string }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.tool, accent && { borderColor: accent, backgroundColor: accent + '14' }]}>
      <Text style={[styles.toolIcon, icon === 'T' && { fontWeight: '900' }]}>{icon}</Text>
      <Text style={styles.toolLabel}>{label}</Text>
    </Pressable>
  );
}

function SelBtn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={styles.selBtn}>
      <Text style={[styles.selText, danger && { color: '#C0392B' }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    tools: { flexDirection: 'row', gap: 10 },
    tool: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14, borderWidth: 2, borderColor: t.border, backgroundColor: t.card },
    toolIcon: { fontSize: 22, color: t.text },
    toolLabel: { fontSize: 13, fontWeight: '700', color: t.text, marginTop: 4 },
    hint: { fontSize: 12, color: t.muted, marginTop: 8, textAlign: 'center' },
    nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 },
    navBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: t.border, backgroundColor: t.card },
    navText: { fontWeight: '700', color: t.text },
    pageNo: { fontWeight: '700', color: t.sub, fontSize: 13 },
    page: { alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 4, overflow: 'visible', elevation: 2, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6 },
    busy: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
    selBar: { flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'center', flexWrap: 'wrap' },
    selBtn: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    selText: { fontWeight: '700', color: t.text },
    summary: { textAlign: 'center', color: t.muted, fontSize: 12, marginTop: 8 },
    sheetBg: { flex: 1, backgroundColor: t.overlay },
    sheet: { backgroundColor: t.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 34 },
    sheetTitle: { fontSize: 18, fontWeight: '800', color: t.text, marginBottom: 12 },
    input: { borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 12, fontSize: 17, minHeight: 80, color: t.text, textAlignVertical: 'top', textAlign: 'auto' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
    swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: t.card },
    boldBtn: { width: 40, height: 36, borderRadius: 10, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
    boldText: { fontWeight: '900', fontSize: 17, color: t.text },
    primary: { marginTop: 16, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
    primaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  });
