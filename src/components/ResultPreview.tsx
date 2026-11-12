import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import PdfThumbnail from 'react-native-pdf-thumbnail';
import { File } from 'expo-file-system';
import { ToolResult } from '../tools';
import { saveImagesToGallery } from '../lib/gallery';
import { saveOutput, shareFile } from '../lib/files';
import { zipFiles } from '../lib/pdf';
import { Theme, useStyles, useTheme } from '../theme';

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
  const styles = useStyles(makeStyles);
  const isPdf = result.mimeType === 'application/pdf';
  const isDocx = /wordprocessingml/.test(result.mimeType);
  const [copied, setCopied] = useState(false);
  const isPhotos = !!result.images;
  const [images, setImages] = useState<string[] | null>(result.previewImages ?? (isPdf ? null : []));
  const [total, setTotal] = useState<number | null>(result.previewImages?.length ?? null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const photos = result.images;

  async function saveToGallery() {
    if (!photos) return;
    setSaving(true);
    try {
      setSavedCount(await saveImagesToGallery(photos));
    } catch (e: any) {
      Alert.alert('Could not save to Gallery', e?.message ?? String(e), [
        { text: 'OK', style: 'cancel' },
        photos.length === 1
          ? { text: 'Share instead', onPress: () => shareFile(photos[0].uri, 'image/jpeg').catch(() => {}) }
          : { text: 'Share as ZIP', onPress: () => shareZip() },
      ]);
    } finally {
      setSaving(false);
    }
  }

  async function shareZip() {
    if (!photos) return;
    setSaving(true);
    try {
      const uri = saveOutput(await zipFiles(photos), result.label.replace(/\W+/g, '_') + '.zip');
      await shareFile(uri, 'application/zip');
    } catch (e: any) {
      Alert.alert('Share failed', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }
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
      if (result.mimeType === 'text/plain') return '';
      const b = isPhotos
        ? (result.images ?? []).reduce((t, i) => t + (new File(i.uri).size ?? 0), 0)
        : (new File(result.uri).size ?? 0);
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

      {result.text != null && (
        <View style={styles.textBox}>
          <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled>
            <Text selectable style={styles.text}>
              {result.text.trim() || '(no text found)'}
            </Text>
          </ScrollView>
          <View style={styles.row}>
            <Pressable
              style={styles.secondary}
              onPress={async () => {
                await Clipboard.setStringAsync(result.text ?? '');
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
            >
              <Text style={styles.secondaryText}>{copied ? '✓ Copied' : '📋 Copy text'}</Text>
            </Pressable>
            {result.textUri && (
              <Pressable style={styles.secondary} onPress={() => shareFile(result.textUri!, 'text/plain').catch(() => {})}>
                <Text style={styles.secondaryText}>📄 Share .txt</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

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
      ) : result.text != null ? null : (
        <Text style={styles.noPreview}>{isDocx ? '📝 Word document ready — open it to check.' : '📦 Preview not available for this file type.'}</Text>
      )}
      {total != null && total > MAX_PREVIEW && (
        <Text style={styles.more}>+ {total - MAX_PREVIEW} more pages — open it in the reader to see everything.</Text>
      )}

      {photos ? (
        <>
          <Pressable
            style={[styles.cta, { backgroundColor: savedCount != null ? '#2BA84A' : color }]}
            onPress={saveToGallery}
            disabled={saving || savedCount != null}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>
                {savedCount != null
                  ? `✓ ${savedCount} photo${savedCount === 1 ? '' : 's'} saved to your Gallery`
                  : `💾 Save ${photos.length} photo${photos.length === 1 ? '' : 's'} to Gallery`}
              </Text>
            )}
          </Pressable>
          <Text style={styles.tip}>Tap any photo to view or share it alone · دوس على أي صورة عشان تبعتها لوحدها</Text>
        </>
      ) : result.uri && result.mimeType !== 'text/plain' ? (
        <Pressable style={[styles.cta, { backgroundColor: color }]} onPress={onShare}>
          <Text style={styles.ctaText}>Save / Share</Text>
        </Pressable>
      ) : null}
      <View style={styles.row}>
        {photos && photos.length > 1 && (
          <Pressable style={styles.secondary} onPress={shareZip} disabled={saving}>
            <Text style={styles.secondaryText}>📦 Share as ZIP</Text>
          </Pressable>
        )}
        {(isPdf || isDocx) && onOpenReader && (
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
          {zoom && photos && (
            <Pressable
              style={styles.zoomShare}
              onPress={() => {
                const p = photos.find((x) => x.uri === zoom);
                if (p) shareFile(p.uri, 'image/jpeg').catch((e) => Alert.alert('Share failed', e.message));
              }}
            >
              <Text style={styles.zoomShareText}>Share this photo</Text>
            </Pressable>
          )}
          <Text style={styles.zoomHint}>Tap outside to close</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  textBox: { marginTop: 12, borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 12, backgroundColor: t.bg },
  text: { fontSize: 15, lineHeight: 23, color: t.text, writingDirection: 'auto', textAlign: 'auto' } as any,
  wrap: { marginTop: 24, backgroundColor: t.card, borderRadius: 18, padding: 16 },
  title: { fontSize: 18, fontWeight: '800', color: t.text },
  meta: { fontSize: 13, color: t.muted, marginTop: 4 },
  cell: { backgroundColor: t.card2, borderRadius: 10, padding: 4, alignItems: 'center' },
  no: { fontSize: 12, fontWeight: '700', color: t.sub, marginTop: 2 },
  noPreview: { color: t.muted, marginVertical: 16 },
  more: { color: t.muted, marginTop: 10, fontSize: 13 },
  cta: { marginTop: 18, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  secondary: { flex: 1, borderWidth: 1, borderColor: t.border, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600', color: t.text },
  zoomBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  zoomImg: { width: '94%', height: '84%' },
  zoomHint: { color: '#AAB0BC', marginTop: 12 },
  zoomShare: { marginTop: 14, backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 },
  zoomShareText: { fontWeight: '800', color: t.text },
  tip: { fontSize: 12, color: t.muted, marginTop: 8, textAlign: 'center' },
});
