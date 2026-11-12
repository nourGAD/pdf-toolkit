import { File, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import { Incoming, type IncomingItem } from '../../modules/doc-scanner';
import { PickedFile } from './files';

export type IncomingAction = { type: 'scan' } | { type: 'file'; item: IncomingItem };

export function parseIncoming(item: IncomingItem | null | undefined): IncomingAction | null {
  if (!item?.uri) return null;
  if (item.uri.startsWith('pdftoolkit://scan')) return { type: 'scan' };
  if (item.uri.startsWith('content://') || item.uri.startsWith('file://')) return { type: 'file', item };
  return null;
}

export const getInitialIncoming = (): IncomingAction | null => {
  try {
    return parseIncoming(Incoming?.getInitial());
  } catch {
    return null;
  }
};

export function onIncoming(cb: (a: IncomingAction) => void): () => void {
  const sub = Incoming?.addListener('onIncoming', (item) => {
    const a = parseIncoming(item);
    if (a) cb(a);
  });
  return () => sub?.remove();
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Copy the shared/opened file into the app cache (content:// URIs can't be read later) and work out its type. */
export async function importIncoming(item: IncomingItem): Promise<PickedFile> {
  const tmp = new File(Paths.cache, `incoming_${Date.now()}`);
  await copyAsync({ from: item.uri, to: tmp.uri });

  let name = (item.name ?? '').trim();
  let mime = item.mimeType ?? undefined;
  const lower = name.toLowerCase();
  let ext = lower.endsWith('.pdf') ? 'pdf' : lower.endsWith('.docx') ? 'docx' : '';
  if (!ext) ext = mime === 'application/pdf' ? 'pdf' : mime === DOCX ? 'docx' : '';
  if (!ext) {
    // no name / generic type → look at the first bytes: "%PDF" or a ZIP header (docx)
    const h = tmp.open();
    const b = await h.readBytes(4);
    h.close();
    ext = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 ? 'pdf' : b[0] === 0x50 && b[1] === 0x4b ? 'docx' : '';
  }
  if (!ext) {
    tmp.delete();
    throw new Error('This file type is not supported. PDF Toolkit opens PDF and Word (.docx) files.');
  }
  if (!name) name = `Document.${ext}`;
  if (!name.toLowerCase().endsWith(`.${ext}`)) name += `.${ext}`;
  mime = ext === 'pdf' ? 'application/pdf' : DOCX;

  const dest = new File(Paths.cache, `${Date.now()}_${name.replace(/[^\w.؀-ۿ -]+/g, '_')}`);
  await tmp.move(dest);
  return { uri: dest.uri, name, mimeType: mime };
}
