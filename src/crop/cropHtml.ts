/**
 * CamScanner-style 4-corner crop with perspective correction, running in a WebView canvas.
 *
 * RN → Web:  __setImage(dataUrl) · __rotate() · __reset() · __apply(maxSide)
 * Web → RN:  {type:'ready'} · {type:'loaded'} · {type:'result', data:'<jpeg base64>', width, height} · {type:'error', message}
 */
const script = String.raw`
(function () {
  var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var cv = document.getElementById('c'), ctx = cv.getContext('2d');
  var loupe = document.getElementById('loupe'), lctx = loupe.getContext('2d');
  var src = null;              // offscreen canvas holding the (possibly rotated) photo
  var pts = null;              // 4 corners in SOURCE pixels: tl, tr, br, bl
  var fit = { x: 0, y: 0, s: 1 }; // source → screen
  var drag = -1, dpr = window.devicePixelRatio || 1;

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
    if (src) {
      var pad = 28, s = Math.min((w - pad * 2) / src.width, (h - pad * 2) / src.height);
      fit = { s: s, x: (w - src.width * s) / 2, y: (h - src.height * s) / 2 };
    }
    draw();
  }
  var toScr = function (p) { return { x: fit.x + p.x * fit.s, y: fit.y + p.y * fit.s }; };
  var toSrc = function (x, y) { return { x: (x - fit.x) / fit.s, y: (y - fit.y) / fit.s }; };

  function defaultPts() {
    var w = src.width, h = src.height, m = 0.06;
    return [{ x: w * m, y: h * m }, { x: w * (1 - m), y: h * m }, { x: w * (1 - m), y: h * (1 - m) }, { x: w * m, y: h * (1 - m) }];
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!src) return;
    ctx.drawImage(src, fit.x, fit.y, src.width * fit.s, src.height * fit.s);
    var q = pts.map(toScr);
    // dim everything outside the quad
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.rect(0, 0, cv.width / dpr, cv.height / dpr);
    ctx.moveTo(q[0].x, q[0].y); for (var i = 3; i >= 0; i--) ctx.lineTo(q[i].x, q[i].y); ctx.closePath();
    ctx.fill('evenodd');
    // outline
    ctx.strokeStyle = '#2BA84A'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); for (var j = 1; j < 4; j++) ctx.lineTo(q[j].x, q[j].y); ctx.closePath(); ctx.stroke();
    // handles
    q.forEach(function (p, k) {
      ctx.beginPath(); ctx.arc(p.x, p.y, k === drag ? 15 : 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(43,168,74,0.35)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    });
  }

  // magnifier so the user can place corners precisely under the finger
  function drawLoupe(p) {
    var L = 120, zoom = 2.5;
    if (loupe.width !== L * dpr) { loupe.width = L * dpr; loupe.height = L * dpr; }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.fillStyle = '#111'; lctx.fillRect(0, 0, L, L);
    var size = L / (zoom * fit.s); // source pixels visible in the loupe
    lctx.drawImage(src, p.x - size / 2, p.y - size / 2, size, size, 0, 0, L, L);
    lctx.strokeStyle = '#2BA84A'; lctx.lineWidth = 1.5;
    lctx.beginPath(); lctx.moveTo(L / 2, 0); lctx.lineTo(L / 2, L); lctx.moveTo(0, L / 2); lctx.lineTo(L, L / 2); lctx.stroke();
    var scr = toScr(p);
    loupe.style.display = 'block';
    loupe.style.left = (scr.x < window.innerWidth / 2 ? window.innerWidth - L - 16 : 16) + 'px';
  }

  function pointerPos(e) { var t = e.touches ? e.touches[0] : e; return { x: t.clientX, y: t.clientY }; }
  function start(e) {
    if (!src) return;
    var p = pointerPos(e), best = -1, bd = 48 * 48;
    pts.forEach(function (q, i) { var s = toScr(q), d = (s.x - p.x) * (s.x - p.x) + (s.y - p.y) * (s.y - p.y); if (d < bd) { bd = d; best = i; } });
    drag = best;
    if (drag >= 0) { e.preventDefault(); drawLoupe(pts[drag]); draw(); }
  }
  function move(e) {
    if (drag < 0) return;
    e.preventDefault();
    var p = pointerPos(e), s = toSrc(p.x, p.y);
    pts[drag] = { x: Math.max(0, Math.min(src.width, s.x)), y: Math.max(0, Math.min(src.height, s.y)) };
    drawLoupe(pts[drag]); draw();
  }
  function end() { drag = -1; loupe.style.display = 'none'; draw(); }
  cv.addEventListener('touchstart', start, { passive: false });
  cv.addEventListener('touchmove', move, { passive: false });
  cv.addEventListener('touchend', end); cv.addEventListener('touchcancel', end);
  cv.addEventListener('mousedown', start); window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  window.addEventListener('resize', resize);

  window.__setImage = function (dataUrl) {
    var img = new Image();
    img.onload = function () {
      src = document.createElement('canvas'); src.width = img.naturalWidth; src.height = img.naturalHeight;
      src.getContext('2d').drawImage(img, 0, 0);
      pts = defaultPts(); resize(); post({ type: 'loaded', width: src.width, height: src.height });
    };
    img.onerror = function () { post({ type: 'error', message: 'Could not load image' }); };
    img.src = dataUrl;
  };

  window.__reset = function () { if (!src) return; pts = [{ x: 0, y: 0 }, { x: src.width, y: 0 }, { x: src.width, y: src.height }, { x: 0, y: src.height }]; draw(); };

  window.__rotate = function () { // 90° clockwise, corners follow the image
    if (!src) return;
    var r = document.createElement('canvas'); r.width = src.height; r.height = src.width;
    var c = r.getContext('2d'); c.translate(r.width, 0); c.rotate(Math.PI / 2); c.drawImage(src, 0, 0);
    var H = src.height;
    pts = pts.map(function (p) { return { x: H - p.y, y: p.x }; });
    pts = [pts[3], pts[0], pts[1], pts[2]];
    src = r; resize();
  };

  // unit square → quad (Heckbert). Returns f(u,v) → {x,y} in source pixels
  function squareToQuad(q) {
    var x0 = q[0].x, y0 = q[0].y, x1 = q[1].x, y1 = q[1].y, x2 = q[2].x, y2 = q[2].y, x3 = q[3].x, y3 = q[3].y;
    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    var a, b, c, d, e, f, g, h;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
      a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; h = 0;
    } else {
      var det = dx1 * dy2 - dx2 * dy1;
      g = (dx3 * dy2 - dx2 * dy3) / det; h = (dx1 * dy3 - dx3 * dy1) / det;
      a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
    }
    return { a: a, b: b, c: c, d: d, e: e, f: f, g: g, h: h };
  }

  // sort corners so tl,tr,br,bl even if the user crossed them
  function ordered(p) {
    var c = p.reduce(function (s, q) { return { x: s.x + q.x / 4, y: s.y + q.y / 4 }; }, { x: 0, y: 0 });
    var s = p.slice().sort(function (A, B) { return Math.atan2(A.y - c.y, A.x - c.x) - Math.atan2(B.y - c.y, B.x - c.x); });
    // atan2 order starts at -π (left) → rotate so the first is top-left (smallest x+y)
    var k = 0, m = Infinity; s.forEach(function (q, i) { if (q.x + q.y < m) { m = q.x + q.y; k = i; } });
    return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]];
  }

  window.__apply = function (maxSide) {
    try {
      var q = ordered(pts);
      var dist = function (A, B) { return Math.hypot(A.x - B.x, A.y - B.y); };
      var W = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
      var k = Math.min(1, (maxSide || 2480) / Math.max(W, H));
      W = Math.max(1, Math.round(W * k)); H = Math.max(1, Math.round(H * k));
      var M = squareToQuad(q);
      var sw = src.width, sh = src.height, sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
      var out = document.createElement('canvas'); out.width = W; out.height = H;
      var octx = out.getContext('2d'), od = octx.createImageData(W, H), o = od.data;
      for (var y = 0; y < H; y++) {
        var v = (y + 0.5) / H;
        for (var x = 0; x < W; x++) {
          var u = (x + 0.5) / W, den = M.g * u + M.h * v + 1;
          var sx = (M.a * u + M.b * v + M.c) / den - 0.5, sy = (M.d * u + M.e * v + M.f) / den - 0.5;
          var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
          if (x0 < 0) { x0 = 0; fx = 0; } if (y0 < 0) { y0 = 0; fy = 0; }
          var x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
          if (x0 > sw - 1) x0 = sw - 1; if (y0 > sh - 1) y0 = sh - 1;
          var i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
          var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy, oi = (y * W + x) * 4;
          o[oi] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
          o[oi + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
          o[oi + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
          o[oi + 3] = 255;
        }
      }
      octx.putImageData(od, 0, 0);
      var data = out.toDataURL('image/jpeg', 0.92).split(',')[1];
      post({ type: 'result', data: data, width: W, height: H });
    } catch (e) { post({ type: 'error', message: String(e && e.message || e) }); }
  };

  resize();
  post({ type: 'ready' });
})();
`;

export const CROP_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;height:100%;background:#111;overflow:hidden;touch-action:none}
canvas{display:block}#loupe{position:absolute;top:16px;width:120px;height:120px;border-radius:60px;border:3px solid #fff;display:none;box-shadow:0 2px 10px rgba(0,0,0,.6)}</style>
</head><body><canvas id="c"></canvas><canvas id="loupe"></canvas>
<script>${script}</script></body></html>`;
