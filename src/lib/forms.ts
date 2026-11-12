/** Fill PDF forms (AcroForm): text boxes, check boxes, drop-downs, radio buttons. */
import { PDFArray, PDFCheckBox, PDFDocument, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFRef, PDFTextField } from 'pdf-lib';
import { Buffer } from 'buffer';

export type FormField = {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'list';
  value: string | boolean;
  options?: string[];
  multiline?: boolean;
  readOnly?: boolean;
};
export type FormValues = Record<string, string | boolean>;
export type RenderText = (text: string) => Promise<{ base64: string; width: number; height: number } | null>;

/** Characters the built-in PDF fonts can't draw (Arabic, emoji, …) → those values are drawn as an image instead. */
const needsImage = (s: string) => /[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF‘’“”–—…€•™]/.test(s);

/** pdf-lib can leave page annotations pointing at objects it deleted → remove those dead links. */
function dropDeadAnnots(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    const a = page.node.get(PDFName.of('Annots'));
    const arr = a instanceof PDFRef ? doc.context.lookup(a) : a;
    if (!(arr instanceof PDFArray)) continue;
    const alive = arr.asArray().filter((r) => !(r instanceof PDFRef) || doc.context.lookup(r) !== undefined);
    if (alive.length !== arr.size()) page.node.set(PDFName.of('Annots'), doc.context.obj(alive));
  }
}

/** Multi-line boxes with "auto" (0) or oversized font come out huge → use a normal reading size. */
const fixAutoSize = (da: string | undefined) =>
  da ? da.replace(/(\/\S+)\s+([\d.]+)\s+Tf/, (m, font, size) => (Number(size) === 0 || Number(size) > 14 ? `${font} 11 Tf` : m)) : da;

export async function readForm(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const out: FormField[] = [];
  for (const f of doc.getForm().getFields()) {
    const name = f.getName();
    const readOnly = f.isReadOnly();
    try {
      if (f instanceof PDFTextField) out.push({ name, type: 'text', value: f.getText() ?? '', multiline: f.isMultiline(), readOnly });
      else if (f instanceof PDFCheckBox) out.push({ name, type: 'checkbox', value: f.isChecked(), readOnly });
      else if (f instanceof PDFDropdown) out.push({ name, type: 'dropdown', value: f.getSelected()[0] ?? '', options: f.getOptions(), readOnly });
      else if (f instanceof PDFRadioGroup) out.push({ name, type: 'radio', value: f.getSelected() ?? '', options: f.getOptions(), readOnly });
      else if (f instanceof PDFOptionList) out.push({ name, type: 'list', value: f.getSelected()[0] ?? '', options: f.getOptions(), readOnly });
    } catch {
      /* unreadable field → skip it */
    }
  }
  return out;
}

export async function fillForm(
  bytes: Uint8Array,
  values: FormValues,
  opts: { flatten: boolean; renderText?: RenderText },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();

  for (const f of form.getFields()) {
    const v = values[f.getName()];
    if (v === undefined || f.isReadOnly()) continue;

    if (f instanceof PDFTextField) {
      const text = String(v);
      if (!needsImage(text)) {
        const max = f.getMaxLength();
        if (f.isMultiline()) {
          const da = fixAutoSize(f.acroField.getDefaultAppearance());
          if (da) f.acroField.setDefaultAppearance(da);
          for (const w of f.acroField.getWidgets()) {
            const wda = fixAutoSize(w.getDefaultAppearance());
            if (wda) w.setDefaultAppearance(wda);
          }
        }
        f.setText(max !== undefined ? text.slice(0, max) : text);
        continue;
      }
      // Arabic etc.: draw the text as a picture inside each box of this field, then drop the field
      const img = opts.renderText && (await opts.renderText(text));
      if (!img) throw new Error(`Could not write “${text.slice(0, 20)}” into the form`);
      const png = await doc.embedPng(new Uint8Array(Buffer.from(img.base64, 'base64')));
      const rtl = /[֐-ࣿ]/.test(text);
      for (const w of f.acroField.getWidgets()) {
        const r = w.getRectangle();
        const ref = doc.context.getObjectRef(w.dict);
        const page = (ref && doc.findPageForAnnotationRef(ref)) || doc.getPage(0);
        const pad = Math.min(3, r.height * 0.12);
        const hh = Math.min(r.height - pad * 2, 22); // don't blow up in tall multi-line boxes
        let ww = (hh * png.width) / png.height;
        let hFinal = hh;
        if (ww > r.width - pad * 2) {
          ww = r.width - pad * 2;
          hFinal = (ww * png.height) / png.width;
        }
        page.drawImage(png, {
          x: rtl ? r.x + r.width - pad - ww : r.x + pad,
          y: f.isMultiline() ? r.y + r.height - pad - hFinal : r.y + (r.height - hFinal) / 2,
          width: ww,
          height: hFinal,
        });
      }
      form.removeField(f);
    } else if (f instanceof PDFCheckBox) {
      v ? f.check() : f.uncheck();
    } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
      if (v && f.getOptions().includes(String(v))) f.select(String(v));
      else if (!v) f.clear();
    } else if (f instanceof PDFRadioGroup) {
      if (v && f.getOptions().includes(String(v))) f.select(String(v));
    }
  }

  if (!opts.flatten) {
    dropDeadAnnots(doc);
    return doc.save();
  }
  form.flatten();
  dropDeadAnnots(doc);
  // flatten() leaves dangling object entries that strict viewers warn about → rebuild a clean file
  const flat = await PDFDocument.load(await doc.save());
  const clean = await PDFDocument.create();
  (await clean.copyPages(flat, flat.getPageIndices())).forEach((pg) => clean.addPage(pg));
  return clean.save();
}
