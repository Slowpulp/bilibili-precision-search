const HTML_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
});

const ENGLISH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "in", "is", "it", "of", "on", "or", "the", "to", "with",
]);

const CHINESE_STOP_WORDS = new Set(["的", "了", "和", "与", "及", "或", "是", "在"]);

export function decodeHtml(value) {
  const text = String(value ?? "");
  if (typeof document !== "undefined" && document.createElement) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = text;
    return textarea.value;
  }
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === "#") {
      const hex = body[1]?.toLowerCase() === "x";
      const valueNumber = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(valueNumber) ? String.fromCodePoint(valueNumber) : entity;
    }
    return HTML_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

export function stripHtml(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function normalizeText(value) {
  return stripHtml(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[^\p{L}\p{N}+#._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactText(value) {
  return normalizeText(value).replace(/[\s._-]+/g, "");
}

function specificityWeight(term) {
  if (/^\d{4}$/.test(term)) return 1.35;
  if (/^[a-z]*\d+[a-z\d]*$/i.test(term)) return 1.25;
  if (term.length >= 6) return 1.25;
  if (term.length >= 3) return 1.1;
  return 1;
}

function splitChunk(chunk) {
  const normalized = normalizeText(chunk);
  const pieces = normalized.match(/[a-z]+[a-z0-9]*(?:[._-][a-z0-9]+)*(?:\+\+|#)?|\d+[a-z\d]*|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/giu);
  return pieces?.filter(Boolean) ?? [];
}

function parseRawParts(raw) {
  const parts = [];
  const pattern = /(-)?(?:"([^"]+)"|“([^”]+)”|'([^']+)'|(\S+))/gu;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
    const quoted = match[2] !== undefined || match[3] !== undefined || match[4] !== undefined;
    parts.push({ value, quoted, negative: Boolean(match[1]) });
  }
  return parts;
}

export function parseQuery(rawQuery) {
  const raw = String(rawQuery ?? "").trim();
  const rawParts = parseRawParts(raw);
  const positiveParts = rawParts.filter((part) => !part.negative);
  const negativeParts = rawParts.filter((part) => part.negative);
  const exactPhrases = positiveParts
    .filter((part) => part.quoted)
    .map((part) => normalizeText(part.value))
    .filter(Boolean);

  const termMap = new Map();
  const addTerm = (textValue, { quoted = false, auxiliary = false, weightScale = 1 } = {}) => {
    const text = normalizeText(textValue);
    if (!text) return;
    const key = compactText(text);
    if (!key) return;
    const existing = termMap.get(key);
    const candidate = {
      text,
      compact: key,
      quoted,
      auxiliary,
      weight: specificityWeight(key) * (quoted ? 1.45 : 1) * weightScale,
    };
    if (!existing || candidate.weight > existing.weight) termMap.set(key, candidate);
  };
  for (const part of positiveParts) {
    const tokens = part.quoted ? [normalizeText(part.value)] : splitChunk(part.value);
    for (const token of tokens) {
      const compact = compactText(token);
      const isLongCjk = !part.quoted && compact.length > 4 && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(compact);
      if (!isLongCjk) {
        addTerm(token, { quoted: part.quoted });
        continue;
      }
      // A dictionary-free fallback for unspaced CJK queries. The full phrase
      // remains important, while bigrams provide low-weight coverage when a
      // title inserts particles or reorders nearby concepts.
      addTerm(token, { weightScale: 0.45 });
      for (let index = 0; index < compact.length - 1; index += 1) {
        addTerm(compact.slice(index, index + 2), { auxiliary: true, weightScale: 0.5 });
      }
    }
  }

  let terms = [...termMap.values()];
  if (terms.length > 1) {
    terms = terms.filter((term) => {
      if (term.quoted) return true;
      if (ENGLISH_STOP_WORDS.has(term.text)) return false;
      if (CHINESE_STOP_WORDS.has(term.text)) return false;
      return term.compact.length > 1 || /^\d+$/.test(term.compact);
    });
  }

  const negativeTerms = [];
  for (const part of negativeParts) {
    for (const token of splitChunk(part.value)) {
      const compact = compactText(token);
      if (compact) negativeTerms.push({ text: normalizeText(token), compact });
    }
  }

  const positiveRaw = positiveParts.map((part) => part.value).join(" ").trim();
  return {
    raw,
    normalized: normalizeText(positiveRaw),
    compact: compactText(positiveRaw),
    terms,
    exactPhrases,
    negativeTerms,
  };
}

export function levenshteinDistance(a, b) {
  const left = [...String(a)];
  const right = [...String(b)];
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function bestSubstringSimilarity(needleValue, haystackValue) {
  const needle = compactText(needleValue);
  const haystack = compactText(haystackValue);
  if (!needle || !haystack) return 0;
  if (haystack.includes(needle)) return 1;
  if (needle.length < 3 || haystack.length > 2000) return 0;
  const lengths = [needle.length - 1, needle.length, needle.length + 1].filter((length) => length > 0);
  let best = 0;
  for (const length of lengths) {
    for (let start = 0; start < haystack.length; start += 1) {
      const sample = haystack.slice(start, start + length);
      if (!sample) continue;
      const similarity = 1 - levenshteinDistance(needle, sample) / Math.max(needle.length, sample.length);
      if (similarity > best) best = similarity;
      if (best >= 0.999) return 1;
    }
  }
  return best;
}

export function ngramContainment(needleValue, haystackValue, size = 2) {
  const needle = compactText(needleValue);
  const haystack = compactText(haystackValue);
  if (!needle || !haystack) return 0;
  if (haystack.includes(needle)) return 1;
  if (needle.length < size) return haystack.includes(needle) ? 1 : 0;
  const grams = [];
  for (let index = 0; index <= needle.length - size; index += 1) {
    grams.push(needle.slice(index, index + size));
  }
  const matched = grams.filter((gram) => haystack.includes(gram)).length;
  return matched / grams.length;
}

export function containsOrderedTerms(text, terms) {
  const haystack = compactText(text);
  let cursor = 0;
  for (const term of terms) {
    const position = haystack.indexOf(term.compact, cursor);
    if (position < 0) return false;
    cursor = position + term.compact.length;
  }
  return terms.length > 1;
}
