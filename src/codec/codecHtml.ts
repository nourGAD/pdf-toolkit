/**
 * Image re-encoder running in a hidden WebView (canvas): used by "Compress PDF".
 * RN → Web: __begin(id) · __chunk(id, base64Piece) · __jpeg(id, maxSide, quality) · __raw(id, w, h, channels, maxSide, quality)
 * Web → RN: {type:'ready'} · {type:'done', id, data:<jpeg base64>|null, width, height}
 */
const script = String.raw`
(function () {
  var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var bufs = {};
  window.__begin = function (id) { bufs[id] = []; };
  window.__chunk = function (id, piece) { bufs[id].push(piece); };
  function take(id) { var s = bufs[id].join(''); delete bufs[id]; return s; }
  function fail(id) { post({ type: 'done', id: id, data: null, width: 0, height: 0 }); }

  function encode(id, source, sw, sh, maxSide, quality) {
    var k = Math.min(1, maxSide / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    x.imageSmoothingQuality = 'high';
    x.drawImage(source, 0, 0, w, h);
    post({ type: 'done', id: id, data: c.toDataURL('image/jpeg', quality).split(',')[1], width: w, height: h });
  }

  window.__jpeg = function (id, maxSide, quality) {
    try {
      var img = new Image();
      img.onload = function () { try { encode(id, img, img.naturalWidth, img.naturalHeight, maxSide, quality); } catch (e) { fail(id); } };
      img.onerror = function () { fail(id); };
      img.src = 'data:image/jpeg;base64,' + take(id);
    } catch (e) { fail(id); }
  };

  window.__raw = function (id, w, h, ch, maxSide, quality) {
    try {
      var bin = atob(take(id));
      if (bin.length < w * h * ch) return fail(id);
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d'), im = x.createImageData(w, h), d = im.data, n = w * h, i, j;
      if (ch === 3) for (i = 0, j = 0; i < n; i++, j += 3) { d[i * 4] = bin.charCodeAt(j); d[i * 4 + 1] = bin.charCodeAt(j + 1); d[i * 4 + 2] = bin.charCodeAt(j + 2); d[i * 4 + 3] = 255; }
      else for (i = 0; i < n; i++) { var v = bin.charCodeAt(i); d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
      x.putImageData(im, 0, 0);
      encode(id, c, w, h, maxSide, quality);
    } catch (e) { fail(id); }
  };
  post({ type: 'ready' });
})();
`;
export const CODEC_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>${script}</script></body></html>`;
