/**
 * Plain-code helpers for turning typed or spoken text into item + quantity lines, and matching names against the
 * real catalogue. These work with no AI key at all, and they are also what checks whatever a model returns.
 */

export type QtyUnit = "carton" | "piece";
export type ParsedItem = { name: string; quantity: number; unit: QtyUnit };

const CARTON_WORDS = ["carton", "cartons", "cartoon", "cartoons", "ctn", "ctns", "box", "boxes", "peti", "dibba"];
const PIECE_WORDS = ["pcs", "pc", "piece", "pieces", "nos", "numbers"];
// Words around the numbers that carry no product meaning ("rose candle 5 carton bana", "made 3 ctn of masjid").
const FILLER = new Set(["bana", "banaya", "banayi", "banaye", "bani", "made", "make", "ready", "produced", "production", "done", "kiya", "hua", "hue", "of", "ka", "ki", "ke", "add", "added", "today", "aaj", "and", "aur", "the", "a", "order", "chahiye", "chaiye", "need", "needs", "want", "wants", "please", "send", "bhejo", "dena"]);
const NAME_STOPWORDS = new Set(["candle", "candles", "pack", "wala", "wali", "type", "design", "designs", "the", "of", "ka", "ki"]);

const NUMBER_WORDS: Record<string, number> = {
  ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, panch: 5, paanch: 5, five: 5, chhe: 6, chhah: 6, six: 6,
  saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10, bees: 20, twenty: 20, pachaas: 50, fifty: 50, sau: 100, hundred: 100,
};

const unitOf = (word: string): QtyUnit | null =>
  CARTON_WORDS.includes(word) ? "carton" : PIECE_WORDS.includes(word) ? "piece" : null;

function toNumber(word: string): number | null {
  if (/^\d+(\.\d+)?$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

/** "rose candle 5 carton bana, birthday 3 ctn and masjid 120 pcs" → three items. Unknown unit means pieces. */
export function parseQuantityLines(text: string): ParsedItem[] {
  const segments = text.toLowerCase().split(/[\n;,]+|\s+(?:and|aur)\s+/);
  const items: ParsedItem[] = [];
  for (const segment of segments) {
    const words = segment.replace(/[^a-z0-9.ऀ-ॿ\s]/g, " ").split(/\s+/).filter(Boolean);
    // A digit is always a quantity; a spoken number word counts only when a unit follows ("do carton").
    const numberAt = words.findIndex((w, i) => /^\d/.test(w) ? toNumber(w) !== null : toNumber(w) !== null && unitOf(words[i + 1] ?? "") !== null);
    if (numberAt < 0) continue;
    const quantity = toNumber(words[numberAt])!;
    if (!(quantity > 0)) continue;
    let unit: QtyUnit | null = null;
    const rest = words.filter((_, i) => i !== numberAt);
    const nameWords: string[] = [];
    for (const w of rest) {
      const u = unitOf(w);
      if (u) { unit ??= u; continue; }
      if (FILLER.has(w)) continue;
      nameWords.push(w);
    }
    const name = nameWords.join(" ").trim();
    if (!name) continue;
    items.push({ name, quantity, unit: unit ?? "piece" });
  }
  return items;
}

// ── Name matching ────────────────────────────────────────────────────────────────────────────────────────────

function tokens(value: string): string[] {
  const all = value.toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s]/g, " ").split(/\s+/).filter(Boolean);
  const meaningful = all.filter((t) => !NAME_STOPWORDS.has(t));
  return meaningful.length > 0 ? meaningful : all;
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export type NameMatch<T extends { id: string; name: string }> = {
  status: "MATCHED" | "AMBIGUOUS" | "UNMATCHED";
  best: T | null;
  candidates: T[];
};

/** MATCHED only when exactly one entry clearly fits; otherwise the person picks from the candidates. */
export function matchName<T extends { id: string; name: string }>(raw: string, catalogue: T[]): NameMatch<T> {
  const query = tokens(raw);
  if (query.length === 0) return { status: "UNMATCHED", best: null, candidates: [] };
  const scored = catalogue.map((entry) => {
    const own = tokens(entry.name);
    const hit = query.filter((q) => own.some((o) => withinOneEdit(q, o))).length;
    const ownHit = own.filter((o) => query.some((q) => withinOneEdit(q, o))).length;
    return { entry, score: hit / query.length, coverage: own.length ? ownHit / own.length : 0 };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score || b.coverage - a.coverage);

  const candidates = scored.filter((s) => s.score >= 0.5).slice(0, 4).map((s) => s.entry);
  const [top, second] = scored;
  if (!top || top.score < 0.5) return { status: "UNMATCHED", best: null, candidates: [] };
  const clearWinner = top.score >= 0.99 && (!second || second.score < top.score || second.coverage < top.coverage);
  return clearWinner
    ? { status: "MATCHED", best: top.entry, candidates }
    : { status: "AMBIGUOUS", best: top.entry, candidates };
}

// ── Dates ────────────────────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_MS = 24 * 60 * 60 * 1000;
// Whole month words only, so "marble" or "decorative" are never read as March or December.
const MONTH_WORD = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Finds a needed-by date in typed or spoken text. `today` is today's date in India as YYYY-MM-DD.
 * Understands: 2026-11-05, 5 nov / nov 5 / 5th november, today/aaj, tomorrow/kal, parso, in 3 days / 3 din mein,
 * next week. Returns the date and the text with that phrase removed, so the rest can be read as items.
 */
export function extractDueDate(text: string, today: string): { date: string | null; rest: string } {
  const base = Date.parse(`${today}T00:00:00Z`);
  const lower = text.toLowerCase();
  const take = (re: RegExp, toMs: (m: RegExpMatchArray) => number | null) => {
    const m = lower.match(re);
    if (!m || m.index === undefined) return null;
    const ms = toMs(m);
    if (ms === null) return null;
    return { date: isoOf(ms), rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim() };
  };
  const monthIndex = (word: string) => MONTHS.indexOf(word.slice(0, 3));
  const nextOccurrence = (month: number, day: number): number | null => {
    const thisYear = new Date(base).getUTCFullYear();
    if (day < 1 || day > new Date(Date.UTC(thisYear, month + 1, 0)).getUTCDate()) return null; // no such day, e.g. 31 Feb
    const candidate = Date.UTC(thisYear, month, day);
    return candidate < base ? Date.UTC(thisYear + 1, month, day) : candidate; // "5 nov" said in December means next year
  };

  return (
    take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => { const ms = Date.parse(`${m[0]}T00:00:00Z`); return Number.isNaN(ms) ? null : ms; }) ??
    take(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH_WORD}\b`), (m) => nextOccurrence(monthIndex(m[2]), Number(m[1]))) ??
    take(new RegExp(String.raw`\b${MONTH_WORD}\s+(\d{1,2})(?:st|nd|rd|th)?\b`), (m) => nextOccurrence(monthIndex(m[1]), Number(m[2]))) ??
    take(/\b(?:in\s+)?(\d{1,2})\s+(?:days?|din)(?:\s+(?:mein|me))?\b/, (m) => base + Number(m[1]) * DAY_MS) ??
    take(/\bnext\s+week\b/, () => base + 7 * DAY_MS) ??
    take(/\b(?:parso|day\s+after\s+tomorrow)\b/, () => base + 2 * DAY_MS) ??
    take(/\b(?:kal|tomorrow)\b/, () => base + DAY_MS) ??
    take(/\b(?:aaj|today)\b/, () => base) ??
    { date: null, rest: text }
  );
}
