/**
 * Turns a table (Excel sheet, Word table, table found in a PDF) into typed columns,
 * suggests a dashboard automatically, and aggregates data for each chart.
 */

export type Cell = string | number | null;
export type RawTable = { name: string; rows: Cell[][]; guessed?: boolean };
export type ColType = 'number' | 'date' | 'category' | 'text';
export type Column = { name: string; type: ColType; distinct: number; filled: number };
export type Dataset = {
  name: string;
  guessed?: boolean;
  columns: Column[];
  /** parsed values: numbers for number columns, 'YYYY-MM-DD' for dates, strings otherwise */
  rows: (string | number | null)[][];
};

export type ChartType = 'bar' | 'line' | 'pie';
export type Agg = 'sum' | 'avg' | 'count' | 'max' | 'min';
export type ChartSpec = {
  id: string;
  type: ChartType;
  /** column to group by (category or date) */
  by: number;
  /** number column, or -1 = count rows */
  value: number;
  agg: Agg;
  /** dates: group by day / month / year */
  dateUnit?: 'day' | 'month' | 'year';
  /** bar/pie: how many groups to show (rest = "Other") */
  top?: number;
};
export type Kpi = { label: string; value: string; sub?: string };
export type Series = { labels: string[]; values: number[] };

export const AGG_LABEL: Record<Agg, string> = { sum: 'Total', avg: 'Average', count: 'Count', max: 'Max', min: 'Min' };

