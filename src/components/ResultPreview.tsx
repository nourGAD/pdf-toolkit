import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import PdfThumbnail from 'react-native-pdf-thumbnail';
import { File } from 'expo-file-system';
import { ToolResult } from '../tools';

const MAX_PREVIEW = 60;

/** Shows the output BEFORE the user saves/shares it. */
export default function ResultPreview({
  result,
  color,
  onShare,
  onOpenReader,
  onAgain,
}: {
  result: ToolResult;
  color: string;
  onShare: () => void;
  onOpenReader?: () => void;
  onAgain: () => void;
}) {
  const isPdf = result.mimeType === 'application/pdf';
  const [images, setImages] = useState<string[] | null>(result.previewImages ?? null);
  const [total, setTotal] = useState<number | null>(result.previewImages?.length ?? null);
  const [zoom, setZoom] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const size = (width - 40 - 20) / 3;

  useEffect(() => {
    if (!isPdf) return;
    let alive = true;
    PdfThumbnail.generateAllPages(result.uri, { quality: 60, maxWidth: 300, maxHeight: 420 })
      .then((r) => {
        if (!alive) return;
        setTotal(r.length);
        setImages(r.slice(0, MAX_PREVIEW).map((t) => t.uri));
      })
      .catch(() => alive && setImages([]));
    return () => {
      alive = false;
    };
  }, [result.uri, isPdf]);

  const sizeKb = (() => {
    try {
      const b = new File(result.uri).size ?? 0;
      return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
    } catch {
      return '';
    }
  })();

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>✅ Ready — check it before saving</Text>
      <Text style={styles.meta} numberOfLines={1}>
        {result.label}
        {total != null ? `  ·  ${total} ${isPdf ? 'page' : 'image'}${total === 1 ? '' : 's'}` : ''}
        {sizeKb ? `  ·  ${sizeKb}` : ''}
      </Text>

      {images === null ? (
        <ActivityIndicator style={{ marginVertical: 24 }} color={color} />
      ) : images.length ? (
        <FlatList
          data={images}
          keyExtractor={(u, i) => u + i}
          numColumns={3}
          scrollEnabled={false}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ gap: 10, marginTop: 12 }}
          renderItem={({ item, index }) => (
            <Pressable onPress={() => setZoom(item)} style={[styles.cell, { width: size }]}>
              <Image source={{ uri: item }} style={{ width: '100%', height: size * 1.3 }} resizeMode="contain" />
              <Text style={styles.no}>{index + 1}</Text>
            </Pressable>
          )}
        />
      ) : (
        <Text style={styles.noPreview}>📦 Preview not available for this file type.</Text>
      )}
      {total != null && total > MAX_PREVIEW && (
        <Text style={styles.more}>+ {total - MAX_PREVIEW} more pages — open it in the reader to see everything.</Text>
      )}

      <Pressable style={[styles.cta, { backgroundColor: color }]} onPress={onShare}>
        <Text style={styles.ctaText}>Save / Share</Text>
      </Pressable>
      <View style={styles.row}>
        {isPdf && onOpenReader && (
          <Pressable style={styles.secondary} onPress={onOpenReader}>
            <Text style={styles.secondaryText}>📖 Open in reader</Text>
          </Pressable>
        )}
        <Pressable style={styles.secondary} onPress={onAgain}>
          <Text style={styles.secondaryText}>↺ Start over</Text>
        </Pressable>
      </View>

      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable style={styles.zoomBg} onPress={() => setZoom(null)}>
          {zoom && <Image source={{ uri: zoom }} style={styles.zoomImg} resizeMode="contain" />}
          <Text style={styles.zoomHint}>Tap to close</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24, backgroundColor: '#fff', borderRadius: 18, padding: 16 },
  title: { fontSize: 18, fontWeight: '800', color: '#1B1E28' },
  meta: { fontSize: 13, color: '#8A8F9C', marginTop: 4 },
  cell: { backgroundColor: '#EEF0F4', borderRadius: 10, padding: 4, alignItems: 'center' },
  no: { fontSize: 12, fontWeight: '700', color: '#5B6170', marginTop: 2 },
  noPreview: { color: '#8A8F9C', marginVertical: 16 },
  more: { color: '#8A8F9C', marginTop: 10, fontSize: 13 },
  cta: { marginTop: 18, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  secondary: { flex: 1, borderWidth: 1, borderColor: '#E1E4EC', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600', color: '#1B1E28' },
  zoomBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  zoomImg: { width: '94%', height: '84%' },
  zoomHint: { color: '#AAB0BC', marginTop: 12 },
});
