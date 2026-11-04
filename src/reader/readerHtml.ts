import { PDFJS_LIB, PDFJS_WORKER } from './pdfjsBundle';

/**
 * Offline PDF viewer that runs inside a WebView using pdf.js (main-thread "fake worker").
 *
 * RN → Web (via injectJavaScript):
 *   window.__load(base64, startPage)   open a document and jump to a page
 *   window.__goto(page)                scroll to a page (1-based)
 *   window.__getText(page, reqId)      extract plain text of a page
 *   window.__highlight(on)             tint the page being read aloud
 *
 * Web → RN (postMessage JSON):
 *   {type:'loaded', pages} | {type:'page', page} | {type:'text', page, text, reqId} | {type:'error', message}
 */
const script = String.raw`
(function () {
  var lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = ''; // window.pdfjsWorker is present → runs on main thread
  var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var doc = null, pagesEl = document.getElementById('pages'), current = 1, rendered = {}, reading = false;
  var dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  function b64ToBytes(b64) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function renderPage(n) {
    if (rendered[n] || !doc) return;
    rendered[n] = true;
    doc.getPage(n).then(function (page) {
      var holder = document.getElementById('p' + n);
      var cssW = holder.clientWidth;
      var vp1 = page.getViewport({ scale: 1 });
      var vp = page.getViewport({ scale: (cssW / vp1.width) * dpr });
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      holder.style.height = (vp.height / dpr) + 'px';
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
        holder.innerHTML = ''; holder.appendChild(canvas);
      });
    }).catch(function (e) { rendered[n] = false; post({ type: 'error', message: String(e && e.message || e) }); });
  }

  function unrenderFar() { // keep memory low on big documents
    Object.keys(rendered).forEach(function (k) {
      var n = +k;
      if (Math.abs(n - current) > 6) {
        var h = document.getElementById('p' + n);
        if (h) { var hgt = h.clientHeight; h.innerHTML = '<span>' + n + '</span>'; h.style.height = hgt + 'px'; }
        delete rendered[k];
      }
    });
  }

  var visible = {};
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var n = +e.target.dataset.page;
      visible[n] = e.isIntersecting ? e.intersectionRatio : 0;
      if (e.isIntersecting) { renderPage(n); if (n + 1 <= doc.numPages) renderPage(n + 1); }
    });
    var best = current, bestR = -1;
    Object.keys(visible).forEach(function (k) { if (visible[k] > bestR) { bestR = visible[k]; best = +k; } });
    if (bestR > 0 && best !== current) { current = best; post({ type: 'page', page: current }); unrenderFar(); markReading(); }
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

  function markReading() {
    document.querySelectorAll('.page.reading').forEach(function (el) { el.classList.remove('reading'); });
    if (reading) { var el = document.getElementById('p' + current); if (el) el.classList.add('reading'); }
  }

  window.__load = function (b64, startPage) {
    lib.getDocument({ data: b64ToBytes(b64), isEvalSupported: false, useSystemFonts: true }).promise.then(function (d) {
      doc = d;
      return d.getPage(1).then(function (p1) {
        var vp = p1.getViewport({ scale: 1 }), ratio = vp.height / vp.width;
        var w = pagesEl.clientWidth;
        for (var i = 1; i <= d.numPages; i++) {
          var div = document.createElement('div');
          div.className = 'page'; div.id = 'p' + i; div.dataset.page = i;
          div.style.height = (w * ratio) + 'px';
          div.innerHTML = '<span>' + i + '</span>';
          pagesEl.appendChild(div); io.observe(div);
        }
        post({ type: 'loaded', pages: d.numPages });
        var s = Math.max(1, Math.min(startPage || 1, d.numPages));
        if (s > 1) setTimeout(function () { window.__goto(s); }, 50);
      });
    }).catch(function (e) {
      post({ type: 'error', message: e && e.name === 'PasswordException' ? 'This PDF is password-protected' : String(e && e.message || e) });
    });
  };

  window.__goto = function (n) {
    var el = document.getElementById('p' + n);
    if (!el) return;
    renderPage(n);
    el.scrollIntoView({ block: 'start' });
    current = n; post({ type: 'page', page: n }); markReading();
  };

  window.__highlight = function (on) { reading = !!on; markReading(); };

  window.__getText = function (n, reqId) {
    doc.getPage(n).then(function (page) { return page.getTextContent(); }).then(function (tc) {
      var text = '';
      tc.items.forEach(function (it) { if (it.str !== undefined) text += it.str + (it.hasEOL ? '\n' : ' '); });
      // Arabic presentation forms (ﻣ ﺮ ﺣ) → normal letters so the TTS engine can read them
      text = text.normalize('NFKC').replace(/[ \t]+/g, ' ').trim();
      post({ type: 'text', page: n, text: text, reqId: reqId });
    }).catch(function (e) { post({ type: 'text', page: n, text: '', reqId: reqId, error: String(e) }); });
  };

  post({ type: 'ready' });
})();
`;

export const READER_HTML = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes">
<style>
  html,body{margin:0;padding:0;background:#E9EBF0;-webkit-tap-highlight-color:transparent}
  #pages{padding:10px 8px 120px}
  .page{background:#fff;margin:0 auto 10px;box-shadow:0 1px 4px rgba(0,0,0,.15);position:relative;
        display:flex;align-items:center;justify-content:center;transition:box-shadow .2s}
  .page.reading{box-shadow:0 0 0 3px #1F8FE5}
  .page span{color:#B5B9C4;font:600 28px -apple-system,Roboto,sans-serif}
  .page canvas{width:100%;height:auto;display:block}
</style>
<script>${PDFJS_WORKER}</script>
<script>${PDFJS_LIB}</script>
</head><body><div id="pages"></div>
<script>${script}</script>
</body></html>`;
