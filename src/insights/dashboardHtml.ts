import { ChartSpec, Dataset, Kpi, Series, aggregate, chartTitle, fmtNum } from './analyze';

/**
 * Dashboard page (KPI tiles + SVG charts). The same HTML is shown in the app (interactive: tap ✎ to edit a chart)
 * and printed to PDF for Download/Share (print = light colours, no buttons).
 */
const PALETTE = ['#1F8FE5', '#E5322D', '#2EAD5B', '#F2A20C', '#7B4FD6', '#14A3A3', '#D6457B', '#6B7A8F'];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function barSvg(s: Series, color: string): string {
  const rowH = 26;
  const H = s.labels.length * rowH + 6;
  const max = Math.max(...s.values.map((v) => Math.abs(v)), 1);
  const rows = s.labels
    .map((l, i) => {
      const w = Math.max(1, (Math.abs(s.values[i]) / max) * 46);
      const y = i * rowH + 3;
      return `<text x="0" y="${y + 16}" class="lbl" ><tspan>${esc(clip(l, 18))}</tspan></text>
      <rect x="34%" y="${y + 3}" width="${w}%" height="${rowH - 9}" rx="4" fill="${color}"/>
      <text x="${34 + w + 1.5}%" y="${y + 16}" class="val">${fmtNum(s.values[i])}</text>`;
    })
    .join('');
  return `<svg width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg">${rows}</svg>`;
}

function lineSvg(s: Series, color: string): string {
  const W = 320;
  const H = 170;
  const L = 40;
  const B = 24;
  const n = s.values.length;
  const min = Math.min(0, ...s.values);
  const max = Math.max(...s.values, min + 1);
  const x = (i: number) => L + (n <= 1 ? (W - L) / 2 : (i / (n - 1)) * (W - L - 8));
  const y = (v: number) => 8 + (1 - (v - min) / (max - min)) * (H - B - 8);
  const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const grid = [0, 0.5, 1]
    .map((f) => {
      const v = min + (max - min) * f;
      return `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 4}" y="${y(v) + 4}" class="axis" text-anchor="end">${fmtNum(v)}</text>`;
    })
    .join('');
  const step = Math.max(1, Math.ceil(n / 5));
  const xl = s.labels
    .map((l, i) => ((i % step === 0 && (i === n - 1 || n - 1 - i >= step * 0.6)) || i === n - 1 ? `<text x="${x(i)}" y="${H - 6}" class="axis" text-anchor="${i === n - 1 && n > 1 ? 'end' : i === 0 && n > 1 ? 'start' : 'middle'}">${esc(clip(l.replace(/ 20(\d\d)$/, " '$1"), 9))}</text>` : ''))
    .join('');
  const area = n > 1 ? `<polygon points="${x(0)},${y(min)} ${pts} ${x(n - 1)},${y(min)}" fill="${color}" opacity="0.12"/>` : '';
  const dots = n <= 40 ? s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${color}"/>`).join('') : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">${grid}${area}
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>${dots}${xl}</svg>`;
}

function pieSvg(s: Series): string {
  const total = s.values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  let a0 = -Math.PI / 2;
  const R = 62;
  const r = 38;
  const cx = 75;
  const cy = 75;
  const arcs = s.values
    .map((v, i) => {
      const frac = Math.max(0, v) / total;
      if (frac <= 0) return '';
      if (frac >= 0.9999)
        return `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${PALETTE[i % 8]}" stroke-width="${R - r}"/>`;
      const a1 = a0 + frac * Math.PI * 2;
      const big = frac > 0.5 ? 1 : 0;
      const p = (ang: number, rad: number) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
      const d = `M${p(a0, R)} A${R},${R} 0 ${big} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${big} 0 ${p(a0, r)} Z`;
      a0 = a1;
      return `<path d="${d}" fill="${PALETTE[i % 8]}"/>`;
    })
    .join('');
  const legend = s.labels
    .map(
      (l, i) =>
        `<div class="leg"><i style="background:${PALETTE[i % 8]}"></i><span dir="auto">${esc(clip(l, 22))}</span><b>${((Math.max(0, s.values[i]) / total) * 100).toFixed(0)}%</b></div>`,
    )
    .join('');
  return `<div class="pie"><svg viewBox="0 0 150 150" width="150" height="150">${arcs}
    <text x="75" y="80" text-anchor="middle" class="tot">${fmtNum(total)}</text></svg><div class="legs">${legend}</div></div>`;
}

