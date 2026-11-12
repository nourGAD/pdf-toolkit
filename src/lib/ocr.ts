/**
 * OCR helpers: turn recognised pages into a searchable PDF by laying tesseract's
 * invisible text layer over the ORIGINAL pages (original quality and page size are kept).
 */
import { PDFDocument, degrees } from 'pdf-lib';
import { Buffer } from 'buffer';
import { visualToPdf } from './edit';

export type OcrPage = { text: string; conf: number; layer?: string /* base64 text-only PDF */ };

export async function addTextLayers(original: Uint8Array, layers: (string | undefined)[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { ignoreEncryption: true });
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const b64 = layers[i];
    if (!b64) continue;
    const [layer] = await doc.embedPdf(new Uint8Array(Buffer.from(b64, 'base64')));
    const page = pages[i];
    const { width: w, height: h } = page.getSize();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    // the OCR saw the page as displayed (rotated); place the layer so it lines up with what's on screen
    const visW = rot % 180 ? h : w;
    const visH = rot % 180 ? w : h;
    const origin = visualToPdf(0, 1, w, h, rot); // visual bottom-left corner
    page.drawPage(layer, { x: origin.x, y: origin.y, width: visW, height: visH, rotate: degrees(rot) });
  }
  return doc.save();
}

/** Join page texts with clear page separators. */
export const joinPages = (pages: OcrPage[]) =>
  pages.map((p, i) => (pages.length > 1 ? `——— Page ${i + 1} ———\n` : '') + p.text.trim()).join('\n\n');

/** Arabic text from tesseract sometimes contains stray bidi marks — remove them for clean copy/paste. */
export const cleanOcrText = (s: string) => s.replace(/[‎‏‪-‮]/g, '').replace(/[ \t]+\n/g, '\n');
