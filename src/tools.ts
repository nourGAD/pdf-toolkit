import { PickedFile, baseName, readBytes, saveOutput } from './lib/files';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import PdfThumbnail from 'react-native-pdf-thumbnail';
import { compressPdf, PDF_COMPRESS, type ImageCodec, type PdfCompressLevel } from './lib/compress';
import { protectPdf, unlockPdf } from './lib/protect';
import { fillForm, type RenderText } from './lib/forms';
import { addTextLayers, cleanOcrText, joinPages, type OcrPage } from './lib/ocr';
import { buildDocx } from './lib/docxWriter';
import { imageSize } from './lib/images';
import type { EngineCall } from './engines/EngineHost';
import type { FormState } from './components/FormFiller';
import * as pdf from './lib/pdf';
import { compressImage, formatBytes, type CompressLevel } from './lib/images';
import { applyEdits, type EditItem } from './lib/edit';
import { removeWatermarks } from './lib/unwatermark';
import type { UnwatermarkChoice } from './components/WatermarkRemover';
import type { PageMode } from './components/PagePicker';
import { Buffer } from 'buffer';
import { SIZE_SCALE, type WatermarkImage, type WatermarkSettings } from './components/WatermarkOptions';

/** range = selected pages as "1-3,5" (built from the visual page picker) */
export type ToolOptions = {
  range: string;
  angle: 90 | 180 | 270;
  wm: WatermarkSettings;
  /** the watermark text rendered to PNG by the phone (any language) */
  wmImage: WatermarkImage | null;
  compress: CompressLevel;
  /** Edit / Sign PDF: things placed on pages */
  edits: EditItem[];
  /** Remove watermark: what to remove */
  unwm: UnwatermarkChoice;
  ocrLang: OcrLang;
  password: string;
  /** Reorder: new order of the original pages (0-based) */
  order: number[];
  orderChanged: boolean;
  form: FormState;
  pdfCompress: PdfCompressLevel;
  /** filled in by the tool screen: background engines + progress reporting */
  ctx: ToolCtx;
};

export type OcrLang = 'ara+eng' | 'ara' | 'eng';
export type EngineName = 'ocr' | 'codec' | 'convert';
export type ToolCtx = {
  engine: (name: EngineName) => EngineCall;
  renderText?: RenderText;
  progress: (label: string) => void;
};

export type ToolResult = {
  uri: string;
  mimeType: string;
  label: string;
  /** images to show in the result preview (for outputs that aren't a single PDF) */
  previewImages?: string[];
  /** recognised / extracted text shown with Copy + Share .txt */
  text?: string;
  textUri?: string;
  /** separate image files (PDF → JPG): saved to Gallery one by one, ZIP only on request */
  images?: { uri: string; name: string }[];
};

export type Tool = {
  id: string;
  title: string;
  titleAr: string;
  description: string;
  icon: string;
  color: string;
  input: 'pdf' | 'pdfs' | 'images' | 'docx';
  /** hidden background engines this tool needs */
  engines?: EngineName[];
  /** search words, for the home-screen search box */
  keywords?: string;
  /** images input: 'scan' = camera scanner + gallery with crop; 'gallery' = just pick photos */
  imageSource?: 'scan' | 'gallery';
  /** show the visual page picker */
  pages?: { mode: PageMode; help: string; required?: boolean };
  fields?: ('angle' | 'watermark' | 'compress' | 'edit' | 'unwatermark' | 'ocr' | 'password' | 'reorder' | 'form' | 'pdfcompress')[];
  /** password field: protect (new password, typed twice) or unlock (existing password) */
  passwordMode?: 'protect' | 'unlock';
  /** editor: which action to start with */
  editMode?: 'edit' | 'sign';
  /** one-line summary shown in the confirm step */
  summary: (files: PickedFile[], o: ToolOptions, selectedCount: number) => string;
  run: (files: PickedFile[], o: ToolOptions) => Promise<ToolResult>;
};

const PDF = 'application/pdf';
const ZIP = 'application/zip';

const savePdf = (bytes: Uint8Array, name: string): ToolResult => ({
  uri: saveOutput(bytes, name),
  mimeType: PDF,
  label: name,
});

const pagesText = (n: number, all = 'all pages') => (n ? `${n} page${n > 1 ? 's' : ''}` : all);

