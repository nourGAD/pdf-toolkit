import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PickedFile } from '../lib/files';
import { cropImage, imageSize, rotateImage } from '../lib/images';

type Rect = { x: number; y: number; w: number; h: number };
type Corner = 'tl' | 'tr' | 'bl' | 'br' | 'move';
const MIN = 40;
const HANDLE = 28;

/** Simple crop + rotate editor: drag the corners, or drag inside the box to move it. */
export default function CropModal({
  image,
  onDone,
  onCancel,
}: {
  image: PickedFile | null;
  onDone: (img: PickedFile) => void;
  onCancel: () => void;
}) {
  const [img, setImg] = useState<PickedFile | null>(image);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setImg(image), [image]);
  useEffect(() => {
    setNatural(null);
    setRect(null);
    if (img) imageSize(img.uri).then(setNatural).catch(() => setNatural(null));
  }, [img]);

  // where the image is drawn inside the container (contain)
  const frame = useMemo(() => {
    if (!natural || !box) return null;
    const s = Math.min(box.w / natural.width, box.h / natural.height);
    const w = natural.width * s;
    const h = natural.height * s;
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h, scale: s };
  }, [natural, box]);

  useEffect(() => {
    if (frame) setRect({ x: frame.x + frame.w * 0.06, y: frame.y + frame.h * 0.06, w: frame.w * 0.88, h: frame.h * 0.88 });
  }, [frame]);

  const rectRef = useRef(rect);
  rectRef.current = rect;
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const responder = (corner: Corner) => {
    let start: Rect;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        start = rectRef.current!;
      },
      onPanResponderMove: (_, g) => {
        const f = frameRef.current!;
        let { x, y, w, h } = start;
        if (corner === 'move') {
          x = clamp(start.x + g.dx, f.x, f.x + f.w - w);
          y = clamp(start.y + g.dy, f.y, f.y + f.h - h);
        } else {
          const right = start.x + start.w;
          const bottom = start.y + start.h;
          if (corner === 'tl' || corner === 'bl') {
            x = clamp(start.x + g.dx, f.x, right - MIN);
            w = right - x;
          } else w = clamp(start.w + g.dx, MIN, f.x + f.w - start.x);
          if (corner === 'tl' || corner === 'tr') {
            y = clamp(start.y + g.dy, f.y, bottom - MIN);
            h = bottom - y;
          } else h = clamp(start.h + g.dy, MIN, f.y + f.h - start.y);
        }
        setRect({ x, y, w, h });
      },
    });
  };
  const handles = useMemo(
    () => ({
      tl: responder('tl'),
      tr: responder('tr'),
      bl: responder('bl'),
      br: responder('br'),
      move: responder('move'),
    }),
    [],
  );

  async function rotate() {
    if (!img) return;
    setBusy(true);
    try {
      setImg(await rotateImage(img, 90));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!img || !rect || !frame || !natural) return;
    setBusy(true);
    try {
      const s = 1 / frame.scale;
      const originX = Math.max(0, Math.round((rect.x - frame.x) * s));
      const originY = Math.max(0, Math.round((rect.y - frame.y) * s));
      const width = Math.min(natural.width - originX, Math.round(rect.w * s));
      const height = Math.min(natural.height - originY, Math.round(rect.h * s));
      onDone(await cropImage(img, { originX, originY, width, height }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={!!image} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.root}>
        <View style={styles.top}>
          <Pressable onPress={onCancel} hitSlop={10}>
            <Text style={styles.topBtn}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Crop</Text>
          <Pressable onPress={apply} hitSlop={10} disabled={busy}>
            <Text style={[styles.topBtn, { fontWeight: '800' }]}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.stage} onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {img && frame && (
            <Image source={{ uri: img.uri }} style={{ position: 'absolute', left: frame.x, top: frame.y, width: frame.w, height: frame.h }} />
          )}
          {rect && frame && (
            <>
              {/* dim outside the crop box */}
              <View style={[styles.dim, { left: 0, right: 0, top: 0, height: rect.y }]} />
              <View style={[styles.dim, { left: 0, right: 0, top: rect.y + rect.h, bottom: 0 }]} />
              <View style={[styles.dim, { left: 0, width: rect.x, top: rect.y, height: rect.h }]} />
              <View style={[styles.dim, { left: rect.x + rect.w, right: 0, top: rect.y, height: rect.h }]} />
              <View {...handles.move.panHandlers} style={[styles.box, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]}>
                <View style={[styles.grid, { left: '33.3%' }]} />
                <View style={[styles.grid, { left: '66.6%' }]} />
                <View style={[styles.gridH, { top: '33.3%' }]} />
                <View style={[styles.gridH, { top: '66.6%' }]} />
              </View>
              {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                <View
                  key={c}
                  {...handles[c].panHandlers}
                  hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                  style={[
                    styles.handle,
                    {
                      left: (c[1] === 'l' ? rect.x : rect.x + rect.w) - HANDLE / 2,
                      top: (c[0] === 't' ? rect.y : rect.y + rect.h) - HANDLE / 2,
                    },
                  ]}
                />
              ))}
            </>
          )}
          {(busy || !frame) && (
            <View style={styles.busy}>
              <ActivityIndicator color="#fff" size="large" />
            </View>
          )}
        </View>

        <View style={styles.bottom}>
          <Text style={styles.hint}>Drag the corners to fit the document · اسحب الأركان</Text>
          <Pressable onPress={rotate} style={styles.rotate} disabled={busy}>
            <Text style={styles.rotateText}>⟳ Rotate</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 48 },
  topBtn: { color: '#5AB4FF', fontSize: 17 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  stage: { flex: 1, margin: 16 },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  box: { position: 'absolute', borderWidth: 2, borderColor: '#fff' },
  grid: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.5)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.5)' },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: '#1F8FE5',
    borderWidth: 3,
    borderColor: '#fff',
  },
  busy: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  bottom: { padding: 16, paddingBottom: 36, alignItems: 'center', gap: 12 },
  hint: { color: '#AAB0BC', fontSize: 13 },
  rotate: { borderWidth: 1, borderColor: '#555', borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 },
  rotateText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