// ---------------- parsing ----------------
const AR_DIGITS = /[٠-٩۰-۹]/g;
const toLatinDigits = (s: string) =>
  s.replace(AR_DIGITS, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(d) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

export function parseNumber(v: Cell): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return v;
  let s = toLatinDigits(v).replace(/[٬،]/g, ',').replace(/٫/g, '.').trim();
  if (!/\d/.test(s) || s.length > 30) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  const pct = /%$/.test(s);
  s = s.replace(/^\(|\)$/g, '').replace(/[%\s$€£¥₹]|EGP|SAR|AED|USD|EUR|ج\.?م|ر\.?س|د\.?إ|جنيه|ريال|درهم/gi, '').replace(/^[-+]|-$/g, '');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const n = parseFloat(s) * (neg ? -1 : 1);
  return isFinite(n) ? (pct ? n / 100 : n) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function parseDate(v: Cell): string | null {
  if (v === null || typeof v === 'number') return null;
  const s = toLatinDigits(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T].*)?$/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    // day/month (Egypt, Gulf, Europe) unless that is impossible
    return +m[2] > 12 ? valid(y, +m[1], +m[2]) : valid(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], 1);
  const t = Date.parse(s);
  if (/[a-z]{3}/i.test(s) && /\d{4}/.test(s) && !isNaN(t)) {
    const d = new Date(t);
    return valid(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

const isTotalRow = (r: Cell[]) =>
  r.slice(0, 2).some((c) => typeof c === 'string' && /^(grand\s*)?total|^sum$|^الإجمالي|^الاجمالي|^المجموع|^إجمالي|^اجمالي/i.test(c.trim()));

/** First row that looks like a header (mostly text, followed by rows that have numbers) */
function headerIndex(rows: Cell[][]): number {
  for (let i = 0; i < Math.min(rows.length - 1, 10); i++) {
    const r = rows[i];
    const filled = r.filter((c) => c !== null).length;
    const texts = r.filter((c) => typeof c === 'string' && parseNumber(c) === null).length;
    if (filled >= Math.max(2, r.length * 0.5) && texts >= filled * 0.7) return i;
  }
  return -1;
}

export function toDataset(t: RawTable): Dataset | null {
  if (t.rows.length < 2) return null;
  const width = Math.max(...t.rows.map((r) => r.length));
  if (width < 1) return null;
  const h = headerIndex(t.rows);
  const header = h >= 0 ? t.rows[h] : [];
  const body = t.rows.slice(h + 1).filter((r) => !isTotalRow(r));
  if (!body.length) return null;

  const names: string[] = [];
  const columns: Column[] = [];
  const parsed: (string | number | null)[][] = body.map(() => []);
  for (let c = 0; c < width; c++) {
    let name = String(header[c] ?? '').trim() || `Column ${c + 1}`;
    while (names.includes(name)) name += ' ·';
    names.push(name);
    const raw = body.map((r) => r[c] ?? null);
    const filled = raw.filter((v) => v !== null);
    if (!filled.length) {
      columns.push({ name, type: 'text', distinct: 0, filled: 0 });
      body.forEach((_, i) => parsed[i].push(null));
      continue;
    }
    const nums = raw.map(parseNumber);
    const dates = raw.map(parseDate);
    const numOk = nums.filter((v) => v !== null).length;
    const dateOk = dates.filter((v) => v !== null).length;
    const distinct = new Set(filled.map((v) => String(v).trim().toLowerCase())).size;
    const idLike = /(^|\b)(id|no\.?|#|code|phone|mobile|tel|zip|رقم|كود|تليفون|موبايل|هاتف)(\b|$)/i.test(name);
    let type: ColType;
    if (dateOk >= filled.length * 0.8 && dateOk > 0) type = 'date';
    else if (numOk >= filled.length * 0.8 && !(idLike && distinct >= filled.length * 0.9)) {
      // years (2019, 2020…) work better as groups than as amounts
      const years = nums.every((n) => n === null || (Number.isInteger(n) && n >= 1950 && n <= 2100));
      type = years && /year|سنة|عام/i.test(name) ? 'category' : 'number';
    } else if (distinct <= Math.max(2, Math.min(60, filled.length * 0.6)) || (filled.length <= 12 && distinct <= filled.length))
      type = 'category';
    else type = 'text';
    columns.push({ name, type, distinct, filled: filled.length });
    body.forEach((_, i) => {
      const v = raw[i];
      parsed[i].push(
        type === 'number' ? nums[i] : type === 'date' ? dates[i] : v === null ? null : typeof v === 'number' ? String(v) : v.trim(),
      );
    });
  }
  return { name: t.name, guessed: t.guessed, columns, rows: parsed };
}

// ---------------- aggregation ----------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dateSpanDays(ds: Dataset, col: number): number {
  const v = ds.rows.map((r) => r[col]).filter((x): x is string => typeof x === 'string').sort();
  if (v.length < 2) return 0;
  return (Date.parse(v[v.length - 1]) - Date.parse(v[0])) / 86400000;
}
export const autoDateUnit = (ds: Dataset, col: number): 'day' | 'month' | 'year' => {
  const d = dateSpanDays(ds, col);
  return d <= 62 ? 'day' : d <= 365 * 4 ? 'month' : 'year';
};

export function aggregate(ds: Dataset, spec: ChartSpec): Series {
  const col = ds.columns[spec.by];
  if (!col) return { labels: [], values: [] };
  const isDate = col.type === 'date';
  const unit = spec.dateUnit ?? (isDate ? autoDateUnit(ds, spec.by) : undefined);
  const groups = new Map<string, number[]>();
  for (const r of ds.rows) {
    let k = r[spec.by];
    if (k === null || k === undefined || k === '') continue;
    k = String(k);
    if (isDate) k = unit === 'year' ? k.slice(0, 4) : unit === 'month' ? k.slice(0, 7) : k;
    const v = spec.value < 0 ? 1 : (r[spec.value] as number | null);
    if (spec.value >= 0 && (v === null || typeof v !== 'number')) {
      if (!groups.has(k)) groups.set(k, []);
      continue;
    }
    const arr = groups.get(k) ?? [];
    arr.push(v as number);
    groups.set(k, arr);
  }
  const agg = spec.value < 0 ? 'count' : spec.agg;
  let entries = [...groups.entries()].map(([k, vs]) => [k, reduce(vs, agg)] as [string, number]);

  if (isDate) {
    entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    entries = entries.map(([k, v]) => [fmtDateKey(k, unit!), v]);
  } else if (entries.length > 1 && entries.every(([k]) => monthIndex(k) >= 0)) {
    entries.sort((a, b) => monthIndex(a[0]) - monthIndex(b[0])); // Jan, Feb, Mar… keep calendar order
  } else {
    entries.sort((a, b) => b[1] - a[1]);
    const top = spec.top ?? (spec.type === 'pie' ? 6 : 10);
    if (entries.length > top) {
      const rest = entries.slice(top - 1);
      const restVal = agg === 'sum' || agg === 'count' ? rest.reduce((s, [, v]) => s + v, 0) : null;
      entries = entries.slice(0, top - 1);
      if (restVal !== null) entries.push([`Other (${rest.length})`, restVal]);
    }
  }
  return { labels: entries.map((e) => e[0]), values: entries.map((e) => e[1]) };
}

const MONTH_NAMES = [
  ['jan', 'january', 'يناير', 'كانون الثاني'],
  ['feb', 'february', 'فبراير', 'شباط'],
  ['mar', 'march', 'مارس', 'آذار'],
  ['apr', 'april', 'أبريل', 'ابريل', 'إبريل', 'نيسان'],
  ['may', 'مايو', 'أيار'],
  ['jun', 'june', 'يونيو', 'يونيه', 'حزيران'],
  ['jul', 'july', 'يوليو', 'يوليه', 'تموز'],
  ['aug', 'august', 'أغسطس', 'اغسطس', 'آب'],
  ['sep', 'sept', 'september', 'سبتمبر', 'أيلول'],
  ['oct', 'october', 'أكتوبر', 'اكتوبر', 'تشرين الأول'],
  ['nov', 'november', 'نوفمبر', 'تشرين الثاني'],
  ['dec', 'december', 'ديسمبر', 'كانون الأول'],
];
function monthIndex(label: string): number {
  const k = label.trim().toLowerCase().replace(/\s*\d{2,4}$/, '');
  return MONTH_NAMES.findIndex((names) => names.includes(k));
}

function reduce(vs: number[], agg: Agg): number {
  if (agg === 'count') return vs.length;
  if (!vs.length) return 0;
  if (agg === 'sum') return vs.reduce((a, b) => a + b, 0);
  if (agg === 'avg') return vs.reduce((a, b) => a + b, 0) / vs.length;
  if (agg === 'max') return Math.max(...vs);
  return Math.min(...vs);
}

function fmtDateKey(k: string, unit: 'day' | 'month' | 'year'): string {
  if (unit === 'year') return k;
  const [y, m, d] = k.split('-');
  if (unit === 'month') return `${MONTHS[+m - 1]} ${y}`;
  return `${+d} ${MONTHS[+m - 1]}`;
}

export function fmtNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return n.toLocaleString('en-US', { maximumFractionDigits: a < 1 ? 3 : 2 });
}

export function chartTitle(ds: Dataset, s: ChartSpec): string {
  const by = ds.columns[s.by]?.name ?? '';
  if (s.value < 0) return `Count of rows by ${by}`;
  return `${AGG_LABEL[s.agg]} ${ds.columns[s.value]?.name ?? ''} by ${by}`;
}

// ---------------- automatic dashboard ----------------
let seq = 0;
export const newId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

export function autoKpis(ds: Dataset): Kpi[] {
  const k: Kpi[] = [{ label: 'Rows', value: fmtNum(ds.rows.length) }];
  ds.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.type === 'number')
    .slice(0, 3)
    .forEach(({ c, i }) => {
      const vs = ds.rows.map((r) => r[i]).filter((v): v is number => typeof v === 'number');
      if (!vs.length) return;
      const sum = vs.reduce((a, b) => a + b, 0);
      k.push({ label: `Total ${c.name}`, value: fmtNum(sum), sub: `avg ${fmtNum(sum / vs.length)}` });
    });
  const date = ds.columns.findIndex((c) => c.type === 'date');
  if (date >= 0) {
    const v = ds.rows.map((r) => r[date]).filter((x): x is string => typeof x === 'string').sort();
    if (v.length) k.push({ label: ds.columns[date].name, value: `${v[0]} → ${v[v.length - 1]}` });
  }
  return k.slice(0, 5);
}

