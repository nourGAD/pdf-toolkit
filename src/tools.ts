import { PickedFile, baseName, saveOutput } from './lib/files';
import * as pdf from './lib/pdf';

export type ToolOptions = { range: string; angle: 90 | 180 | 270; text: string };

export type ToolResult = { uri: string; mimeType: string; label: string };

export type Tool = {
  id: string;
  title: string;
  titleAr: string;
  description: string;
  icon: string;
  color: string;
  input: 'pdf' | 'pdfs' | 'images';
  /** which option fields to show */
  fields?: ('range' | 'angle' | 'text')[];
  rangeHint?: string;
  run: (files: PickedFile[], o: ToolOptions) => Promise<ToolResult>;
};

const PDF = 'application/pdf';
const ZIP = 'application/zip';

const savePdf = (bytes: Uint8Array, name: string): ToolResult => ({
  uri: saveOutput(bytes, name),
  mimeType: PDF,
  label: name,
});

export const TOOLS: Tool[] = [
  {
    id: 'merge',
    title: 'Merge PDF',
    titleAr: 'دمج PDF',
    description: 'Combine several PDFs into one, in the order you pick them.',
    icon: '🧩',
    color: '#E5322D',
    input: 'pdfs',
    run: async (files) => savePdf(await pdf.mergePdfs(files), 'merged.pdf'),
  },
  {
    id: 'split',
    title: 'Split PDF',
    titleAr: 'تقسيم PDF',
    description: 'Extract a page range into a new PDF, or leave empty to split every page into a ZIP.',
    icon: '✂️',
    color: '#F28C28',
    input: 'pdf',
    fields: ['range'],
    rangeHint: 'e.g. 1-3, 5  (empty = every page → ZIP)',
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
    fields: ['range'],
    rangeHint: 'Pages to convert (empty = all)',
    run: async ([f], o) => {
      const name = baseName(f.name);
      const pages = await pdf.pdfToImages(f, o.range);
      const zipped = await pdf.zipFiles(pages.map((p) => ({ uri: p.uri, name: `${name}_page_${p.page}.jpg` })));
      return { uri: saveOutput(zipped, `${name}_images.zip`), mimeType: ZIP, label: `${name}_images.zip` };
    },
  },
  {
    id: 'jpg2pdf',
    title: 'JPG to PDF',
    titleAr: 'صور إلى PDF',
    description: 'Turn photos and scans (JPG/PNG) into a single PDF.',
    icon: '📷',
    color: '#2BA84A',
    input: 'images',
    run: async (images) => savePdf(await pdf.imagesToPdf(images), 'images.pdf'),
  },
  {
    id: 'rotate',
    title: 'Rotate PDF',
    titleAr: 'تدوير PDF',
    description: 'Rotate all pages or only some of them.',
    icon: '🔄',
    color: '#1F8FE5',
    input: 'pdf',
    fields: ['range', 'angle'],
    rangeHint: 'Pages to rotate (empty = all)',
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
    fields: ['range'],
    rangeHint: 'Pages to delete, e.g. 2, 4-6',
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
    run: async ([f]) => savePdf(await pdf.addPageNumbers(f), `${baseName(f.name)}_numbered.pdf`),
  },
  {
    id: 'watermark',
    title: 'Watermark',
    titleAr: 'علامة مائية',
    description: 'Stamp a diagonal text watermark on every page.',
    icon: '💧',
    color: '#D6336C',
    input: 'pdf',
    fields: ['text'],
    run: async ([f], o) => savePdf(await pdf.addWatermark(f, o.text), `${baseName(f.name)}_watermark.pdf`),
  },
];
