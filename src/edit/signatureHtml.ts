/**
 * Finger signature pad (WebView canvas). Exports a tightly-cropped transparent PNG.
 * RN → Web: __clear() · __setColor(c) · __export()
 * Web → RN: {type:'ready'} · {type:'drawn', empty} · {type:'png', data, width, height} · {type:'empty'}
 */
const script = String.raw`
(function () {
  var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var cv = document.getElementById('c'), ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
  var color = '#1B1E28', drawing = false, last = null, mid = null, strokes = 0;
  function size() {
    var data = strokes ? cv.toDataURL() : null;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (data) { var im = new Image(); im.onload = function () { ctx.drawImage(im, 0, 0, innerWidth, innerHeight); }; im.src = data; }
  }
  function pos(e) { var t = e.touches ? e.touches[0] : e; return { x: t.clientX, y: t.clientY, t: Date.now() }; }
  function start(e) { e.preventDefault(); drawing = true; last = pos(e); mid = last;
    ctx.beginPath(); ctx.fillStyle = color; ctx.arc(last.x, last.y, 1.6, 0, Math.PI * 2); ctx.fill(); }
  function move(e) {
    if (!drawing) return; e.preventDefault();
    var p = pos(e), m = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    var speed = Math.hypot(p.x - last.x, p.y - last.y) / Math.max(1, p.t - last.t);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.8, 4.2 - speed * 1.4); // faster = thinner, like ink
    ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.quadraticCurveTo(last.x, last.y, m.x, m.y); ctx.stroke();
    last = p; mid = m;
  }
  function end() { if (drawing) { strokes++; post({ type: 'drawn', empty: false }); } drawing = false; }
  cv.addEventListener('touchstart', start, { passive: false }); cv.addEventListener('touchmove', move, { passive: false });
  cv.addEventListener('touchend', end); cv.addEventListener('mousedown', start);
  addEventListener('mousemove', move); addEventListener('mouseup', end); addEventListener('resize', size);

  window.__clear = function () { ctx.clearRect(0, 0, cv.width, cv.height); strokes = 0; post({ type: 'drawn', empty: true }); };
  window.__setColor = function (c) { color = c; };
  window.__export = function () {
    if (!strokes) { post({ type: 'empty' }); return; }
    var d = ctx.getImageData(0, 0, cv.width, cv.height).data, W = cv.width, H = cv.height;
    var x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (var y = 0; y < H; y += 2) for (var x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { post({ type: 'empty' }); return; }
    var pad = 10 * dpr; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W, x1 + pad); y1 = Math.min(H, y1 + pad);
    var out = document.createElement('canvas'); out.width = x1 - x0; out.height = y1 - y0;
    out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    post({ type: 'png', data: out.toDataURL('image/png').split(',')[1], width: out.width, height: out.height });
  };
  size(); post({ type: 'ready' });
})();
`;

export const SIGNATURE_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;height:100%;overflow:hidden;touch-action:none;background:transparent}
canvas{display:block}
.line{position:fixed;left:24px;right:24px;bottom:28%;border-bottom:2px dashed rgba(127,127,127,.45);pointer-events:none}
.x{position:fixed;left:24px;bottom:calc(28% + 6px);font:600 22px sans-serif;color:rgba(127,127,127,.6);pointer-events:none}</style>
</head><body><div class="line"></div><div class="x">✕</div><canvas id="c"></canvas><script>${script}</script></body></html>`;
