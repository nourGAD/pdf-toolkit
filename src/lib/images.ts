import { Alert, Image, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { PickedFile } from './files';
import { DocScanner } from '../../modules/doc-scanner';

export type ScanResult = {
  files: PickedFile[];
  /** true when photos came from the plain camera → open the 4-corner crop for each */
  needsCrop: boolean;
};

/**
 * CamScanner-style capture.
 * Android: Google ML Kit Document Scanner (auto edges, crop, filters, gallery import) via our own module.
 * Fallback (iOS, or phones without Google Play services): normal camera + our 4-corner crop.
 */
export async function scanDocuments(): Promise<ScanResult> {
  if (Platform.OS === 'android' && DocScanner) {
    try {
      const paths = await DocScanner.scan(0, true);
      return { files: toFiles(paths, 'scan'), needsCrop: false };
    } catch (e: any) {
      // tell the user why (and help us debug), then offer the normal camera + 4-corner crop
      const useCamera = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Smart scanner not available',
          `${e?.message ?? String(e)}\n\nYou can use the normal camera and set the 4 corners yourself.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Use camera', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        ),
      );
      if (!useCamera) return { files: [], needsCrop: false };
    }
  }
  return { files: await takePhoto(), needsCrop: true };
}

async function takePhoto(): Promise<PickedFile[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted)
    throw new Error(
      perm.canAskAgain
        ? 'Allow camera access to scan documents · اسمح باستخدام الكاميرا'
        : 'Camera access is turned off for this app. Open Settings → Apps → PDF Toolkit → Permissions → Camera → Allow.',
    );
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
  if (res.canceled) return [];
  return toFiles(res.assets.map((a) => a.uri), 'photo');
}

function toFiles(paths: string[], prefix: string): PickedFile[] {
  const stamp = Date.now();
  return paths.map((p, i) => ({
    uri: p.startsWith('file://') || p.startsWith('content://') ? p : `file://${p}`,
    name: `${prefix}_${stamp}_${i + 1}.jpg`,
    mimeType: 'image/jpeg',
  }));
}

export function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
}

export async function rotateImage(img: PickedFile, degrees: number): Promise<PickedFile> {
  const r = await manipulateAsync(img.uri, [{ rotate: degrees }], { compress: 0.92, format: SaveFormat.JPEG });
  return { uri: r.uri, name: img.name.replace(/\.\w+$/, '') + '.jpg', mimeType: 'image/jpeg' };
}

export type CompressLevel = 'strong' | 'medium' | 'light';
export const COMPRESS_LEVELS: Record<CompressLevel, { maxSide: number; quality: number; label: string; labelAr: string; hint: string }> = {
  strong: { maxSide: 1280, quality: 0.5, label: 'Strong', labelAr: 'ضغط عالي', hint: 'Smallest size — WhatsApp, email, uploads' },
  medium: { maxSide: 1920, quality: 0.65, label: 'Medium', labelAr: 'متوسط', hint: 'Good balance of size and quality' },
  light: { maxSide: 2560, quality: 0.8, label: 'Light', labelAr: 'خفيف', hint: 'Almost no visible quality loss' },
};

export const fileSize = (uri: string) => {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
};

/** Resize (long side) + re-encode as JPEG. Keeps the original if compressing wouldn't make it smaller. */
export async function compressImage(img: PickedFile, level: CompressLevel): Promise<{ uri: string; before: number; after: number }> {
  const { maxSide, quality } = COMPRESS_LEVELS[level];
  const before = fileSize(img.uri);
  const { width, height } = await imageSize(img.uri);
  const k = Math.min(1, maxSide / Math.max(width, height));
  const r = await manipulateAsync(
    img.uri,
    k < 1 ? [{ resize: { width: Math.round(width * k), height: Math.round(height * k) } }] : [],
    { compress: quality, format: SaveFormat.JPEG },
  );
  const after = fileSize(r.uri);
  return after > 0 && after < before ? { uri: r.uri, before, after } : { uri: img.uri, before, after: before };
}

export const formatBytes = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
