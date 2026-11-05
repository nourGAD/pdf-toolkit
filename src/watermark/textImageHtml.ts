/**
 * Renders watermark text to a transparent PNG using the phone's own fonts.
 * The browser engine shapes Arabic correctly (joined letters, right-to-left) and supports any language/emoji,
 * which the built-in PDF fonts can't do.
 *
 * RN → Web: __render({ text, color, bold }) · Web → RN: { type:'png', data:'<base64>', width, height } | { type:'ready' }
 */
const script = String.raw`
(function () {
  var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  window.__render = function (o) {
    var text = String(o.text || '').trim();
    if (!text) { post({ type: 'png', data: '', width: 0, height: 0 }); return; }
    var size = 160, pad = 24, lineH = size * 1.25;
    var font = (o.bold === false ? '' : 'bold ') + size + 'px system-ui, -apple-system, Roboto, "Noto Sans Arabic", "Noto Sans", sans-serif';
    var lines = text.split(/\n/);
    ctx.font = font;
    var w = 1; lines.forEach(function (l) { w = Math.max(w, ctx.measureText(l).width); });
    cv.width = Math.ceil(w + pad * 2); cv.height = Math.ceil(lineH * lines.length + pad * 2);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.font = font; ctx.fillStyle = o.color || '#E5322D';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'inherit';
    lines.forEach(function (l, i) { ctx.fillText(l, cv.width / 2, pad + lineH * (i + 0.5)); });
    post({ type: 'png', data: cv.toDataURL('image/png').split(',')[1], width: cv.width, height: cv.height });
  };
  post({ type: 'ready' });
})();
`;

export const TEXT_IMAGE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script>${script}</script></body></html>`;