const BASE_TOOLS: Tool[] = [
  {
    id: 'sign',
    title: 'Sign PDF',
    titleAr: 'توقيع PDF',
    description: 'Draw your signature with your finger and place it on any page. Saved for next time.',
    icon: '✍️',
    color: '#7B4FD6',
    input: 'pdf',
    fields: ['edit'],
    editMode: 'sign',
    summary: (_, o) => `Add ${o.edits.length} item${o.edits.length === 1 ? '' : 's'} (signature/text/image) to the PDF.`,
    run: async ([f], o) => savePdf(await applyEdits(f, o.edits), `${baseName(f.name)}_signed.pdf`),
  },
  {
    id: 'edit',
    title: 'Edit PDF',
    titleAr: 'تعديل PDF',
    description: 'Add text (Arabic or English) or images anywhere on the page — drag, resize, done.',
    icon: '📝',
    color: '#1F8FE5',
    input: 'pdf',
    fields: ['edit'],
    editMode: 'edit',
    summary: (_, o) => `Add ${o.edits.length} item${o.edits.length === 1 ? '' : 's'} to the PDF on ${new Set(o.edits.map((e) => e.page)).size} page(s).`,
    run: async ([f], o) => savePdf(await applyEdits(f, o.edits), `${baseName(f.name)}_edited.pdf`),
  },
  {
    id: 'unwatermark',
    title: 'Remove watermark',
    titleAr: 'إزالة العلامة المائية',
    description: 'Find and remove watermarks (Word/Acrobat, layers, stamps, repeated text). Preview before & after.',
    icon: '🧽',
    color: '#E5322D',
    input: 'pdf',
    fields: ['unwatermark'],
    summary: (_, o) =>
      `Remove ${o.unwm.ids.length} watermark${o.unwm.ids.length === 1 ? '' : 's'}${o.unwm.text.trim() ? ` + text “${o.unwm.text.trim()}”` : ''} from every page.`,
    run: async ([f], o) => {
      const out = await removeWatermarks(await readBytes(f.uri), o.unwm.ids, o.unwm.text);
      return savePdf(out, `${baseName(f.name)}_clean.pdf`);
    },
  },
  {
    id: 'merge',
    title: 'Merge PDF',
    titleAr: 'دمج PDF',
    description: 'Combine several PDFs into one, in the order you pick them.',
    icon: '🧩',
    color: '#E5322D',
    input: 'pdfs',
    summary: (f) => `Merge ${f.length} files into one PDF, in the order shown above.`,
    run: async (files) => savePdf(await pdf.mergePdfs(files), 'merged.pdf'),
  },
  {
    id: 'split',
    title: 'Split PDF',
    titleAr: 'تقسيم PDF',
    description: 'Pick pages to extract into a new PDF, or split every page into its own file.',
    icon: '✂️',
    color: '#F28C28',
    input: 'pdf',
    pages: {
      mode: 'select',
      help: 'دوس على الصفحات اللي عايزها في ملف جديد.\nلو ما اخترتش حاجة، كل صفحة هتتحول لملف لوحدها (ZIP).',
    },
    summary: (_, __, n) =>
      n ? `Extract ${pagesText(n)} into a new PDF.` : 'Split every page into its own PDF (delivered as a ZIP).',
    run: async ([f], o) => {
      const name = baseName(f.name);
      if (!o.range.trim()) {
        const bytes = await pdf.splitAllToZip(f, name);
        return { uri: saveOutput(bytes, `${name}_split.zip`), mimeType: ZIP, label: `${name}_split.zip` };
      }
      return savePdf(await pdf.extractPages(f, o.range), `${name}_extract.pdf`);
    },
  },
  {
    id: 'pdf2jpg',
    title: 'PDF to JPG',
    titleAr: 'PDF إلى صور',
    description: 'Convert pages to high-quality JPG photos — saved straight to your Gallery.',
    icon: '🖼️',
    color: '#F5B700',
    input: 'pdf',
    pages: { mode: 'select', help: 'اختار الصفحات اللي عايز تحوّلها لصور.\nلو ما اخترتش حاجة، كل الصفحات هتتحول.' },
    summary: (_, __, n) => `Convert ${pagesText(n)} to separate JPG photos.`,
    run: async ([f], o) => {
      const name = baseName(f.name);
      const pages = await pdf.pdfToImages(f, o.range);
      const images = pages.map((p) => ({ uri: p.uri, name: `${name}_page_${p.page}.jpg` }));
      return {
        uri: images[0]?.uri ?? '',
        mimeType: 'image/jpeg',
        label: `${images.length} photo${images.length === 1 ? '' : 's'} from ${f.name}`,
        previewImages: images.map((i) => i.uri),
        images,
      };
    },
  },
  {
    id: 'jpg2pdf',
    title: 'Scan / JPG to PDF',
    titleAr: 'سكانر · صور إلى PDF',
    description: 'Scan documents with the camera (auto-crop like CamScanner) or pick photos and crop them.',
    icon: '📷',
    color: '#2BA84A',
    input: 'images',
    imageSource: 'scan',
    summary: (f) => `Create one PDF from ${f.length} image${f.length > 1 ? 's' : ''}, one per page, in the order shown.`,
    run: async (images) => savePdf(await pdf.imagesToPdf(images), 'scan.pdf'),
  },
  {
    id: 'compress',
    title: 'Compress images',
    titleAr: 'ضغط الصور',
    description: 'Make photos much smaller (MB → KB) for WhatsApp, email and uploads. Your originals are not changed.',
    icon: '🗜️',
    color: '#0EA5A4',
    input: 'images',
    imageSource: 'gallery',
    fields: ['compress'],
    summary: (f, o) => `Compress ${f.length} photo${f.length > 1 ? 's' : ''} (${o.compress} compression). Originals stay as they are.`,
    run: async (images, o) => {
      let before = 0;
      let after = 0;
      const out: { uri: string; name: string }[] = [];
      for (const img of images) {
        const r = await compressImage(img, o.compress);
        before += r.before;
        after += r.after;
        out.push({ uri: r.uri, name: img.name.replace(/\.\w+$/, '') + '_small.jpg' });
      }
      const saved = before ? Math.round((1 - after / before) * 100) : 0;
      return {
        uri: out[0]?.uri ?? '',
        mimeType: 'image/jpeg',
        label: `${formatBytes(before)} → ${formatBytes(after)}  (−${saved}%)`,
        previewImages: out.map((i) => i.uri),
        images: out,
      };
    },
  },
  {
    id: 'rotate',
    title: 'Rotate PDF',
    titleAr: 'تدوير PDF',
    description: 'Rotate all pages or only some of them.',
    icon: '🔄',
    color: '#1F8FE5',
    input: 'pdf',
    pages: { mode: 'rotate', help: 'اختار الزاوية تحت، وبعدين دوس على الصفحات اللي عايز تلفّها.\nهتشوفها وهي ملفوفة قبل ما تحفظ.' },
    fields: ['angle'],
    summary: (_, o, n) => `Rotate ${pagesText(n)} by ${o.angle}°.`,
    run: async ([f], o) => savePdf(await pdf.rotatePages(f, o.range, o.angle), `${baseName(f.name)}_rotated.pdf`),
  },
  {
    id: 'delete',
    title: 'Delete pages',
    titleAr: 'حذف صفحات',
    description: 'Remove the pages you don’t need.',
    icon: '🗑️',
    color: '#7B4FD6',
    input: 'pdf',
    pages: { mode: 'delete', help: 'دوس على الصفحات اللي عايز تمسحها، هتظهر عليها علامة ✕ حمرا.', required: true },
    summary: (_, __, n) => `Delete ${pagesText(n)} and keep the rest.`,
    run: async ([f], o) => savePdf(await pdf.deletePages(f, o.range), `${baseName(f.name)}_edited.pdf`),
  },
  {
    id: 'numbers',
    title: 'Page numbers',
    titleAr: 'ترقيم الصفحات',
    description: 'Add “1 / N” page numbers at the bottom of every page.',
    icon: '🔢',
    color: '#00A3A3',
    input: 'pdf',
    summary: () => 'Add “1 / N” page numbers at the bottom of every page.',
    run: async ([f]) => savePdf(await pdf.addPageNumbers(f), `${baseName(f.name)}_numbered.pdf`),
  },
  {
    id: 'watermark',
    title: 'Watermark',
    titleAr: 'علامة مائية',
    description: 'Stamp your own text (Arabic or English) on every page — choose color, size, angle, center or repeat.',
    icon: '💧',
    color: '#D6336C',
    input: 'pdf',
    fields: ['watermark'],
    summary: (_, o) =>
      `Stamp “${o.wm.text.trim()}” on every page (${o.wm.layout === 'tile' ? 'repeated' : 'centered'}, ${o.wm.angle}°, ${Math.round(o.wm.opacity * 100)}% opacity).`,
    run: async ([f], o) => {
      if (!o.wmImage) throw new Error('Type the watermark text first · اكتب نص العلامة المائية');
      const png = new Uint8Array(Buffer.from(o.wmImage.base64, 'base64'));
      const bytes = await pdf.addWatermark(f, {
        png,
        opacity: o.wm.opacity,
        angle: o.wm.angle,
        scale: SIZE_SCALE[o.wm.size],
        layout: o.wm.layout,
      });
      return savePdf(bytes, `${baseName(f.name)}_watermark.pdf`);
    },
  },
];

