import { PDFDocument, degrees } from 'pdf-lib';
import { Buffer } from 'buffer';
import { PickedFile, readBytes } from './files';

/**
 * Something placed on a page: text (rendered to PNG with the phone's fonts, so Arabic works),
 * a picture, or a hand-drawn signature. Position/size are fractions (0..1) of the page
 * AS THE USER SEES IT (top-left origin), so they're independent of screen size.
 */
export type EditItem = {
  id: string;
  kind: 'text' | 'image' | 'signature';
  page: number; // 0-based
  x: number;
  y: number;
  w: number;
  h: number;
  base64: string; // PNG or JPEG data
  mime: 'image/png' | 'image/jpeg';
  /** for text items: the settings used to render it (to edit later) */
  text?: { value: string; color: string; bold: boolean };
};

/**
 * Convert a point given as fractions of the *visible* page (top-left origin)
 * to PDF user-space coordinates, taking the page's /Rotate into account.
 */
export function visualToPdf(u: number, v: number, w: number, h: number, rotation: number) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: v * w, y: u * h };
    case 180:
      return { x: (1 - u) * w, y: v * h };
    case 270:
      return { x: (1 - v) * w, y: (1 - u) * h };
    default:
      return { x: u * w, y: (1 - v) * h };
  }
}

export async function applyEdits(file: PickedFile, items: EditItem[]): Promise<Uint8Array> {
  if (!items.length) throw new Error('Add text, an image or a signature first');
  const doc = await PDFDocument.load(await readBytes(file.uri), { ignoreEncryption: true });
  const cache = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();

  for (const it of items) {
    const page = doc.getPage(it.page);
    const { width: w, height: h } = page.getSize();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const visW = rot % 180 ? h : w;
    const visH = rot % 180 ? w : h;

    let img = cache.get(it.base64);
    if (!img) {
      const bytes = new Uint8Array(Buffer.from(it.base64, 'base64'));
      img = it.mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      cache.set(it.base64, img);
    }
    // the item's visual bottom-left corner becomes the image origin; rotate with the page so it looks upright
    const o = visualToPdf(it.x, it.y + it.h, w, h, rot);
    page.drawImage(img, { x: o.x, y: o.y, width: it.w * visW, height: it.h * visH, rotate: degrees(rot) });
  }
  return doc.save();
}
