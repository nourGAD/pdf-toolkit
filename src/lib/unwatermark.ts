/**
 * Watermark detection & removal — works on the PDF's drawing instructions (content streams),
 * so the rest of the page is left untouched.
 *
 * Removable kinds:
 *  - artifact : Word/Acrobat watermarks  (/Artifact <</Subtype /Watermark>> BDC … EMC)
 *  - annot    : watermark annotations    (/Annots … /Subtype /Watermark)
 *  - ocg      : layers (Optional Content Groups) e.g. named "Watermark"
 *  - xobj     : the same image/stamp drawn on most pages (e.g. this app's own watermark)
 *  - text     : rotated text repeated on most pages, or any text the user types
 *
 * Not removable: watermarks baked into a scanned image or flattened into page content.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream } from 'pdf-lib';

export type WatermarkCandidate = {
  id: string;
  kind: 'artifact' | 'annot' | 'ocg' | 'xobj' | 'text';
  label: string;
  pages: number[]; // 0-based pages where it appears
};

// ---------------------------------------------------------------- tokenizer
type Tok = { t: 'num' | 'name' | 'str' | 'hex' | 'op' | 'ds' | 'de' | 'as' | 'ae'; v: string; s: number; e: number };
const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  let i = 0;
  const code = (k: number) => src.charCodeAt(k);
  while (i < n) {
    const c = code(i);
    if (WS.has(c)) { i++; continue; }
    if (c === 0x25) { while (i < n && code(i) !== 0x0a && code(i) !== 0x0d) i++; continue; } // % comment
    const s = i;
    if (c === 0x28) { // ( literal string )
      let depth = 1; i++;
      while (i < n && depth > 0) {
        const d = code(i);
        if (d === 0x5c) i += 2;
        else { if (d === 0x28) depth++; else if (d === 0x29) depth--; i++; }
      }
      out.push({ t: 'str', v: src.slice(s + 1, i - 1), s, e: i });
      continue;
    }
    if (c === 0x3c) {
      if (code(i + 1) === 0x3c) { out.push({ t: 'ds', v: '<<', s, e: i + 2 }); i += 2; continue; }
      const end = src.indexOf('>', i);
      i = end < 0 ? n : end + 1;
      out.push({ t: 'hex', v: src.slice(s + 1, i - 1), s, e: i });
      continue;
    }
    if (c === 0x3e && code(i + 1) === 0x3e) { out.push({ t: 'de', v: '>>', s, e: i + 2 }); i += 2; continue; }
    if (c === 0x5b) { out.push({ t: 'as', v: '[', s, e: ++i }); continue; }
    if (c === 0x5d) { out.push({ t: 'ae', v: ']', s, e: ++i }); continue; }
    if (c === 0x7b || c === 0x7d) { i++; continue; }
    if (c === 0x2f) { // /Name
      i++;
      while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
      out.push({ t: 'name', v: src.slice(s + 1, i), s, e: i });
      continue;
    }
    while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
    if (i === s) { i++; continue; }
    const word = src.slice(s, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) out.push({ t: 'num', v: word, s, e: i });
    else {
      out.push({ t: 'op', v: word, s, e: i });
      if (word === 'ID') { // inline image data: skip binary until EI
        let k = i + 1;
        while (k < n) {
          if (code(k) === 0x45 && code(k + 1) === 0x49 && WS.has(code(k - 1)) && (k + 2 >= n || WS.has(code(k + 2)))) break;
          k++;
        }
        out.push({ t: 'op', v: 'EI', s: k, e: Math.min(n, k + 2) });
        i = k + 2;
      }
    }
  }
  return out;
}

function unescapeLiteral(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, x: string) => {
    if (/^[0-7]+$/.test(x)) return String.fromCharCode(parseInt(x, 8));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' } as Record<string, string>)[x] ?? '';
  });
}
function hexToStr(h: string): string {
  const clean = h.replace(/\s+/g, '');
  let out = '';
  for (let k = 0; k < clean.length; k += 2) out += String.fromCharCode(parseInt((clean.slice(k, k + 2) + '0').slice(0, 2), 16));
  return out;
}
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// ---------------------------------------------------------------- PDF helpers
const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)));
  return s;
};
const fromLatin1 = (s: string) => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};

function streamText(doc: PDFDocument, obj: unknown): string | null {
  const st = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (st instanceof PDFRawStream) {
    try {
      return latin1(decodePDFRawStream(st).decode());
    } catch {
      return null; // unsupported filter
    }
  }
  if (st instanceof PDFStream) {
    try {
      return latin1((st as any).getUnencodedContents());
    } catch {
      return null;
    }
  }
  return null;
}

function pageContentRefs(doc: PDFDocument, page: PDFDict): unknown[] {
  const c = page.get(PDFName.of('Contents'));
  const v = c instanceof PDFRef ? doc.context.lookup(c) : c;
  if (v instanceof PDFArray) return v.asArray();
  return c ? [c] : [];
}

function dictOf(doc: PDFDocument, o: unknown): PDFDict | undefined {
  const v = o instanceof PDFRef ? doc.context.lookup(o) : o;
  return v instanceof PDFDict ? v : v instanceof PDFStream ? v.dict : undefined;
}

function resourcesOf(doc: PDFDocument, owner: PDFDict): PDFDict | undefined {
  // inherited resources for pages
  let node: PDFDict | undefined = owner;
  for (let k = 0; node && k < 20; k++) {
    const r = dictOf(doc, node.get(PDFName.of('Resources')));
    if (r) return r;
    node = dictOf(doc, node.get(PDFName.of('Parent')));
  }
  return undefined;
}

function resEntry(doc: PDFDocument, res: PDFDict | undefined, cat: string, name: string): unknown {
  const d = res && dictOf(doc, res.get(PDFName.of(cat)));
  return d?.get(PDFName.of(name));
}

const refKey = (r: unknown) => (r instanceof PDFRef ? `${r.objectNumber}_${r.generationNumber}` : '');

// ---------------------------------------------------------------- stream analysis
type Target = { artifact: boolean; ocgs: Set<string>; xobjs: Set<string>; texts: string[] };
type Found = {
  artifact: number;
  ocg: Map<string, number>; // ocg refKey → occurrences
  xobj: Map<string, number>; // xobject refKey → Do count
  rotatedTexts: Set<string>; // normalized text of rotated BT blocks
  formRefs: unknown[]; // form xobjects referenced (to scan inside)
};

/** Walk one content stream: collect what's in it and/or compute byte ranges to remove. */
function analyse(doc: PDFDocument, src: string, res: PDFDict | undefined, target?: Target) {
  const toks = tokenize(src);
  const found: Found = { artifact: 0, ocg: new Map(), xobj: new Map(), rotatedTexts: new Set(), formRefs: [] };
  const remove: [number, number][] = [];
  const mcStack: { s: number; hit: boolean }[] = [];
  let ops: Tok[] = [];
  let rotated = false;
  const rotStack: boolean[] = [];
  let bt: { s: number; text: string; rot: boolean } | null = null;

  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t !== 'op') { ops.push(tk); continue; }
    const op = tk.v;
    const start = ops.length ? ops[0].s : tk.s;
    switch (op) {
      case 'q': rotStack.push(rotated); break;
      case 'Q': rotated = rotStack.pop() ?? false; break;
      case 'cm': {
        const n = ops.filter((o) => o.t === 'num').map((o) => parseFloat(o.v));
        if (n.length >= 4 && (Math.abs(n[1]) > 1e-3 || Math.abs(n[2]) > 1e-3)) rotated = true;
        break;
      }
      case 'BDC':
      case 'BMC': {
        const tag = ops.find((o) => o.t === 'name')?.v ?? '';
        let hit = false;
        if (op === 'BDC') {
          const dictStart = ops.findIndex((o) => o.t === 'ds');
          const nameProp = ops.filter((o) => o.t === 'name')[1]?.v;
          if (tag === 'Artifact' && dictStart >= 0) {
            const raw = src.slice(ops[dictStart].s, ops[ops.length - 1].e);
            if (/\/Subtype\s*\/Watermark/.test(raw)) {
              found.artifact++;
              hit = !!target?.artifact;
            }
          }
          if (tag === 'OC' && nameProp) {
            const p = resEntry(doc, res, 'Properties', nameProp);
            const key = refKey(p);
            if (key) {
              found.ocg.set(key, (found.ocg.get(key) ?? 0) + 1);
              if (target?.ocgs.has(key)) hit = true;
            }
          }
        }
        mcStack.push({ s: start, hit });
        break;
      }
      case 'EMC': {
        const m = mcStack.pop();
        if (m?.hit) remove.push([m.s, tk.e]);
        break;
      }
      case 'Do': {
        const name = ops.find((o) => o.t === 'name')?.v;
        if (name) {
          const x = resEntry(doc, res, 'XObject', name);
          const key = refKey(x);
          if (key) {
            found.xobj.set(key, (found.xobj.get(key) ?? 0) + 1);
            if (target?.xobjs.has(key)) remove.push([start, tk.e]);
            const sub = dictOf(doc, x)?.get(PDFName.of('Subtype'));
            if (sub === PDFName.of('Form')) found.formRefs.push(x);
          }
        }
        break;
      }
      case 'BT': bt = { s: tk.s, text: '', rot: rotated }; break;
      case 'Tm': {
        const n = ops.filter((o) => o.t === 'num').map((o) => parseFloat(o.v));
        if (bt && n.length >= 4 && (Math.abs(n[1]) > 1e-3 || Math.abs(n[2]) > 1e-3)) bt.rot = true;
        break;
      }
      case 'Tj': case 'TJ': case "'": case '"':
        if (bt) for (const o of ops) bt.text += o.t === 'str' ? unescapeLiteral(o.v) : o.t === 'hex' ? hexToStr(o.v) : '';
        break;
      case 'ET': {
        if (bt) {
          const t = norm(bt.text);
          if (t.length >= 3 && bt.rot) found.rotatedTexts.add(t);
          if (target && t && target.texts.some((q) => q && t.includes(q))) remove.push([bt.s, tk.e]);
        }
        bt = null;
        break;
      }
    }
    ops = [];
  }

  if (!remove.length) return { found, out: null as string | null };
  // drop nested/overlapping ranges, then cut them out
  remove.sort((a, b) => a[0] - b[0]);
  let out = '';
  let pos = 0;
  for (const [s, e] of remove) {
    if (s < pos) continue;
    out += src.slice(pos, s) + ' ';
    pos = e;
  }
  out += src.slice(pos);
  return { found, out };
}

