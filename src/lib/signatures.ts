import { Directory, File, Paths } from 'expo-file-system';

/** Saved signatures (transparent PNGs) so the user draws once and reuses. Stored only on the phone. */
const dir = () => {
  const d = new Directory(Paths.document, 'signatures');
  if (!d.exists) d.create({ intermediates: true });
  return d;
};

export type SavedSignature = { id: string; uri: string };

export function listSignatures(): SavedSignature[] {
  return dir()
    .list()
    .filter((f): f is File => f instanceof File && f.name.endsWith('.png'))
    .map((f) => ({ id: f.name, uri: f.uri }))
    .sort((a, b) => b.id.localeCompare(a.id));
}

export function saveSignature(base64: string): SavedSignature {
  const f = new File(dir(), `sig_${Date.now()}.png`);
  f.create();
  f.write(base64, { encoding: 'base64' });
  return { id: f.name, uri: f.uri };
}

export function deleteSignature(id: string) {
  const f = new File(dir(), id);
  if (f.exists) f.delete();
}

export const signatureBase64 = (uri: string) => new File(uri).base64();
