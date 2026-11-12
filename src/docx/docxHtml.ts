import { MAMMOTH_LIB } from './mammothBundle';

/**
 * Offline Word (.docx) viewer: mammoth.js converts the document to clean HTML inside a WebView.
 *
 * RN → Web: __load(base64, {dark, font, pos}) · __setDark(bool) · __setFont(scale) · __restore(pos)
 *           __parasFromVisible(reqId) · __highlight(i)  (-1 = clear)
 * Web → RN: {type:'ready'} | {type:'loaded', paragraphs, warnings} | {type:'scroll', pos}
 *           {type:'paras', reqId, items:[{i,text}]} | {type:'error', message}
 */
const script = String.raw`
(function () {
  var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var docEl = document.getElementById('doc'), blocks = [], current = -1;

  function b64ToBuf(b64) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  window.__setDark = function (on) { document.documentElement.classList.toggle('dark', !!on); };
  window.__setFont = function (s) { document.documentElement.style.setProperty('--fs', (17 * s) + 'px'); };
  window.__restore = function (pos) {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (max > 0 && pos > 0) window.scrollTo(0, pos * max);
  };

  window.__load = function (b64, o) {
    o = o || {};
    window.__setDark(o.dark); window.__setFont(o.font || 1);
    mammoth.convertToHtml({ arrayBuffer: b64ToBuf(b64) }, {
      styleMap: ["p[style-name='Title'] => h1.title:fresh", "p[style-name='Subtitle'] => p.subtitle:fresh"]
    }).then(function (r) {
      docEl.innerHTML = r.value || '<p class="empty">This document is empty.</p>';
      blocks = Array.prototype.slice.call(docEl.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li'))
        .filter(function (el) { return el.textContent.trim().length > 0; });
      blocks.forEach(function (el, i) { el.dataset.i = i; el.setAttribute('dir', 'auto'); });
      docEl.querySelectorAll('td,th').forEach(function (el) { el.setAttribute('dir', 'auto'); });
      post({ type: 'loaded', paragraphs: blocks.length, warnings: (r.messages || []).length });
      setTimeout(function () { window.__restore(o.pos || 0); }, 60);
    }).catch(function (e) { post({ type: 'error', message: String(e && e.message || e) }); });
  };

  var t = null;
  window.addEventListener('scroll', function () {
    if (t) return;
    t = setTimeout(function () {
      t = null;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      post({ type: 'scroll', pos: max > 0 ? Math.min(1, window.scrollY / max) : 0 });
    }, 400);
  }, { passive: true });

  window.__parasFromVisible = function (reqId) {
    var start = 0;
    for (var i = 0; i < blocks.length; i++) { if (blocks[i].getBoundingClientRect().bottom > 8) { start = i; break; } }
    // continue from the paragraph where reading stopped — if it's still on screen
    if (current >= 0 && blocks[current]) {
      var r = blocks[current].getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) start = current;
    }
    var items = [];
    for (var j = start; j < blocks.length && items.length < 600; j++) items.push({ i: j, text: blocks[j].textContent.trim() });
    post({ type: 'paras', reqId: reqId, items: items });
  };

  window.__highlight = function (i) {
    if (current >= 0 && blocks[current]) blocks[current].classList.remove('reading');
    current = i;
    if (i >= 0 && blocks[i]) {
      blocks[i].classList.add('reading');
      blocks[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  post({ type: 'ready' });
})();
`;

export const DOCX_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<style>
  :root{--fs:17px;--bg:#E9EBF0;--paper:#fff;--ink:#1B1E28;--sub:#5B6170;--line:#E1E4EC;--hl:#FFF3B0}
  html.dark{--bg:#0E0F12;--paper:#1A1C22;--ink:#E6E8EE;--sub:#A3A9B6;--line:#2C2F38;--hl:#3B3410}
  html,body{margin:0;background:var(--bg);color:var(--ink);-webkit-text-size-adjust:100%}
  #doc{background:var(--paper);margin:10px;padding:22px 20px 120px;border-radius:8px;min-height:80vh;
       font:var(--fs)/1.65 -apple-system,Roboto,"Noto Sans Arabic","Noto Sans",sans-serif;word-wrap:break-word;
       box-shadow:0 1px 4px rgba(0,0,0,.12)}
  h1,h2,h3,h4{line-height:1.3;margin:1.2em 0 .5em} h1{font-size:1.6em} h2{font-size:1.35em} h3{font-size:1.15em}
  h1.title{font-size:1.9em;margin-top:0} p.subtitle{color:var(--sub);font-size:1.1em}
  p{margin:.55em 0} [dir=auto]{text-align:start} ul,ol{padding-inline-start:1.4em}
  img{max-width:100%;height:auto;border-radius:4px} html.dark img{opacity:.9}
  table{border-collapse:collapse;width:100%;margin:1em 0;display:block;overflow-x:auto;font-size:.9em}
  td,th{border:1px solid var(--line);padding:6px 8px;vertical-align:top} th{background:rgba(127,127,127,.12)}
  a{color:#1F8FE5}
  .reading{background:var(--hl);border-radius:4px;box-shadow:0 0 0 4px var(--hl);transition:background .2s}
  .empty{color:var(--sub);text-align:center}
</style>
<script>${MAMMOTH_LIB}</script></head>
<body><div id="doc"></div><script>${script}</script></body></html>`;
