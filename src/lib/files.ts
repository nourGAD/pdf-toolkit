import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';

export type PickedFile = { uri: string; name: string; mimeType?: string };

/** Pick one or more PDFs. Files are copied to the app cache so we can read them offline. */
export async function pickPdfs(multiple: boolean): Promise<PickedFile[]> {
  const res = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    multiple,
    copyToCacheDirectory: true,
  });
  if (res.canceled) return [];
  return res.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined }));
}

/** Pick images from the gallery (JPG/PNG). */
export async function pickImages(): Promise<PickedFile[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    quality: 0.9,
  });
  if (res.canceled) return [];
  return res.assets.map((a, i) => ({
    uri: a.uri,
    name: a.fileName ?? `image_${i + 1}.jpg`,
    mimeType: a.mimeType ?? 'image/jpeg',
  }));
}

export async function readBytes(uri: string): Promise<Uint8Array> {
  return new File(uri).bytes();
}

/** Output folder inside the app's documents directory. */
function outputDir(): Directory {
  const dir = new Directory(Paths.document, 'output');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Save bytes to the output folder and return the new file URI. */
export function saveOutput(bytes: Uint8Array, fileName: string): string {
  const file = new File(outputDir(), uniqueName(fileName));
  file.create({ overwrite: true });
  file.write(bytes);
  return file.uri;
}

export async function shareFile(uri: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, { mimeType });
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function uniqueName(fileName: string): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? `${fileName.slice(0, dot)}_${stamp}${fileName.slice(dot)}` : `${fileName}_${stamp}`;
}
