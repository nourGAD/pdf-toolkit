import { Directory, File, Paths } from 'expo-file-system';
import { PickedFile } from './files';

/**
 * Local "library": PDFs the user opened in the reader, with last page + bookmarks.
 * Stored as JSON in the app's documents folder — offline, nothing synced.
 */
export type Bookmark = { id: string; page: number; label: string; createdAt: number };
export type LibraryDoc = {
  id: string;
  name: string;
  uri: string; // copy inside app storage (picker cache can be wiped by the OS)
  pages: number;
  lastPage: number;
  openedAt: number;
  bookmarks: Bookmark[];
};

const dir = () => {
  const d = new Directory(Paths.document, 'library');
  if (!d.exists) d.create({ intermediates: true });
  return d;
};
const indexFile = () => new File(dir(), 'index.json');

let cache: LibraryDoc[] | null = null;

export async function loadLibrary(): Promise<LibraryDoc[]> {
  if (cache) return cache;
  const f = indexFile();
  try {
    cache = f.exists ? (JSON.parse(await f.text()) as LibraryDoc[]) : [];
  } catch {
    cache = [];
  }
  // drop entries whose file was removed
  cache = cache.filter((d) => new File(d.uri).exists);
  return cache;
}

function persist() {
  const f = indexFile();
  if (!f.exists) f.create();
  f.write(JSON.stringify(cache ?? []));
}

export async function recentDocs(): Promise<LibraryDoc[]> {
  return [...(await loadLibrary())].sort((a, b) => b.openedAt - a.openedAt);
}

/**
 * Add a picked PDF to the library (or return the existing entry for the same file).
 * move=true: the file is a temporary picker copy → move it (instant, no extra copy of a big file).
 */
export async function openInLibrary(file: PickedFile, move = false): Promise<LibraryDoc> {
  const lib = await loadLibrary();
  const src = new File(file.uri);
  const id = `${file.name}_${src.size ?? 0}`.replace(/[^\w.-]+/g, '_');
  const existing = lib.find((d) => d.id === id);
  if (existing) {
    existing.openedAt = Date.now();
    persist();
    return existing;
  }
  const dest = new File(dir(), `${id}.pdf`);
  if (!dest.exists) {
    if (move) {
      try {
        await src.move(dest);
      } catch {
        await src.copy(dest); // different storage volume → fall back to copy
      }
    } else await src.copy(dest);
  }
  const doc: LibraryDoc = {
    id,
    name: file.name,
    uri: dest.uri,
    pages: 0,
    lastPage: 1,
    openedAt: Date.now(),
    bookmarks: [],
  };
  lib.push(doc);
  persist();
  return doc;
}

export async function updateDoc(id: string, patch: Partial<Omit<LibraryDoc, 'id'>>) {
  const lib = await loadLibrary();
  const d = lib.find((x) => x.id === id);
  if (!d) return;
  Object.assign(d, patch);
  persist();
}

export async function addBookmark(id: string, page: number, label: string): Promise<Bookmark[]> {
  const lib = await loadLibrary();
  const d = lib.find((x) => x.id === id);
  if (!d) return [];
  d.bookmarks = [
    ...d.bookmarks.filter((b) => b.page !== page), // one bookmark per page
    { id: `${Date.now()}`, page, label: label.trim() || `Page ${page}`, createdAt: Date.now() },
  ].sort((a, b) => a.page - b.page);
  persist();
  return d.bookmarks;
}

export async function removeBookmark(id: string, bookmarkId: string): Promise<Bookmark[]> {
  const lib = await loadLibrary();
  const d = lib.find((x) => x.id === id);
  if (!d) return [];
  d.bookmarks = d.bookmarks.filter((b) => b.id !== bookmarkId);
  persist();
  return d.bookmarks;
}

export async function removeDoc(id: string) {
  const lib = await loadLibrary();
  const d = lib.find((x) => x.id === id);
  if (!d) return;
  const f = new File(d.uri);
  if (f.exists) f.delete();
  cache = lib.filter((x) => x.id !== id);
  persist();
}
