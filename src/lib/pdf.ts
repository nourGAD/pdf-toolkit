import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import PdfThumbnail from 'react-native-pdf-thumbnail';
import { PickedFile, readBytes } from './files';

/**
 * All operations run 100% on-device (offline). Nothing is uploaded anywhere.
 */

async function load(file: PickedFile): Promise<PDFDocument> {
  const bytes = await readBytes(file.uri);
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

export async function pageCount(file: PickedFile): Promise<number> {
  return (await load(file)).getPageCount();
}

/**
 * Parse a human page range like "1-3, 5, 8-" into zero-based indexes.
 * Empty input = all pages.
 */
export function parseRange(input: string, total: number): number[] {
  const text = input.trim();
  if (!text) return [...Array(total).keys()];
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d*)\s*-\s*(\d*)$/);
    let from: number;
    let to: number;
    if (m) {
      from = m[1] ? parseInt(m[1], 10) : 1;
      to = m[2] ? parseInt(m[2], 10) : total;
    } else if (/^\d+$/.test(p)) {
      from = to = parseInt(p, 10);
    } else {
      throw new Error(`Invalid range: "${p}"`);
    }
    if (from < 1 || to > total || from > to) throw new Error(`Range "${p}" is outside 1–${total}`);
    for (let i = from; i <= to; i++) out.add(i - 1);
  }
  return [...out].sort((a, b) => a - b);
}

export async function mergePdfs(files: PickedFile[]): Promise<Uint8Array> {
  if (files.length < 2) throw new Error('Select at least 2 PDF files');
  const merged = await PDFDocument.create();
  for (const f of files) {
    const src = await load(f);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

/** Keep only the selected pages (extract / split). */
export async function extractPages(file: PickedFile, range: string): Promise<Uint8Array> {
  const src = await load(file);
  const indexes = parseRange(range, src.getPageCount());
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indexes);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/** Split every page into its own PDF, returned as a ZIP. */
export async function splitAllToZip(file: PickedFile, baseName: string): Promise<Uint8Array> {
  const src = await load(file);
  const zip = new JSZip();
  for (const i of src.getPageIndices()) {
    const one = await PDFDocument.create();
    const [p] = await one.copyPages(src, [i]);
    one.addPage(p);
    zip.file(`${baseName}_page_${i + 1}.pdf`, await one.save());
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function deletePages(file: PickedFile, range: string): Promise<Uint8Array> {
  const doc = await load(file);
  const total = doc.getPageCount();
  const remove = parseRange(range, total);
  if (!range.trim()) throw new Error('Enter the pages to delete');
  if (remove.length >= total) throw new Error('You cannot delete all pages');
  // remove from the end so indexes stay valid
  [...remove].reverse().forEach((i) => doc.removePage(i));
  return doc.save();
}

export async function rotatePages(file: PickedFile, range: string, angle: 90 | 180 | 270): Promise<Uint8Array> {
  const doc = await load(file);
  const indexes = parseRange(range, doc.getPageCount());
  indexes.forEach((i) => {
    const page = doc.getPage(i);
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  });
  return doc.save();
}

/** Combine images (JPG/PNG) into one PDF, one image per A4 page, fitted with margins. */
export async function imagesToPdf(images: PickedFile[]): Promise<Uint8Array> {
  if (images.length === 0) throw new Error('Select at least 1 image');
  const doc = await PDFDocument.create();
  const A4: [number, number] = [595.28, 841.89];
  const margin = 24;
  for (const img of images) {
    const bytes = await readBytes(img.uri);
    const isPng = img.mimeType === 'image/png' || /\.png$/i.test(img.name);
    const embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const landscape = embedded.width > embedded.height;
    const [w, h] = landscape ? [A4[1], A4[0]] : A4;
    const page = doc.addPage([w, h]);
    const scale = Math.min((w - margin * 2) / embedded.width, (h - margin * 2) / embedded.height, 1);
    const dw = embedded.width * scale;
    const dh = embedded.height * scale;
    page.drawImage(embedded, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh });
  }
  return doc.save();
}

/** Render pages to JPG using the native PDF renderer (PDFKit on iOS, PdfRenderer on Android). */
export async function pdfToImages(
  file: PickedFile,
  range: string,
  quality = 85,
): Promise<{ page: number; uri: string }[]> {
  const total = await pageCount(file);
  const indexes = parseRange(range, total);
  const out: { page: number; uri: string }[] = [];
  for (const i of indexes) {
    // ~300 DPI on A4; keeps memory reasonable on low-end phones
    const r = await PdfThumbnail.generate(file.uri, i, { quality, maxWidth: 2480, maxHeight: 3508 });
    out.push({ page: i + 1, uri: r.uri });
  }
  return out;
}

export async function zipFiles(entries: { name: string; uri: string }[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const e of entries) zip.file(e.name, await readBytes(e.uri));
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' }); // JPGs are already compressed
}

export async function addPageNumbers(file: PickedFile): Promise<Uint8Array> {
  const doc = await load(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const label = `${i + 1} / ${pages.length}`;
    const size = 10;
    const tw = font.widthOfTextAtSize(label, size);
    page.drawText(label, { x: (width - tw) / 2, y: 18, size, font, color: rgb(0.35, 0.35, 0.35) });
  });
  return doc.save();
}

/** Diagonal text watermark. Standard PDF fonts support Latin text only. */
export async function addWatermark(file: PickedFile, text: string): Promise<Uint8Array> {
  if (!text.trim()) throw new Error('Enter the watermark text');
  if (/[^\x20-\x7E]/.test(text)) throw new Error('Watermark supports English letters/numbers only for now');
  const doc = await load(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) / 9;
    const tw = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: width / 2 - (tw / 2) * Math.cos(Math.PI / 4),
      y: height / 2 - (tw / 2) * Math.sin(Math.PI / 4),
      size,
      font,
      color: rgb(0.85, 0.1, 0.1),
      opacity: 0.18,
      rotate: degrees(45),
    });
  }
  return doc.save();
}