export type DashboardOpts = { dark: boolean; print?: boolean; title: string; subtitle?: string };

export function dashboardHtml(ds: Dataset, kpis: Kpi[], charts: ChartSpec[], o: DashboardOpts): string {
  const dark = o.dark && !o.print;
  const c = dark
    ? { bg: '#0E0F12', card: '#1A1C22', text: '#E6E8EE', muted: '#8E95A3', grid: '#2C2F38', border: '#2C2F38' }
    : { bg: o.print ? '#FFFFFF' : '#F6F7FB', card: '#FFFFFF', text: '#1B1E28', muted: '#7A808C', grid: '#E6E8EE', border: '#E1E4EC' };
  const tiles = kpis
    .map((k) => `<div class="kpi"><div class="kl" dir="auto">${esc(k.label)}</div><div class="kv${k.value.length > 12 ? ' long' : ''}">${esc(k.value).replace(/(\d)-(\d)/g, '$1\u2011$2')}</div>${k.sub ? `<div class="ks">${esc(k.sub)}</div>` : ''}</div>`)
    .join('');
  const cards = charts
    .map((s, i) => {
      const ser = aggregate(ds, s);
      const color = PALETTE[i % PALETTE.length];
      const body = !ser.labels.length
        ? '<div class="empty">No data for this chart</div>'
        : s.type === 'line'
          ? lineSvg(ser, color)
          : s.type === 'pie'
            ? pieSvg(ser)
            : barSvg(ser, color);
      const tools = o.print
        ? ''
        : `<div class="tools"><button onclick="send('edit','${s.id}')">✎</button><button onclick="send('remove','${s.id}')">✕</button></div>`;
      return `<section class="card"><div class="head"><h3 dir="auto">${esc(chartTitle(ds, s))}</h3>${tools}</div>${body}</section>`;
    })
    .join('');
  const note = ds.guessed ? '<p class="note">Table detected automatically from the PDF — check the numbers against the file.</p>' : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
@page{size:A4;margin:12mm}
*{box-sizing:border-box}body{margin:0;padding:${o.print ? '0' : '12px 12px 90px'};background:${c.bg};color:${c.text};
font:14px/1.4 -apple-system,Roboto,"Noto Sans Arabic",sans-serif}
h1{font-size:${o.print ? 20 : 18}px;margin:0}h2{font-size:12px;color:${c.muted};font-weight:500;margin:2px 0 12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(${o.print ? 120 : 140}px,1fr));gap:8px;margin-bottom:10px}
.kpi{background:${c.card};border:1px solid ${c.border};border-radius:14px;padding:10px 12px;break-inside:avoid}
.kl{font-size:11.5px;color:${c.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kv{font-size:20px;font-weight:800;margin-top:2px;word-break:break-word}
.kv.long{font-size:14px}.ks{font-size:11px;color:${c.muted}}
.grid2{display:grid;grid-template-columns:${o.print ? '1fr 1fr' : '1fr'};gap:10px}
.card{background:${c.card};border:1px solid ${c.border};border-radius:16px;padding:12px;break-inside:avoid}
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px}
h3{font-size:14px;margin:0}.tools{display:flex;gap:6px;flex-shrink:0}
.tools button{border:1px solid ${c.border};background:${c.bg};color:${c.text};border-radius:999px;width:32px;height:32px;font-size:15px}
.lbl{font-size:12px;fill:${c.text}}.val{font-size:11.5px;fill:${c.muted};font-weight:600}
.axis{font-size:9.5px;fill:${c.muted}}.grid{stroke:${c.grid};stroke-width:1}
.pie{display:flex;align-items:center;gap:10px}.legs{flex:1;min-width:0}.tot{font-size:15px;font-weight:800;fill:${c.text}}
.leg{display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0}.leg i{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.leg span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;unicode-bidi:plaintext}.leg b{color:${c.muted};font-weight:600}
.empty,.note{color:${c.muted};font-size:12px}.foot{color:${c.muted};font-size:10px;margin-top:12px;text-align:center}
</style></head><body>
<h1 dir="auto">${esc(o.title)}</h1><h2 dir="auto">${esc(o.subtitle ?? '')}</h2>${note}
<div class="kpis">${tiles}</div><div class="grid2">${cards}</div>
${o.print ? '<div class="foot">Made with PDF Toolkit</div>' : ''}
<script>function send(a,id){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({a:a,id:id}))}</script>
</body></html>`;
}
