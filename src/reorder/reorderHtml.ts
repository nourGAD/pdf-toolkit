/**
 * Page reordering grid (WebView). Two ways to move a page:
 *   1) tap a page, then tap the place it should go      (always works)
 *   2) press and hold a page, then drag it               (long-press drag)
 * RN → Web: __add(index, dataUrl) · __done() · __setDark(bool) · __reset()
 * Web → RN: {type:'ready'} · {type:'order', order:[…]} · {type:'drag', on} · {type:'height', h}
 */
const script = String.raw`
(function () {
  var post = function (m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var grid = document.getElementById('g'), hint = document.getElementById('hint');
  var selected = null, drag = null, timer = null, startPt = null, moved = false, suppressClick = false;
  var HINT = 'اضغط على صفحة ثم اضغط على مكانها الجديد — أو اضغط مطوّلًا واسحب · Tap a page, then tap its new place — or hold and drag';

  function tiles() { return Array.prototype.slice.call(grid.children); }
  function order() { return tiles().map(function (t) { return +t.dataset.i; }); }
  function sync() { post({ type: 'order', order: order() }); size(); }
  function size() { post({ type: 'height', h: Math.ceil(grid.getBoundingClientRect().bottom + window.scrollY + 8) }); }
  function select(t) {
    if (selected) selected.classList.remove('sel');
    selected = t; if (t) t.classList.add('sel');
    hint.textContent = t ? 'الآن اضغط على المكان الجديد · Now tap where page ' + (+t.dataset.i + 1) + ' should go' : HINT;
  }
  function moveNear(el, target) { // put el where target is, shifting target the natural way
    var list = tiles(), a = list.indexOf(el), b = list.indexOf(target);
    if (a < 0 || b < 0 || a === b) return;
    grid.insertBefore(el, a < b ? target.nextSibling : target);
  }

  window.__add = function (i, src) {
    var t = document.createElement('div'); t.className = 'tile'; t.dataset.i = i;
    t.innerHTML = '<img draggable="false" src="' + src + '"><b></b><span>' + (i + 1) + '</span>';
    grid.appendChild(t);
  };
  window.__done = function () { hint.textContent = HINT; size(); setTimeout(size, 300); };
  window.__setDark = function (on) { document.documentElement.classList.toggle('dark', !!on); };
  window.__reset = function () {
    tiles().sort(function (a, b) { return a.dataset.i - b.dataset.i; }).forEach(function (t) { grid.appendChild(t); });
    select(null); sync();
  };

  // ---- tap to move ----
  grid.addEventListener('click', function (e) {
    if (suppressClick) { suppressClick = false; return; }
    var t = e.target.closest && e.target.closest('.tile'); if (!t) return;
    if (!selected) return select(t);
    if (selected === t) return select(null);
    moveNear(selected, t); select(null); sync();
  });

  // ---- long-press drag ----
  function pt(e) { var p = e.touches ? e.touches[0] : e; return { x: p.clientX, y: p.clientY }; }
  function down(e) {
    var t = e.target.closest && e.target.closest('.tile'); if (!t) return;
    startPt = pt(e); moved = false;
    clearTimeout(timer);
    timer = setTimeout(function () {
      drag = t; t.classList.add('drag'); select(null);
      hint.textContent = 'اسحب للمكان الجديد · Drag to the new place';
      post({ type: 'drag', on: true });
      if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) {}
    }, 280);
  }
  function move(e) {
    var p = pt(e);
    if (!drag) { // finger moved before the long-press fired → it's a scroll, not a drag
      if (startPt && Math.hypot(p.x - startPt.x, p.y - startPt.y) > 8) clearTimeout(timer);
      return;
    }
    e.preventDefault(); moved = true;
    var el = document.elementFromPoint(p.x, p.y), t = el && el.closest && el.closest('.tile');
    if (t && t !== drag) moveNear(drag, t);
  }
  function up() {
    clearTimeout(timer); startPt = null;
    if (!drag) return;
    drag.classList.remove('drag'); drag = null; suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 350);
    hint.textContent = HINT;
    post({ type: 'drag', on: false }); sync();
  }
  grid.addEventListener('touchstart', down, { passive: true });
  grid.addEventListener('touchmove', move, { passive: false });
  grid.addEventListener('touchend', up); grid.addEventListener('touchcancel', up);
  grid.addEventListener('mousedown', down); window.addEventListener('mousemove', function (e) { if (startPt) move(e); }); window.addEventListener('mouseup', up);
  grid.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  post({ type: 'ready' });
})();
`;

export const REORDER_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  :root{--bg:transparent;--card:#EEF0F4;--ink:#5B6170;--accent:#1F8FE5}
  html.dark{--card:#24272F;--ink:#A3A9B6}
  html,body{margin:0;background:var(--bg);-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;font-family:-apple-system,Roboto,"Noto Sans Arabic",sans-serif}
  #hint{font-size:12.5px;line-height:1.5;color:var(--ink);padding:2px 2px 10px;text-align:center}
  #g{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;counter-reset:pos;padding-bottom:4px}
  .tile{position:relative;background:var(--card);border-radius:10px;padding:4px 4px 22px;border:2px solid transparent;counter-increment:pos;transition:transform .12s,box-shadow .12s}
  .tile img{display:block;width:100%;aspect-ratio:0.72;object-fit:contain;background:#fff;border-radius:6px;pointer-events:none}
  .tile b:before{content:counter(pos)}
  .tile b{position:absolute;left:0;right:0;bottom:3px;text-align:center;font-size:13px;color:var(--ink)}
  .tile span{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;font-weight:700;border-radius:6px;padding:1px 5px}
  .tile.sel{border-color:var(--accent);box-shadow:0 0 0 3px rgba(31,143,229,.25)}
  .tile.drag{border-color:var(--accent);transform:scale(1.06);box-shadow:0 8px 20px rgba(0,0,0,.3);z-index:2;opacity:.92}
</style></head><body><div id="hint"></div><div id="g"></div><script>${script}</script></body></html>`;