// ---------------------------------------------------------------- helpers for the engine-based tools
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const b64 = (uri: string) => new File(uri).base64();
const pct = (before: number, after: number) => (before ? Math.round((1 - after / before) * 100) : 0);
const fmt = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function saveText(text: string, name: string): string {
  const f = new File(Paths.cache, name.replace(/[^\w.؀-ۿ -]+/g, '_'));
  if (f.exists) f.delete();
  f.create();
  f.write(text);
  return f.uri;
}

/** JPEG of an image, long side ≤ 2400 px (enough for OCR, keeps memory low). */
async function ocrReady(uri: string): Promise<string> {
  const { width, height } = await imageSize(uri);
  const k = Math.min(1, 2400 / Math.max(width, height));
  const r = await manipulateAsync(uri, k < 1 ? [{ resize: { width: Math.round(width * k) } }] : [], {
    compress: 0.9,
    format: SaveFormat.JPEG,
    base64: true,
  });
  return r.base64!;
}

async function ocrOne(ctx: ToolCtx, jpegB64: string, lang: OcrLang, pdf: boolean, label: string): Promise<OcrPage> {
  await ctx.engine('ocr')('__langs', null, [lang]);
  const r = await ctx.engine('ocr')('__ocr', jpegB64, [{ pdf }], (p) => ctx.progress(`${label} · ${Math.round(p * 100)}%`));
  return { text: cleanOcrText(r.text ?? ''), conf: r.conf ?? 0, layer: r.pdf ?? undefined };
}

