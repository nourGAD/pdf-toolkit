/**
 * Rebuilds reading-order lines from pdf.js text pieces. Handles Arabic (right-to-left) lines whose
 * pieces are stored in visual order, per-glyph text (e.g. Chrome/Word-printed PDFs) and lam-alef ligatures.
 * Shared by the reader (read aloud) and PDF → Word. Defines window.buildLines(items) → [{text, rtl}].
 * Use getTextContent({ disableNormalization: true }).
 */
export const TEXT_LINES_JS = String.raw`
(function () {
  // ---- rebuild reading-order lines from positioned text pieces (works for Arabic and mixed lines) ----
  var AR = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g, LAT = /[A-Za-z]/g;
  function rev(s) { return Array.from(s).reverse().join(''); }
  // visual (left→right) Arabic line → logical order: reverse everything, then put Latin/number runs back the right way
  function visualToLogical(s) { return rev(s).replace(/[A-Za-z0-9][A-Za-z0-9.,:/%@_+\-]*[A-Za-z0-9%]|[A-Za-z0-9]/g, function (m) { return rev(m); }); }
  // which of two candidates reads like real Arabic? words often START with "ال" and rarely END with "لا"
  function arabicScore(s) { var w = s.split(/\s+/), sc = 0; w.forEach(function (x) { x = x.replace(/[^\u0600-\u06FF]/g, ''); if (/^ال/.test(x)) sc++; if (/لا$/.test(x) && x.length > 2) sc--; if (/^[ةى]/.test(x)) sc--; if (/[ةى]$/.test(x)) sc++; }); return sc; }
  window.buildLines = function buildLines(items) {
    var pcs = items.filter(function (it) { return it.str !== undefined && it.str.length; }).map(function (it) {
      var h = Math.abs(it.transform[3]) || it.height || 10;
      return { s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: h, rtl: it.dir === 'rtl' };
    });
    pcs.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    pcs.forEach(function (p) {
      var L = lines.length ? lines[lines.length - 1] : null;
      if (L && Math.abs(L.y - p.y) < Math.max(2, Math.min(L.h, p.h) * 0.5)) L.p.push(p); else lines.push({ y: p.y, h: p.h, p: [p] });
    });
    return lines.map(function (L) {
      var ps = L.p.sort(function (a, b) { return a.x - b.x; });
      var ar = 0, lat = 0; ps.forEach(function (p) { ar += (p.s.match(AR) || []).length; lat += (p.s.match(LAT) || []).length; });
      var isRtl = ar > lat;
      function join(list, flip) { // list in reading order; flip = reverse the text inside rtl pieces
        var out = '', prev = null;
        list.forEach(function (p) {
          var t = (flip && p.rtl ? rev(p.s) : p.s).normalize('NFKC'); // normalize AFTER reordering so ligatures (ﻻ) stay correct
          var gap = prev === null ? 0 : isRtl ? prev.x - (p.x + p.w) : p.x - (prev.x + prev.w);
          var scriptChange = prev !== null && /[A-Za-z0-9]/.test(prev.s) !== /[A-Za-z0-9]/.test(p.s) && !/[\u0600-\u06FF]/.test(prev.s + p.s) === false;
          if (prev !== null && (gap > p.h * 0.08 || scriptChange) && !/\s$/.test(out) && !/^\s/.test(t)) out += ' ';
          out += t; prev = p;
        });
        return out.replace(/\s+/g, ' ').trim();
      }
      if (!isRtl) return { text: join(ps, false), rtl: false };
      var rtlOrder = ps.slice().reverse(); // right → left = reading order
      var a = join(rtlOrder, false), b = join(rtlOrder, true);
      return { text: arabicScore(b) > arabicScore(a) ? b : a, rtl: true };
    }).filter(function (l) { return l.text; });
  }

})();
`;