// ---------------------------------------------------------------- public API
export async function detectWatermarks(bytes: Uint8Array): Promise<WatermarkCandidate[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  const total = pages.length;
  const artifactPages: number[] = [];
  const annotPages: number[] = [];
  const ocgPages = new Map<string, Set<number>>();
  const xobjPages = new Map<string, Set<number>>();
  const textPages = new Map<string, Set<number>>();
  const xobjInfo = new Map<string, string>();

  pages.forEach((page, pi) => {
    const node = page.node;
    const res = resourcesOf(doc, node);
    const add = (m: Map<string, Set<number>>, k: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(pi);

    let artifacts = 0;
    const scan = (src: string | null, r: PDFDict | undefined, depth: number) => {
      if (!src) return;
      const { found } = analyse(doc, src, r);
      artifacts += found.artifact;
      found.ocg.forEach((_, k) => add(ocgPages, k));
      found.rotatedTexts.forEach((t) => add(textPages, t));
      if (depth === 0) found.xobj.forEach((_, k) => add(xobjPages, k));
      if (depth < 2)
        for (const f of found.formRefs) {
          const fs = f instanceof PDFRef ? doc.context.lookup(f) : f;
          const fd = dictOf(doc, f);
          scan(streamText(doc, fs), fd ? dictOf(doc, fd.get(PDFName.of('Resources'))) ?? r : r, depth + 1);
        }
    };
    const contents = pageContentRefs(doc, node).map((c) => streamText(doc, c)).filter(Boolean).join('\n');
    scan(contents, res, 0);
    if (artifacts) artifactPages.push(pi);

    const annots = dictOf(doc, node) && node.get(PDFName.of('Annots'));
    const arr = annots instanceof PDFRef ? doc.context.lookup(annots) : annots;
    if (arr instanceof PDFArray && arr.asArray().some((a) => dictOf(doc, a)?.get(PDFName.of('Subtype')) === PDFName.of('Watermark')))
      annotPages.push(pi);

    // describe xobjects for labels
    const xd = res && dictOf(doc, res.get(PDFName.of('XObject')));
    xd?.entries().forEach(([, v]) => {
      const k = refKey(v);
      if (k && !xobjInfo.has(k)) {
        const d = dictOf(doc, v);
        const sub = d?.get(PDFName.of('Subtype'));
        const w = d?.get(PDFName.of('Width'));
        const h = d?.get(PDFName.of('Height'));
        xobjInfo.set(k, sub === PDFName.of('Image') ? `Image ${w ?? ''}×${h ?? ''}`.trim() : 'Stamp / drawing');
      }
    });
  });

  const many = (n: number) => total >= 2 && n >= Math.max(2, Math.ceil(total * 0.6));
  const out: WatermarkCandidate[] = [];
  if (artifactPages.length) out.push({ id: 'artifact', kind: 'artifact', label: 'Watermark added by Word / Acrobat', pages: artifactPages });
  if (annotPages.length) out.push({ id: 'annot', kind: 'annot', label: 'Watermark annotation', pages: annotPages });

  // layers: look up OCG names
  ocgPages.forEach((set, k) => {
    const [num, gen] = k.split('_').map(Number);
    const d = dictOf(doc, PDFRef.of(num, gen));
    const nm = d?.get(PDFName.of('Name'));
    const name = nm ? (nm as any).decodeText?.() ?? String(nm) : 'Layer';
    out.push({ id: `ocg:${k}`, kind: 'ocg', label: `Layer “${name}”`, pages: [...set] });
  });
  // put layers that look like watermarks first
  out.sort((a, b) => Number(/water|draft|confidential|stamp/i.test(b.label)) - Number(/water|draft|confidential|stamp/i.test(a.label)));

  xobjPages.forEach((set, k) => {
    if (many(set.size)) out.push({ id: `xobj:${k}`, kind: 'xobj', label: `${xobjInfo.get(k) ?? 'Image'} repeated on every page`, pages: [...set] });
  });
  textPages.forEach((set, t) => {
    if (many(set.size) || total === 1) out.push({ id: `text:${t}`, kind: 'text', label: `Slanted text “${t.slice(0, 40)}”`, pages: [...set] });
  });
  return out;
}

/** Count pages containing a text (simple-encoded fonts only). */
export async function findText(bytes: Uint8Array, query: string): Promise<number[]> {
  const q = norm(query);
  if (!q) return [];
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const hits: number[] = [];
  doc.getPages().forEach((page, pi) => {
    const src = pageContentRefs(doc, page.node).map((c) => streamText(doc, c)).filter(Boolean).join('\n');
    const { out } = analyse(doc, src, resourcesOf(doc, page.node), { artifact: false, ocgs: new Set(), xobjs: new Set(), texts: [q] });
    if (out !== null) hits.push(pi);
  });
  return hits;
}

/**
 * Remove the selected watermarks. `extraText` = text the user typed.
 * `onlyPage` = process a single page and return a 1-page PDF (used for the before/after preview).
 */
export async function removeWatermarks(
  bytes: Uint8Array,
  ids: string[],
  extraText = '',
  onlyPage?: number,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const target: Target = {
    artifact: ids.includes('artifact'),
    ocgs: new Set(ids.filter((i) => i.startsWith('ocg:')).map((i) => i.slice(4))),
    xobjs: new Set(ids.filter((i) => i.startsWith('xobj:')).map((i) => i.slice(5))),
    texts: [...ids.filter((i) => i.startsWith('text:')).map((i) => i.slice(5)), norm(extraText)].filter(Boolean),
  };
  const ctx = doc.context;
  const doneForms = new Set<string>();

  const rewriteForms = (formRefs: unknown[], r: PDFDict | undefined, depth: number) => {
    for (const f of formRefs) {
      const k = refKey(f);
      if (!k || doneForms.has(k) || depth > 2) continue;
      doneForms.add(k);
      const st = ctx.lookup(f as PDFRef);
      if (!(st instanceof PDFStream)) continue;
      const fr = dictOf(doc, st.dict.get(PDFName.of('Resources'))) ?? r;
      const src = streamText(doc, st);
      if (src === null) continue;
      const { found, out } = analyse(doc, src, fr, { ...target, xobjs: new Set() }); // keep images inside forms
      if (out !== null) {
        const dict: Record<string, unknown> = {};
        st.dict.entries().forEach(([key, v]) => {
          const n = key.asString().slice(1);
          if (!['Length', 'Filter', 'DecodeParms'].includes(n)) dict[n] = v;
        });
        ctx.assign(f as PDFRef, ctx.flateStream(fromLatin1(out), dict as any));
      }
      rewriteForms(found.formRefs, fr, depth + 1);
    }
  };

  const pages = doc.getPages();
  pages.forEach((page, pi) => {
    if (onlyPage !== undefined && pi !== onlyPage) return;
    const node = page.node;
    const res = resourcesOf(doc, node);
    const src = pageContentRefs(doc, node).map((c) => streamText(doc, c)).filter(Boolean).join('\n');
    const { found, out } = analyse(doc, src, res, target);
    if (out !== null) node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(fromLatin1(out))));
    rewriteForms(found.formRefs, res, 0);

    if (ids.includes('annot')) {
      const a = node.get(PDFName.of('Annots'));
      const arr = a instanceof PDFRef ? ctx.lookup(a) : a;
      if (arr instanceof PDFArray) {
        const keep = arr.asArray().filter((x) => dictOf(doc, x)?.get(PDFName.of('Subtype')) !== PDFName.of('Watermark'));
        node.set(PDFName.of('Annots'), ctx.obj(keep));
      }
    }
  });

  // hide removed layers from the layer list too
  if (target.ocgs.size) {
    const ocp = dictOf(doc, doc.catalog.get(PDFName.of('OCProperties')));
    const ocgs = ocp?.get(PDFName.of('OCGs'));
    const list = ocgs instanceof PDFRef ? ctx.lookup(ocgs) : ocgs;
    const keep = (a: unknown) => {
      const v = a instanceof PDFRef ? ctx.lookup(a) : a;
      return v instanceof PDFArray ? ctx.obj(v.asArray().filter((r) => !target.ocgs.has(refKey(r)))) : undefined;
    };
    if (ocp && list instanceof PDFArray) ocp.set(PDFName.of('OCGs'), keep(list)!);
    const D = ocp && dictOf(doc, ocp.get(PDFName.of('D')));
    for (const key of ['ON', 'OFF', 'Order', 'Locked']) {
      const v = D?.get(PDFName.of(key));
      const k = v && keep(v);
      if (D && k) D.set(PDFName.of(key), k);
    }
  }

  if (onlyPage !== undefined) {
    const one = await PDFDocument.create();
    const [p] = await one.copyPages(doc, [onlyPage]);
    one.addPage(p);
    return one.save();
  }
  return doc.save();
}
