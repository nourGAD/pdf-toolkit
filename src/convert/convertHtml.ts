import { MAMMOTH_LIB } from '../docx/mammothBundle';
import { PDFJS_LIB, PDFJS_WORKER } from '../reader/pdfjsBundle';
import { TEXT_LINES_JS } from '../reader/textLines';

/**
 * Word ⇄ PDF helpers (hidden WebView):
 *  __docx2html(id)  → {html}                       Word (.docx) → printable HTML (then expo-print makes the PDF)
 *  __pdftext(id)    → {pages:[{lines:[{text,rtl}]}]}  text of each PDF page, line by line (for PDF → Word)
 */
const script = String.raw`
(function () {
  var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var bufs = {};
  window.__begin = function (id) { bufs[id] = []; };
  window.__chunk = function (id, p) { bufs[id].push(p); };
  function bytes(id) { var s = atob(bufs[id].join('')); delete bufs[id]; var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  var fail = function (id) { return function (e) { post({ type: 'error', id: id, message: String(e && e.message || e) }); }; };

  window.__docx2html = function (id) {
    mammoth.convertToHtml({ arrayBuffer: bytes(id).buffer }).then(function (r) {
      var body = (r.value || '').replace(/<(p|h[1-6]|li|td|th)>/g, '<$1 dir="auto">');
      var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        '@page{size:A4;margin:18mm 16mm}body{font:12pt/1.55 -apple-system,Roboto,"Noto Sans Arabic","Noto Naskh Arabic",sans-serif;color:#111}' +
        'h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13.5pt}p{margin:0 0 8pt}[dir=auto]{text-align:start}' +
        'table{border-collapse:collapse;width:100%;margin:8pt 0}td,th{border:1px solid #999;padding:4pt 6pt;vertical-align:top}' +
        'img{max-width:100%}ul,ol{padding-inline-start:18pt}</style></head><body>' + body + '</body></html>';
      post({ type: 'done', id: id, html: html, warnings: (r.messages || []).length });
    }).catch(fail(id));
  };

  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  window.__pdftext = function (id) {
    pdfjsLib.getDocument({ data: bytes(id), isEvalSupported: false }).promise.then(function (doc) {
      var pages = [], n = doc.numPages, i = 0;
      function next() {
        if (++i > n) return post({ type: 'done', id: id, pages: pages });
        post({ type: 'progress', id: id, p: (i - 1) / n });
        return doc.getPage(i).then(function (pg) { return pg.getTextContent({ disableNormalization: true }); }).then(function (tc) {
          pages.push({ lines: buildLines(tc.items) });
          return next();
        });
      }
      return next();
    }).catch(fail(id));
  };
  post({ type: 'ready' });
})();
`;

export const CONVERT_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script>${PDFJS_WORKER}</script><script>${PDFJS_LIB}</script><script>${MAMMOTH_LIB}</script>
<script>${TEXT_LINES_JS}</script><script>${script}</script></body></html>`;