const codecOf = (ctx: ToolCtx): ImageCodec => ({
  jpeg: async (data, maxSide, quality) => {
    const r = await ctx.engine('codec')('__jpeg', data, [maxSide, quality]);
    return r.data ? { base64: r.data, width: r.width, height: r.height } : null;
  },
  raw: async (data, w, h, ch, maxSide, quality) => {
    const r = await ctx.engine('codec')('__raw', data, [w, h, ch, maxSide, quality]);
    return r.data ? { base64: r.data, width: r.width, height: r.height } : null;
  },
});

export const MORE_TOOLS: Tool[] = [
  {
    id: 'compress-pdf',
    title: 'Compress PDF',
    titleAr: 'ضغط PDF',
    description: 'Make a PDF much smaller by shrinking the pictures inside. Text stays sharp.',
    icon: '📉',
    color: '#0EA5A4',
    input: 'pdf',
    engines: ['codec'],
    fields: ['pdfcompress'],
    keywords: 'compress reduce size smaller shrink ضغط تصغير حجم',
    summary: (_, o) => `Compress the pictures in this PDF (${PDF_COMPRESS[o.pdfCompress].label}). The original stays as it is.`,
    run: async ([f], o) => {
      const { bytes, stats } = await compressPdf(await readBytes(f.uri), o.pdfCompress, codecOf(o.ctx), (d, t) =>
        o.ctx.progress(t ? `Picture ${Math.min(d + 1, t)} of ${t}` : 'Working…'),
      );
      if (!stats.recompressed)
        throw new Error(
          stats.images
            ? 'This PDF is already well compressed — no smaller version was possible.'
            : 'This PDF has no pictures to compress (it is mostly text, which is already small).',
        );
      const r = savePdf(bytes, `${baseName(f.name)}_compressed.pdf`);
      return { ...r, label: `${fmt(stats.before)} → ${fmt(stats.after)}  (−${pct(stats.before, stats.after)}%)` };
    },
  },
  {
    id: 'ocr-photo',
    title: 'Photo to text (OCR)',
    titleAr: 'استخراج النص من صورة',
    description: 'Pull the text out of photos and scans — Arabic and English. Copy it or save as .txt.',
    icon: '🔤',
    color: '#C2410C',
    input: 'images',
    imageSource: 'scan',
    engines: ['ocr'],
    fields: ['ocr'],
    keywords: 'ocr text extract recognize copy scan نص استخراج كتابة',
    summary: (f, o) => `Read the text in ${f.length} image${f.length > 1 ? 's' : ''} (${LANG_LABEL[o.ocrLang]}).`,
    run: async (images, o) => {
      const pages: OcrPage[] = [];
      for (let i = 0; i < images.length; i++) {
        o.ctx.progress(`Image ${i + 1} of ${images.length}`);
        pages.push(await ocrOne(o.ctx, await ocrReady(images[i].uri), o.ocrLang, false, `Image ${i + 1}/${images.length}`));
      }
      const text = joinPages(pages);
      if (!text.trim()) throw new Error('No text was found. Try a sharper, well-lit photo.');
      return { uri: '', mimeType: 'text/plain', label: `Text from ${images.length} image${images.length > 1 ? 's' : ''}`, text, textUri: saveText(text, 'scan_text.txt') };
    },
  },
  {
    id: 'ocr-pdf',
    title: 'OCR PDF (searchable)',
    titleAr: 'PDF ممسوح ← نص',
    description: 'Make a scanned PDF searchable and copyable (Arabic + English), so it can also be read aloud.',
    icon: '🔎',
    color: '#9333EA',
    input: 'pdf',
    engines: ['ocr'],
    fields: ['ocr'],
    keywords: 'ocr searchable scanned text recognize copy ممسوح بحث نص',
    pages: { mode: 'select', help: 'اختار الصفحات اللي عايز تطلّع منها النص.\nلو ما اخترتش حاجة، هيعمل كل الصفحات.' },
    summary: (_, o, n) => `Recognise the text on ${n ? `${n} page${n > 1 ? 's' : ''}` : 'all pages'} (${LANG_LABEL[o.ocrLang]}) and add it to the PDF.`,
    run: async ([f], o) => {
      const original = await readBytes(f.uri);
      const total = await pdf.pageCount(f);
      const want = new Set(pdf.parseRange(o.range, total));
      const pages: OcrPage[] = [];
      const layers: (string | undefined)[] = [];
      for (let i = 0; i < total; i++) {
        if (!want.has(i)) {
          layers.push(undefined);
          continue;
        }
        o.ctx.progress(`Page ${i + 1} of ${total}`);
        const img = await PdfThumbnail.generate(f.uri, i, { quality: 90, maxWidth: 2200, maxHeight: 3100 });
        const p = await ocrOne(o.ctx, await b64(img.uri), o.ocrLang, true, `Page ${i + 1}/${total}`);
        pages.push(p);
        layers.push(p.layer);
      }
      o.ctx.progress('Building the PDF…');
      const out = await addTextLayers(original, layers);
      const text = joinPages(pages);
      const r = savePdf(out, `${baseName(f.name)}_searchable.pdf`);
      return { ...r, text, textUri: saveText(text, `${baseName(f.name)}.txt`) };
    },
  },
  {
    id: 'word2pdf',
    title: 'Word to PDF',
    titleAr: 'Word إلى PDF',
    description: 'Turn a Word (.docx) file into a PDF — Arabic and English, tables and pictures.',
    icon: '📄',
    color: '#2563EB',
    input: 'docx',
    engines: ['convert'],
    keywords: 'word docx convert pdf وورد تحويل',
    summary: (f) => `Convert “${f[0]?.name}” to PDF (A4).`,
    run: async ([f], o) => {
      o.ctx.progress('Reading the document…');
      const { html } = await o.ctx.engine('convert')('__docx2html', await b64(f.uri));
      o.ctx.progress('Creating the PDF…');
      const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
      const name = `${baseName(f.name)}.pdf`;
      const dest = saveOutput(await new File(uri).bytes(), name);
      return { uri: dest, mimeType: PDF, label: name };
    },
  },
  {
    id: 'pdf2word',
    title: 'PDF to Word',
    titleAr: 'PDF إلى Word',
    description: 'Get the text of a PDF as an editable Word file (Arabic lines right-to-left). Layout is simplified.',
    icon: '📝',
    color: '#1D4ED8',
    input: 'pdf',
    engines: ['convert'],
    keywords: 'pdf word docx convert editable وورد تحويل تعديل',
    summary: () => 'Extract the text of every page into a Word (.docx) file. Pictures and exact layout are not kept.',
    run: async ([f], o) => {
      o.ctx.progress('Reading the PDF…');
      const r = await o.ctx.engine('convert')('__pdftext', await b64(f.uri), [], (p) => o.ctx.progress(`Reading pages · ${Math.round(p * 100)}%`));
      const pages = r.pages as { lines: { text: string; rtl: boolean }[] }[];
      if (!pages.some((p) => p.lines.length))
        throw new Error('This PDF has no text layer (it looks scanned). Run “OCR PDF” first, then convert it to Word.');
      const name = `${baseName(f.name)}.docx`;
      const uri = saveOutput(await buildDocx(pages), name);
      const preview = pages.slice(0, 2).map((p) => p.lines.map((l) => l.text).join('\n')).join('\n\n');
      return { uri, mimeType: DOCX, label: name, text: preview.length > 1500 ? preview.slice(0, 1500) + '…' : preview };
    },
  },
  {
    id: 'protect',
    title: 'Protect PDF',
    titleAr: 'قفل PDF بباسورد',
    description: 'Add a password so only people who know it can open the file (AES-256).',
    icon: '🔒',
    color: '#334155',
    input: 'pdf',
    fields: ['password'],
    passwordMode: 'protect',
    keywords: 'password protect lock encrypt باسورد قفل حماية',
    summary: () => 'Lock the PDF with your password (AES-256). Keep the password safe — it cannot be recovered.',
    run: async ([f], o) => savePdf(await protectPdf(await readBytes(f.uri), o.password), `${baseName(f.name)}_protected.pdf`),
  },
  {
    id: 'unlock',
    title: 'Unlock PDF',
    titleAr: 'فتح PDF مقفول',
    description: 'Remove the password from a PDF you can open (you need to know the password).',
    icon: '🔓',
    color: '#475569',
    input: 'pdf',
    fields: ['password'],
    passwordMode: 'unlock',
    keywords: 'unlock remove password decrypt فتح باسورد',
    summary: () => 'Remove the password and save an unlocked copy.',
    run: async ([f], o) => savePdf(await unlockPdf(await readBytes(f.uri), o.password), `${baseName(f.name)}_unlocked.pdf`),
  },
  {
    id: 'forms',
    title: 'Fill PDF form',
    titleAr: 'ملء نموذج PDF',
    description: 'Type into the boxes of a PDF form — text, check boxes and choices. Arabic supported.',
    icon: '🗒️',
    color: '#0F766E',
    input: 'pdf',
    fields: ['form'],
    keywords: 'form fill fields application نموذج استمارة ملء',
    summary: (_, o) => `Fill ${o.form.fields} field${o.form.fields === 1 ? '' : 's'}${o.form.flatten ? ' and lock the answers' : ''}.`,
    run: async ([f], o) =>
      savePdf(
        await fillForm(await readBytes(f.uri), o.form.values, { flatten: o.form.flatten, renderText: o.ctx.renderText }),
        `${baseName(f.name)}_filled.pdf`,
      ),
  },
  {
    id: 'reorder',
    title: 'Reorder pages',
    titleAr: 'ترتيب الصفحات',
    description: 'Put pages in a new order — tap a page then its new place, or hold and drag.',
    icon: '🔀',
    color: '#DB2777',
    input: 'pdf',
    fields: ['reorder'],
    keywords: 'reorder sort move arrange pages ترتيب صفحات',
    summary: (_, o) => `Save the PDF with the new page order (${o.order.map((i) => i + 1).join(', ')}).`,
    run: async ([f], o) => savePdf(await pdf.reorderPages(f, o.order), `${baseName(f.name)}_reordered.pdf`),
  },
];

export const LANG_LABEL: Record<OcrLang, string> = { 'ara+eng': 'Arabic + English', ara: 'Arabic', eng: 'English' };

/** Home-screen order: most-used first. */
const ORDER = [
  'jpg2pdf', 'sign', 'compress-pdf', 'merge', 'edit', 'ocr-photo', 'word2pdf', 'pdf2word',
  'split', 'pdf2jpg', 'ocr-pdf', 'forms', 'reorder', 'protect', 'unlock', 'compress',
  'rotate', 'delete', 'unwatermark', 'watermark', 'numbers',
];
const ALL = [...BASE_TOOLS, ...MORE_TOOLS];
export const TOOLS: Tool[] = [
  ...ORDER.map((id) => ALL.find((t) => t.id === id)).filter((t): t is Tool => !!t),
  ...ALL.filter((t) => !ORDER.includes(t.id)),
];
