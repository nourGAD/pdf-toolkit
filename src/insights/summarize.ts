/**
 * Offline "extractive" summary: picks the sentences that carry the document's most frequent ideas.
 * Works for Arabic and English, needs no internet and no AI model.
 */

export type TextSummary = {
  words: number;
  sentences: number;
  readMinutes: number;
  language: 'ar' | 'en' | 'mixed';
  keyPoints: string[];
  keywords: { word: string; count: number }[];
};

const STOP_EN = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each either else etc even ever every few for from further get got had has have having he her here hers him his how however i if in into is it its itself just let may me might more most much must my no nor not now of off often on once one only or other our out over own per same shall she should since so some such than that the their them then there these they this those though through thus to too under until up upon us use used using very via was we were what when where whether which while who whom whose why will with within without would yes yet you your`.split(
    ' ',
  ),
);
const STOP_AR = new Set(
  `في من على إلى الى عن مع هذا هذه ذلك تلك التي الذي الذين اللذين اللتين هو هي هم هن انا أنا نحن انت أنت كان كانت يكون تكون كما لكن او أو ثم قد لقد لا لم لن ما ماذا متى اين أين كيف كل بعض أي اي غير بين عند عندما حتى إذا اذا إن ان أن إنه انه لأن لان بل ايضا أيضا وقد وكان وهو وهي وفي ومن وعلى وإلى والى وعن ومع وهذا وهذه وذلك فيها فيه منها منه عليها عليه لها له بها به هناك هنا حيث خلال ضمن نحو دون قبل بعد يتم تم وتم كذلك فقط جدا جداً`.split(
    ' ',
  ),
);

const AR_LETTERS = /[؀-ۿ]/g;
const EN_LETTERS = /[A-Za-z]/g;

/** Arabic: drop tashkeel/tatweel, unify alef forms, strip the "ال" and "و" prefixes for counting. */
function normWord(w: string): string {
  let s = w.toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي');
  if (/^[؀-ۿ]/.test(s)) {
    s = s.replace(/^و(?=ال)/, '').replace(/^(ال|بال|وال|فال|كال|لل)(?=..)/, '');
    s = s.replace(/ة$/, 'ه');
  } else {
    s = s.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1');
  }
  return s;
}

function tokens(s: string): string[] {
  // explicit ranges (Hermes-safe): Latin, Arabic, digits
  return s.match(/[A-Za-z0-9\u00C0-\u024F\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+(?:['’][A-Za-z]+)?/g) ?? [];
}

const isStop = (raw: string, n: string) =>
  STOP_EN.has(raw.toLowerCase()) || STOP_AR.has(raw) || STOP_AR.has(n) || n.length < 3 || /^\d+$/.test(n);

/** Join PDF lines back into paragraphs, then split into sentences (keeps headings/bullets as their own items). */
export function sentencesOf(text: string): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocks: string[] = [];
  for (const l of lines) {
    const prev = blocks[blocks.length - 1];
    const continues =
      prev !== undefined && !/[.!?؟:;。]$/.test(prev) && prev.length > 35 && !/^([-•●▪*·]|\d+[.)])\s/.test(l) && /^[a-z؀-ۿ(“"'«]/.test(l);
    if (continues) blocks[blocks.length - 1] = `${prev} ${l}`;
    else blocks.push(l);
  }
  const out: string[] = [];
  for (const b of blocks) {
    for (const s of b.replace(/([.!?؟。])\s+/g, '$1\u0001').split('\u0001')) {
      const t = s.replace(/^([-•●▪*·]|\d+[.)])\s+/, '').trim();
      if (t) out.push(t);
    }
  }
  return out;
}

export function summarizeText(text: string, maxPoints?: number): TextSummary {
  const sents = sentencesOf(text);
  const all = tokens(text);
  const ar = (text.match(AR_LETTERS) ?? []).length;
  const en = (text.match(EN_LETTERS) ?? []).length;
  const language = ar > en * 3 ? 'ar' : en > ar * 3 ? 'en' : 'mixed';

  // word frequencies (content words only)
  const freq = new Map<string, number>();
  const display = new Map<string, string>();
  for (const w of all) {
    const n = normWord(w);
    if (isStop(w, n)) continue;
    freq.set(n, (freq.get(n) ?? 0) + 1);
    if (!display.has(n)) display.set(n, w);
  }
  const maxF = Math.max(1, ...freq.values());

  // score sentences: average importance of their words, a bonus for the opening sentences, no very short/long ones
  const scored = sents.map((s, i) => {
    const ws = tokens(s);
    let sc = 0;
    let content = 0;
    for (const w of ws) {
      const n = normWord(w);
      if (isStop(w, n)) continue;
      content++;
      sc += (freq.get(n) ?? 0) / maxF;
    }
    const lenOk = ws.length >= 6 && ws.length <= 60;
    const pos = i < 3 ? 0.25 : i < sents.length * 0.1 ? 0.1 : 0;
    const score = lenOk && content ? sc / Math.sqrt(content) + pos : -1;
    return { s, i, score };
  });

  const n = maxPoints ?? Math.max(3, Math.min(8, Math.round(Math.sqrt(sents.length) * 0.9)));
  const picked: typeof scored = [];
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
    if (c.score <= 0 || picked.length >= n) break;
    // skip near-duplicates of a sentence already picked
    const cw = new Set(tokens(c.s).map(normWord));
    const dup = picked.some((p) => {
      const pw = tokens(p.s).map(normWord);
      const same = pw.filter((w) => cw.has(w)).length;
      return same / Math.max(1, Math.min(pw.length, cw.size)) > 0.7;
    });
    if (!dup) picked.push(c);
  }
  picked.sort((a, b) => a.i - b.i);

  const keywords = [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w, count]) => ({ word: display.get(w) ?? w, count }));

  const wpm = language === 'ar' ? 160 : 220;
  return {
    words: all.length,
    sentences: sents.length,
    readMinutes: Math.max(1, Math.round(all.length / wpm)),
    language,
    keyPoints: picked.map((p) => (p.s.length > 320 ? `${p.s.slice(0, 317)}…` : p.s)),
    keywords,
  };
}
