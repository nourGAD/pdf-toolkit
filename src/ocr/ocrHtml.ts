import { TESS_ARA, TESS_CORE, TESS_ENG, TESS_LIB, TESS_WORKER } from './ocrBundle';

/**
 * Offline OCR (Arabic + English) with tesseract.js inside a hidden WebView.
 * Nothing is downloaded: the worker, the WASM engine and both language models are embedded,
 * and the worker's fetch/importScripts are redirected to those embedded copies.
 *
 * RN → Web: __begin(id) · __chunk(id, base64Piece) · __ocr(id, {pdf:boolean}) · __langs(id, 'ara+eng'|'ara'|'eng')
 * Web → RN: {type:'ready'} · {type:'progress', id, p} · {type:'done', id, text, conf, pdf?:base64 (invisible text layer only)} · {type:'error', id, message}
 */
const script = String.raw`
(function () {
  var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var current = null;
  function txt(id) { return document.getElementById(id).textContent; }
  function blobUrl(content, type) { return URL.createObjectURL(new Blob([content], { type: type })); }

  // One self-contained worker: embedded models + engine + tesseract's worker code.
  // (blob: URLs can't be importScripts()-ed from an opaque-origin WebView, so nothing is loaded by URL.)
  var prelude =
    'var __L={ara:' + JSON.stringify(window.__ARA) + ',eng:' + JSON.stringify(window.__ENG) + '};' +
    'var __CORE=' + JSON.stringify(txt('core')) + ';' +
    'function __b(b){var s=atob(b),n=s.length,u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=s.charCodeAt(i);return u}' +
    'var __i=self.importScripts.bind(self);' +
    'self.importScripts=function(){for(var k=0;k<arguments.length;k++){var u=String(arguments[k]);if(/tesseract-core/.test(u)){(0,eval)(__CORE);__CORE=null}else __i(u)}};' +
    'self.fetch=function(u){var m=/\\/(\\w+)\\.traineddata/.exec(String(u));if(m&&__L[m[1]]){var d=__b(__L[m[1]]);__L[m[1]]=null;return Promise.resolve(new Response(d))}return Promise.reject(new Error("offline: "+u))};\n';
  var wrapper = blobUrl(prelude + txt('worker'), 'text/javascript');
  window.__ARA = window.__ENG = null; // free the main-thread copies

  var workerP = Tesseract.createWorker(['ara', 'eng'], 1, {
    workerPath: wrapper,
    workerBlobURL: false,
    corePath: 'https://offline/tesseract-core-simd-lstm.wasm.js',
    langPath: 'https://offline/lang',
    gzip: true,
    cacheMethod: 'none',
    logger: function (m) { if (current && m.status === 'recognizing text') post({ type: 'progress', id: current, p: m.progress }); }
  });
  workerP.then(function () { post({ type: 'ready' }); }, function (e) { post({ type: 'error', id: '', message: 'OCR engine failed to start: ' + (e && e.message || e) }); });

  var langs = 'ara+eng';
  // switch languages without reloading: 'ara+eng' | 'ara' | 'eng'
  window.__langs = function (id, l) {
    workerP.then(function (w) { return l === langs ? null : w.reinitialize(l, 1).then(function () { langs = l; }); })
      .then(function () { post({ type: 'done', id: id }); }, function (e) { post({ type: 'error', id: id, message: String(e && e.message || e) }); });
  };

  var bufs = {};
  window.__begin = function (id) { bufs[id] = []; };
  window.__chunk = function (id, piece) { bufs[id].push(piece); };
  window.__ocr = function (id, o) {
    var src = 'data:image/jpeg;base64,' + bufs[id].join(''); delete bufs[id];
    current = id;
    workerP.then(function (w) {
      return w.recognize(src, { pdfTitle: 'PDF Toolkit OCR', pdfTextOnly: true }, { text: true, pdf: !!(o && o.pdf) });
    }).then(function (r) {
      var pdf = null;
      if (r.data.pdf) { var a = r.data.pdf, s = ''; for (var i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.slice(i, i + 0x8000)); pdf = btoa(s); }
      post({ type: 'done', id: id, text: r.data.text || '', conf: r.data.confidence || 0, pdf: pdf });
    }).catch(function (e) { post({ type: 'error', id: id, message: String(e && e.message || e) }); })
      .then(function () { current = null; });
  };
})();
`;

export const OCR_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script type="text/plain" id="core">${TESS_CORE}</script>
<script type="text/plain" id="worker">${TESS_WORKER}</script>
<script>window.__ARA=${JSON.stringify(TESS_ARA)};window.__ENG=${JSON.stringify(TESS_ENG)};</script>
<script>${TESS_LIB}</script>
<script>${script}</script></body></html>`;
