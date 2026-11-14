import { MAMMOTH_LIB } from '../docx/mammothBundle';
import { PDFJS_LIB, PDFJS_WORKER } from '../reader/pdfjsBundle';
import { TEXT_LINES_JS } from '../reader/textLines';
import { XLSX_LIB } from './xlsxBundle';

/**
 * Summary & Dashboard engine (hidden WebView, 100% offline).
 *  __extract(id, kind) with kind = 'pdf' | 'docx' | 'xlsx' | 'csv'
 *  → { pages, text, headings: string[], tables: [{ name, rows: (string|number|null)[][], guessed? }] }
 * Text is used for the summary; tables (Excel sheets, Word tables, tables found in PDFs) feed the dashboard.
 */
const script = String.raw`
(function () {
  var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var bufs = {};
  window.__begin = function (id) { bufs[id] = []; };
  window.__chunk = function (id, p) { bufs[id].push(p); };
  function bytes(id) { var s = atob(bufs[id].join('')); delete bufs[id]; var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  var fail = function (id) { return function (e) { post({ type: 'error', id: id, message: String(e && e.message || e) }); }; };
  var MAX_ROWS = 20000, MAX_COLS = 60, MAX_TEXT = 400000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function cell(v) {
    if (v === undefined || v === null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    var s = String(v).replace(/\s+/g, ' ').trim();
    return s || null;
  }
  function trimTable(rows) {
    rows = rows.slice(0, MAX_ROWS + 1).map(function (r) { return (r || []).slice(0, MAX_COLS).map(cell); });
    rows = rows.filter(function (r) { return r.some(function (c) { return c !== null; }); });
    var w = 0; rows.forEach(function (r) { for (var i = r.length - 1; i >= 0; i--) if (r[i] !== null) { w = Math.max(w, i + 1); break; } });
    // drop columns that are completely empty
    var keep = []; for (var c = 0; c < w; c++) if (rows.some(function (r) { return r[c] !== null && r[c] !== undefined; })) keep.push(c);
    return rows.map(function (r) { return keep.map(function (c) { return r[c] === undefined ? null : r[c]; }); });
  }

  // ---------------- Excel / CSV ----------------
  function fromWorkbook(wb) {
    var tables = [], text = [];
    wb.SheetNames.forEach(function (name) {
      var sh = wb.Sheets[name]; if (!sh || !sh['!ref']) return;
      var rows = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: null, blankrows: false });
      rows = trimTable(rows);
      if (rows.length) tables.push({ name: name, rows: rows });
    });
    return { pages: tables.length, text: '', headings: tables.map(function (t) { return t.name; }), tables: tables };
  }
  window.__xlsx = function (id) {
    try { post({ type: 'done', id: id, data: fromWorkbook(XLSX.read(bytes(id), { type: 'array', cellDates: true, dense: true })) }); }
    catch (e) { fail(id)(e); }
  };
  window.__csv = function (id) {
    try {
      var u = bytes(id), s;
      try { s = new TextDecoder('utf-8', { fatal: true }).decode(u); } catch (e) { s = new TextDecoder('windows-1256').decode(u); }
      if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
      post({ type: 'done', id: id, data: fromWorkbook(XLSX.read(s, { type: 'string', cellDates: true, dense: true })) });
    } catch (e) { fail(id)(e); }
  };

  // ---------------- Word ----------------
  window.__docx = function (id) {
    mammoth.convertToHtml({ arrayBuffer: bytes(id).buffer }).then(function (r) {
      var doc = new DOMParser().parseFromString('<div>' + (r.value || '') + '</div>', 'text/html');
      var headings = [], paras = [], tables = [];
      doc.querySelectorAll('table').forEach(function (t, i) {
        var rows = [];
        t.querySelectorAll('tr').forEach(function (tr) {
          var r = []; tr.querySelectorAll('td,th').forEach(function (td) { r.push(td.textContent); }); rows.push(r);
        });
        rows = trimTable(rows);
        if (rows.length >= 2 && rows[0].length >= 2) tables.push({ name: 'Table ' + (i + 1), rows: rows });
        t.remove();
      });
      doc.querySelectorAll('h1,h2,h3,h4,p,li').forEach(function (el) {
        var s = el.textContent.replace(/\s+/g, ' ').trim(); if (!s) return;
        if (/^H[1-4]$/.test(el.tagName)) headings.push(s);
        paras.push(/[.!?؟:]$/.test(s) || /^H/.test(el.tagName) ? s : s + '.');
      });
      var text = paras.join('\n').slice(0, MAX_TEXT);
      var words = text.split(/\s+/).length;
      post({ type: 'done', id: id, data: { pages: Math.max(1, Math.round(words / 450)), text: text, headings: headings, tables: tables } });
    }).catch(fail(id));
  };

  // ---------------- PDF ----------------
  // rows of positioned text → cells split on wide gaps; runs of rows with the same number of cells = a table
  function pageTables(items, pageNo) {
    var pcs = items.filter(function (it) { return it.str && it.str.trim(); }).map(function (it) {
      return { s: it.str.normalize('NFKC'), x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 10 };
    });
    pcs.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var rows = [];
    pcs.forEach(function (p) {
      var R = rows.length ? rows[rows.length - 1] : null;
      if (R && Math.abs(R.y - p.y) < Math.max(2, Math.min(R.h, p.h) * 0.5)) R.p.push(p); else rows.push({ y: p.y, h: p.h, p: [p] });
    });
    var lines = rows.map(function (R) {
      var ps = R.p.sort(function (a, b) { return a.x - b.x; }), cells = [], cur = null, ar = 0, lat = 0;
      ps.forEach(function (p) {
        ar += (p.s.match(/[؀-ۿ]/g) || []).length; lat += (p.s.match(/[A-Za-z]/g) || []).length;
        if (cur && p.x - (cur.x2) < p.h * 1.4) { cur.s += (p.x - cur.x2 > p.h * 0.15 ? ' ' : '') + p.s; cur.x2 = p.x + p.w; }
        else { cur = { s: p.s, x: p.x, x2: p.x + p.w }; cells.push(cur); }
      });
      if (ar > lat) cells.reverse(); // Arabic tables read right → left
      return { cells: cells.map(function (c) { return c.s.trim(); }), xs: cells.map(function (c) { return Math.round(c.x); }) };
    });
    var out = [], run = [];
    function flush() {
      var numeric = 0; run.forEach(function (l, i) { if (i) l.cells.forEach(function (c) { if (/^[-+]?[\d٠-٩.,%\s$€£]+$/.test(c)) numeric++; }); });
      if (run.length >= 3 && numeric >= run.length - 1) out.push({ name: 'Page ' + pageNo + ' table', rows: trimTable(run.map(function (l) { return l.cells; })), guessed: true });
      run = [];
    }
    lines.forEach(function (l) {
      if (l.cells.length >= 2 && (!run.length || run[0].cells.length === l.cells.length)) run.push(l);
      else { flush(); if (l.cells.length >= 2) run.push(l); }
    });
    flush();
    return out;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  window.__pdf = function (id, password) {
    pdfjsLib.getDocument({ data: bytes(id), isEvalSupported: false, password: password || undefined }).promise.then(function (doc) {
      var n = doc.numPages, i = 0, text = [], tables = [], size = 0, headings = [];
      var outline = doc.getOutline().then(function (o) {
        (o || []).slice(0, 40).forEach(function (it) { if (it.title) headings.push(it.title.trim()); });
      }).catch(function () {});
      function next() {
        if (++i > n || size > MAX_TEXT) {
          return outline.then(function () {
            post({ type: 'done', id: id, data: { pages: n, text: text.join('\n'), headings: headings, tables: tables.slice(0, 30) } });
          });
        }
        post({ type: 'progress', id: id, p: (i - 1) / n });
        return doc.getPage(i).then(function (pg) { return pg.getTextContent({ disableNormalization: true }); }).then(function (tc) {
          var lines = buildLines(tc.items).map(function (l) { return l.text; });
          size += lines.join(' ').length;
          text.push(lines.join('\n'));
          if (tables.length < 30) tables = tables.concat(pageTables(tc.items, i));
          if (tc.items.length === 0) text.push('');
          return next();
        });
      }
      return next();
    }).catch(function (e) {
      if (e && e.name === 'PasswordException') return post({ type: 'error', id: id, message: 'PASSWORD' });
      fail(id)(e);
    });
  };
  post({ type: 'ready' });
})();
`;

export const INSIGHTS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script>${PDFJS_WORKER}</script><script>${PDFJS_LIB}</script><script>${MAMMOTH_LIB}</script><script>${XLSX_LIB}</script>
<script>${TEXT_LINES_JS}</script><script>${script}</script></body></html>`;
