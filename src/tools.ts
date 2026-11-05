import { PickedFile, baseName, saveOutput } from './lib/files';
import * as pdf from './lib/pdf';
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
};

export type ToolResult = {
  uri: string;
  mimeType: string;
  label: string;
  /** images to show in the result preview (for outputs that aren't a single PDF) */
  previewImages?: string[];
};

export type Tool = {
  id: string;
  title: string;
  titleAr: string;
  description: string;
  icon: string;
  color: string;
  input: 'pdf' | 'pdfs' | 'images';
  /** show the visual page picker */
  pages?: { mode: PageMode; help: string; required?: boolean };
  fields?: ('angle' | 'watermark')[];
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

export const TOOLS: Tool[] = [
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
    description: 'Convert pages to high-quality JPG images, delivered as a ZIP.',
    icon: '🖼️',
    color: '#F5B700',
    input: 'pdf',
    pages: { mode: 'select', help: 'اختار الصفحات اللي عايز تحوّلها لصور.\nلو ما اخترتش حاجة، كل الصفحات هتتحول.' },
    summary: (_, __, n) => `Convert ${pagesText(n)} to JPG images (ZIP).`,
    run: async ([f], o) => {
      const name = baseName(f.name);
      const pages = await pdf.pdfToImages(f, o.range);
      const zipped = await pdf.zipFiles(pages.map((p) => ({ uri: p.uri, name: `${name}_page_${p.page}.jpg` })));
      return {
        uri: saveOutput(zipped, `${name}_images.zip`),
        mimeType: ZIP,
        label: `${name}_images.zip`,
        previewImages: pages.map((p) => p.uri),
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
    summary: (f) => `Create one PDF from ${f.length} image${f.length > 1 ? 's' : ''}, one per page, in the order shown.`,
    run: async (images) => savePdf(await pdf.imagesToPdf(images), 'scan.pdf'),
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
