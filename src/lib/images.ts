import { Image } from 'react-native';
import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from 'react-native-document-scanner-plugin';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { PickedFile } from './files';

/**
 * CamScanner-style capture: auto edge detection, crop, perspective fix and filters.
 * Android: Google ML Kit Document Scanner (also lets the user import from gallery).
 * iOS: Apple VisionKit. Both run on-device and are free.
 */
export async function scanDocuments(): Promise<PickedFile[]> {
  const res = await DocumentScanner.scanDocument({
    croppedImageQuality: 92,
    responseType: ResponseType.ImageFilePath,
  });
  if (res.status === ScanDocumentResponseStatus.Cancel || !res.scannedImages?.length) return [];
  const stamp = Date.now();
  return res.scannedImages.map((p, i) => ({
    uri: p.startsWith('file://') || p.startsWith('content://') ? p : `file://${p}`,
    name: `scan_${stamp}_${i + 1}.jpg`,
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

/** rect is in the image's real pixel coordinates */
export async function cropImage(
  img: PickedFile,
  rect: { originX: number; originY: number; width: number; height: number },
): Promise<PickedFile> {
  const r = await manipulateAsync(img.uri, [{ crop: rect }], { compress: 0.92, format: SaveFormat.JPEG });
  return { uri: r.uri, name: img.name.replace(/\.\w+$/, '') + '.jpg', mimeType: 'image/jpeg' };
}