export function autoCharts(ds: Dataset): ChartSpec[] {
  const idx = (t: ColType) => ds.columns.map((c, i) => (c.type === t ? i : -1)).filter((i) => i >= 0);
  const nums = idx('number');
  const dates = idx('date');
  const cats = idx('category').filter((i) => ds.columns[i].distinct >= 2);
  const main = nums.length ? nums[0] : -1;
  const out: ChartSpec[] = [];
  if (dates.length) out.push({ id: newId(), type: 'line', by: dates[0], value: main, agg: 'sum' });
  cats.slice(0, 3).forEach((c, i) => {
    // pie only for a handful of groups that repeat (Team, Status…), not for one-row-per-label columns (Name, Month)
    const few = ds.columns[c].distinct <= 6 && ds.columns[c].distinct < ds.columns[c].filled;
    out.push({ id: newId(), type: few && i > 0 ? 'pie' : few && !dates.length && i === 0 ? 'pie' : 'bar', by: c, value: main, agg: 'sum' });
  });
  if (nums.length > 1 && cats.length) out.push({ id: newId(), type: 'bar', by: cats[0], value: nums[1], agg: 'sum' });
  if (!out.length && ds.columns.length) {
    // only text/number columns: count by the first column with repeats
    const first = ds.columns.findIndex((c) => c.type !== 'number' && c.distinct < ds.rows.length);
    if (first >= 0) out.push({ id: newId(), type: 'bar', by: first, value: main, agg: main >= 0 ? 'sum' : 'count' });
  }
  return out.slice(0, 5);
}

/** short written highlights for the Summary tab of spreadsheets */
export function dataHighlights(ds: Dataset): string[] {
  const out: string[] = [];
  const types = (t: ColType) => ds.columns.filter((c) => c.type === t).length;
  out.push(
    `${ds.rows.length.toLocaleString('en-US')} rows × ${ds.columns.length} columns (${types('number')} numeric, ${types('category')} categories, ${types('date')} dates).`,
  );
  for (const s of autoCharts(ds).slice(0, 4)) {
    const ser = aggregate(ds, s);
    if (!ser.labels.length) continue;
    const total = ser.values.reduce((a, b) => a + b, 0);
    if (ds.columns[s.by].type === 'date') {
      const best = ser.values.indexOf(Math.max(...ser.values));
      const first = ser.values[0];
      const last = ser.values[ser.values.length - 1];
      const ch = first ? ((last - first) / Math.abs(first)) * 100 : 0;
      out.push(
        `${chartTitle(ds, s)}: peak in ${ser.labels[best]} (${fmtNum(ser.values[best])})` +
          (ser.values.length > 1 && first ? `, ${ch >= 0 ? 'up' : 'down'} ${Math.abs(ch).toFixed(0)}% from first to last period.` : '.'),
      );
    } else {
      const share = total && (s.agg === 'sum' || s.value < 0) ? ` — ${((ser.values[0] / total) * 100).toFixed(0)}% of the total` : '';
      out.push(`${chartTitle(ds, s)}: top is “${ser.labels[0]}” with ${fmtNum(ser.values[0])}${share}.`);
    }
  }
  return out;
}
