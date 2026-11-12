/**
 * Compress PDF: re-encodes the pictures inside the file at a lower resolution/quality.
 * Text, fonts and vector drawings are untouched (so text stays sharp and selectable).
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { Buffer } from 'buffer';

export type PdfCompressLevel = 'strong' | 'medium' | 'light';
export const PDF_COMPRESS: Record<PdfCompressLevel, { maxSide: number; quality: number; label: string; labelAr: string; hint: string }> = {
  strong: { maxSide: 1200, quality: 0.5, label: 'Strong', labelAr: 'ضغط عالي', hint: 'Smallest file — fine for reading on screen' },
  medium: { maxSide: 1700, quality: 0.65, label: 'Medium', labelAr: 'متوسط', hint: 'Good balance of size and quality' },
  light: { maxSide: 2400, quality: 0.8, label: 'Light', labelAr: 'خفيف', hint: 'Keeps pictures sharp, also OK for printing' },
};

export type EncodedImage = { base64: string; width: number; height: number };
/** Provided by the hidden WebView (see components/ImageCodec). */
export type ImageCodec = {
  jpeg(base64: string, maxSide: number, quality: number): Promise<EncodedImage | null>;
  raw(base64: string, width: number, height: number, channels: 1 | 3, maxSide: number, quality: number): Promise<EncodedImage | null>;
};

export type CompressStats = { before: number; after: number; images: number; recompressed: number };

const N = (s: string) => PDFName.of(s);
const MAX_RAW_PIXELS = 8_000_000;
const MAX_RAW_SIDE = 4096;

/** Undo the PNG predictor (DecodeParms /Predictor 10–15). */
function unpredictPng(data: Uint8Array, columns: number, colors: number): Uint8Array | null {
  const bpp = colors;
  const rowLen = columns * colors;
  const rows = Math.floor(data.length / (rowLen + 1));
  if (rows < 1) return null;
  const out = new Uint8Array(rows * rowLen);
  for (let y = 0; y < rows; y++) {
    const ft = data[y * (rowLen + 1)];
    const src = y * (rowLen + 1) + 1;
    const dst = y * rowLen;
    for (let x = 0; x < rowLen; x++) {
      const raw = data[src + x];
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst + x - rowLen] : 0;
      const c = x >= bpp && y > 0 ? out[dst + x - rowLen - bpp] : 0;
      let v: number;
      if (ft === 0) v = raw;
      else if (ft === 1) v = raw + a;
      else if (ft === 2) v = raw + b;
      else if (ft === 3) v = raw + ((a + b) >> 1);
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else return null;
      out[dst + x] = v & 0xff;
    }
  }
  return out;
}

export async function compressPdf(
  bytes: Uint8Array,
  level: PdfCompressLevel,
  codec: ImageCodec,
  onProgress?: (done: number, total: number) => void,
): Promise<{ bytes: Uint8Array; stats: CompressStats }> {
  const { maxSide, quality } = PDF_COMPRESS[level];
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;
  const look = (o: unknown) => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const num = (o: unknown) => {
    const v = look(o);
    return v instanceof PDFNumber ? v.asNumber() : undefined;
  };

  const images: [PDFRef, PDFRawStream][] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && look(obj.dict.get(N('Subtype'))) === N('Image')) images.push([ref, obj]);
  }

  let recompressed = 0;
  let done = 0;
  for (const [ref, st] of images) {
    onProgress?.(done++, images.length);
    const d = st.dict;
    const w = num(d.get(N('Width')));
    const h = num(d.get(N('Height')));
    if (!w || !h || Math.max(w, h) < 200) continue; // icons/tiny images: not worth it
    if (st.contents.length < 20_000) continue;
    if (look(d.get(N('ImageMask'))) || d.get(N('Mask')) || d.get(N('Decode'))) continue;
    if ((num(d.get(N('BitsPerComponent'))) ?? 8) !== 8) continue;

    // colour space → 1 (gray) or 3 (RGB) channels; anything else (CMYK, Indexed, Lab…) is left alone
    let cs = look(d.get(N('ColorSpace')));
    let channels = 0;
    if (cs === N('DeviceRGB')) channels = 3;
    else if (cs === N('DeviceGray')) channels = 1;
    else if (cs instanceof PDFArray && look(cs.get(0)) === N('ICCBased')) {
      const icc = look(cs.get(1));
      const n = icc instanceof PDFRawStream ? num(icc.dict.get(N('N'))) : undefined;
      channels = n === 3 ? 3 : n === 1 ? 1 : 0;
    }
    if (!channels) continue;

    let filter = look(d.get(N('Filter')));
    if (filter instanceof PDFArray) filter = filter.size() === 1 ? look(filter.get(0)) : undefined;

    let out: EncodedImage | null = null;
    try {
      if (filter === N('DCTDecode')) {
        out = await codec.jpeg(Buffer.from(st.contents).toString('base64'), maxSide, quality);
      } else if (filter === N('FlateDecode')) {
        if (w * h > MAX_RAW_PIXELS || Math.max(w, h) > MAX_RAW_SIDE) continue;
        let px: Uint8Array | null = decodePDFRawStream(st).decode();
        let parms = look(d.get(N('DecodeParms')));
        if (parms instanceof PDFArray) parms = look(parms.get(0));
        const predictor = parms instanceof PDFDict ? (num(parms.get(N('Predictor'))) ?? 1) : 1;
        if (predictor >= 10) px = unpredictPng(px, w, channels);
        else if (predictor !== 1) px = null; // TIFF predictor: skip
        if (!px || px.length < w * h * channels) continue;
        out = await codec.raw(Buffer.from(px.subarray(0, w * h * channels)).toString('base64'), w, h, channels as 1 | 3, maxSide, quality);
      }
    } catch {
      out = null; // unsupported image → keep the original
    }
    if (!out?.base64) continue;
    const jpg = new Uint8Array(Buffer.from(out.base64, 'base64'));
    if (jpg.length >= st.contents.length * 0.9) continue; // not really smaller → keep original

    const nd = ctx.obj({}) as PDFDict;
    d.entries().forEach(([k, v]) => {
      if (!['/Filter', '/DecodeParms', '/Length', '/ColorSpace', '/BitsPerComponent', '/Width', '/Height'].includes(k.asString())) nd.set(k, v);
    });
    nd.set(N('Width'), PDFNumber.of(out.width));
    nd.set(N('Height'), PDFNumber.of(out.height));
    nd.set(N('BitsPerComponent'), PDFNumber.of(8));
    nd.set(N('ColorSpace'), N('DeviceRGB'));
    nd.set(N('Filter'), N('DCTDecode'));
    ctx.assign(ref, PDFRawStream.of(nd, jpg));
    recompressed++;
  }
  onProgress?.(images.length, images.length);

  const result = await doc.save({ useObjectStreams: true });
  // never hand back a bigger file
  const best = result.length < bytes.length ? result : bytes;
  return { bytes: best, stats: { before: bytes.length, after: best.length, images: images.length, recompressed } };
}
