import { Image, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
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
    } catch (e) {
      console.warn('ML Kit scanner unavailable, falling back to camera', e);
    }
  }
  return { files: await takePhoto(), needsCrop: true };
}

async function takePhoto(): Promise<PickedFile[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Allow camera access to scan documents · اسمح باستخدام الكاميرا');
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
