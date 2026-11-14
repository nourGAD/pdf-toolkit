import { File, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import JSZip from 'jszip';
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
export const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: DOCX,
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
};
const BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  [DOCX]: 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'text/comma-separated-values': 'csv',
  'application/csv': 'csv',
};
export const extOf = (name: string) => (name.toLowerCase().match(/\.(pdf|docx|xlsx|xlsm|xls|csv)$/)?.[1] ?? '').replace('xlsm', 'xlsx');

/** Copy the shared/opened file into the app cache (content:// URIs can't be read later) and work out its type. */
export async function importIncoming(item: IncomingItem): Promise<PickedFile> {
  const tmp = new File(Paths.cache, `incoming_${Date.now()}`);
  await copyAsync({ from: item.uri, to: tmp.uri });

  let name = (item.name ?? '').trim();
  let ext = extOf(name) || BY_MIME[item.mimeType ?? ''] || '';
  if (!ext) {
    // no name / generic type → look at the first bytes: "%PDF", a ZIP (docx/xlsx) or an old Office file (xls)
    const h = tmp.open();
    const b = await h.readBytes(8);
    h.close();
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) ext = 'pdf';
    else if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) ext = 'xls';
    else if (b[0] === 0x50 && b[1] === 0x4b) {
      const zip = await JSZip.loadAsync(await tmp.bytes());
      ext = zip.file('word/document.xml') ? 'docx' : zip.file('xl/workbook.xml') ? 'xlsx' : '';
    }
  }
  if (!ext) {
    tmp.delete();
    throw new Error('This file type is not supported. PDF Toolkit opens PDF, Word (.docx), Excel and CSV files.');
  }
  if (!name) name = `Document.${ext}`;
  if (!name.toLowerCase().endsWith(`.${ext}`)) name += `.${ext}`;

  const dest = new File(Paths.cache, `${Date.now()}_${name.replace(/[^\w.؀-ۿ -]+/g, '_')}`);
  await tmp.move(dest);
  return { uri: dest.uri, name, mimeType: MIME[ext] };
}
