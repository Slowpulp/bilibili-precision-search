// ==UserScript==
// @name         B站精准搜索
// @namespace    bilibili-precision-search.local
// @version      1.0.0
// @description  多路收集 B 站搜索候选，以相关性硬门槛过滤，再用质量分辅助重排并解释每条结果。
// @author       Local userscript project
// @license      MIT
// @match        https://search.bilibili.com/*
// @run-at       document-start
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      api.bilibili.com
// ==/UserScript==

(() => {
  // src/constants.js
  var MODE_PROFILES = Object.freeze({
    strict: Object.freeze({
      id: "strict",
      label: "严格",
      shortDescription: "高覆盖、低容错，优先排除疑似无关内容",
      threshold: 0.7,
      minCoverage: 0.75,
      fuzzyThreshold: 1,
      relevanceWeight: 0.93,
      relevanceBand: 0.04,
      orders: Object.freeze(["totalrank", "click", "pubdate", "stow"]),
      pagesPerOrder: 2,
      pageSize: 50
    }),
    standard: Object.freeze({
      id: "standard",
      label: "标准",
      shortDescription: "相关性优先，在小范围内用质量分调序",
      threshold: 0.46,
      minCoverage: 0.5,
      fuzzyThreshold: 1,
      relevanceWeight: 0.87,
      relevanceBand: 0.05,
      orders: Object.freeze(["totalrank", "click", "pubdate", "stow"]),
      pagesPerOrder: 2,
      pageSize: 50
    }),
    exploration: Object.freeze({
      id: "exploration",
      label: "探索",
      shortDescription: "放宽门槛，并加入弹幕排序以发现长尾内容",
      threshold: 0.25,
      minCoverage: 0.25,
      fuzzyThreshold: 0.7,
      relevanceWeight: 0.78,
      relevanceBand: 0.07,
      orders: Object.freeze(["totalrank", "click", "pubdate", "stow", "dm"]),
      pagesPerOrder: 3,
      pageSize: 50
    })
  });
  var DEFAULT_MODE = "standard";
  var RESULTS_PER_PAGE = 24;
  var CACHE_TTL_MS = 5 * 60 * 1e3;
  var STORAGE_MODE_KEY = "bps:mode:v1";
  function getModeProfile(mode) {
    return MODE_PROFILES[mode] ?? MODE_PROFILES[DEFAULT_MODE];
  }

  // src/md5.js
  function add32(a, b) {
    return a + b & 4294967295;
  }
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32(a << s | a >>> 32 - s, b);
  }
  function ff(a, b, c, d, x, s, t) {
    return cmn(b & c | ~b & d, a, b, x, s, t);
  }
  function gg(a, b, c, d, x, s, t) {
    return cmn(b & d | c & ~d, a, b, x, s, t);
  }
  function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function md5cycle(state, block) {
    let [a, b, c, d] = state;
    const [oa, ob, oc, od] = state;
    a = ff(a, b, c, d, block[0], 7, -680876936);
    d = ff(d, a, b, c, block[1], 12, -389564586);
    c = ff(c, d, a, b, block[2], 17, 606105819);
    b = ff(b, c, d, a, block[3], 22, -1044525330);
    a = ff(a, b, c, d, block[4], 7, -176418897);
    d = ff(d, a, b, c, block[5], 12, 1200080426);
    c = ff(c, d, a, b, block[6], 17, -1473231341);
    b = ff(b, c, d, a, block[7], 22, -45705983);
    a = ff(a, b, c, d, block[8], 7, 1770035416);
    d = ff(d, a, b, c, block[9], 12, -1958414417);
    c = ff(c, d, a, b, block[10], 17, -42063);
    b = ff(b, c, d, a, block[11], 22, -1990404162);
    a = ff(a, b, c, d, block[12], 7, 1804603682);
    d = ff(d, a, b, c, block[13], 12, -40341101);
    c = ff(c, d, a, b, block[14], 17, -1502002290);
    b = ff(b, c, d, a, block[15], 22, 1236535329);
    a = gg(a, b, c, d, block[1], 5, -165796510);
    d = gg(d, a, b, c, block[6], 9, -1069501632);
    c = gg(c, d, a, b, block[11], 14, 643717713);
    b = gg(b, c, d, a, block[0], 20, -373897302);
    a = gg(a, b, c, d, block[5], 5, -701558691);
    d = gg(d, a, b, c, block[10], 9, 38016083);
    c = gg(c, d, a, b, block[15], 14, -660478335);
    b = gg(b, c, d, a, block[4], 20, -405537848);
    a = gg(a, b, c, d, block[9], 5, 568446438);
    d = gg(d, a, b, c, block[14], 9, -1019803690);
    c = gg(c, d, a, b, block[3], 14, -187363961);
    b = gg(b, c, d, a, block[8], 20, 1163531501);
    a = gg(a, b, c, d, block[13], 5, -1444681467);
    d = gg(d, a, b, c, block[2], 9, -51403784);
    c = gg(c, d, a, b, block[7], 14, 1735328473);
    b = gg(b, c, d, a, block[12], 20, -1926607734);
    a = hh(a, b, c, d, block[5], 4, -378558);
    d = hh(d, a, b, c, block[8], 11, -2022574463);
    c = hh(c, d, a, b, block[11], 16, 1839030562);
    b = hh(b, c, d, a, block[14], 23, -35309556);
    a = hh(a, b, c, d, block[1], 4, -1530992060);
    d = hh(d, a, b, c, block[4], 11, 1272893353);
    c = hh(c, d, a, b, block[7], 16, -155497632);
    b = hh(b, c, d, a, block[10], 23, -1094730640);
    a = hh(a, b, c, d, block[13], 4, 681279174);
    d = hh(d, a, b, c, block[0], 11, -358537222);
    c = hh(c, d, a, b, block[3], 16, -722521979);
    b = hh(b, c, d, a, block[6], 23, 76029189);
    a = hh(a, b, c, d, block[9], 4, -640364487);
    d = hh(d, a, b, c, block[12], 11, -421815835);
    c = hh(c, d, a, b, block[15], 16, 530742520);
    b = hh(b, c, d, a, block[2], 23, -995338651);
    a = ii(a, b, c, d, block[0], 6, -198630844);
    d = ii(d, a, b, c, block[7], 10, 1126891415);
    c = ii(c, d, a, b, block[14], 15, -1416354905);
    b = ii(b, c, d, a, block[5], 21, -57434055);
    a = ii(a, b, c, d, block[12], 6, 1700485571);
    d = ii(d, a, b, c, block[3], 10, -1894986606);
    c = ii(c, d, a, b, block[10], 15, -1051523);
    b = ii(b, c, d, a, block[1], 21, -2054922799);
    a = ii(a, b, c, d, block[8], 6, 1873313359);
    d = ii(d, a, b, c, block[15], 10, -30611744);
    c = ii(c, d, a, b, block[6], 15, -1560198380);
    b = ii(b, c, d, a, block[13], 21, 1309151649);
    a = ii(a, b, c, d, block[4], 6, -145523070);
    d = ii(d, a, b, c, block[11], 10, -1120210379);
    c = ii(c, d, a, b, block[2], 15, 718787259);
    b = ii(b, c, d, a, block[9], 21, -343485551);
    state[0] = add32(a, oa);
    state[1] = add32(b, ob);
    state[2] = add32(c, oc);
    state[3] = add32(d, od);
  }
  function md5block(binary) {
    const block = [];
    for (let i = 0; i < 64; i += 4) {
      block[i >> 2] = binary.charCodeAt(i) + (binary.charCodeAt(i + 1) << 8) + (binary.charCodeAt(i + 2) << 16) + (binary.charCodeAt(i + 3) << 24);
    }
    return block;
  }
  function md51(binary) {
    let index;
    const length = binary.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    for (index = 64; index <= length; index += 64) {
      md5cycle(state, md5block(binary.substring(index - 64, index)));
    }
    const tail = new Array(16).fill(0);
    const remainder = binary.substring(index - 64);
    for (index = 0; index < remainder.length; index += 1) {
      tail[index >> 2] |= remainder.charCodeAt(index) << (index % 4 << 3);
    }
    tail[index >> 2] |= 128 << (index % 4 << 3);
    if (index > 55) {
      md5cycle(state, tail);
      tail.fill(0);
    }
    tail[14] = length * 8;
    md5cycle(state, tail);
    return state;
  }
  function hex(number) {
    let result = "";
    for (let j = 0; j < 4; j += 1) {
      result += (number >> j * 8 & 255).toString(16).padStart(2, "0");
    }
    return result;
  }
  function md5(input) {
    const binary = unescape(encodeURIComponent(String(input)));
    return md51(binary).map(hex).join("");
  }

  // src/text.js
  var HTML_ENTITIES = Object.freeze({
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  });
  var ENGLISH_STOP_WORDS = /* @__PURE__ */ new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with"
  ]);
  var CHINESE_STOP_WORDS = /* @__PURE__ */ new Set(["的", "了", "和", "与", "及", "或", "是", "在"]);
  function decodeHtml(value) {
    const text = String(value ?? "");
    if (typeof document !== "undefined" && document.createElement) {
      const textarea = document.createElement("textarea");
      textarea.innerHTML = text;
      return textarea.value;
    }
    return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body) => {
      if (body[0] === "#") {
        const hex2 = body[1]?.toLowerCase() === "x";
        const valueNumber = Number.parseInt(body.slice(hex2 ? 2 : 1), hex2 ? 16 : 10);
        return Number.isFinite(valueNumber) ? String.fromCodePoint(valueNumber) : entity;
      }
      return HTML_ENTITIES[body.toLowerCase()] ?? entity;
    });
  }
  function stripHtml(value) {
    return decodeHtml(String(value ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }
  function normalizeText(value) {
    return stripHtml(value).normalize("NFKC").toLocaleLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "").replace(/[^\p{L}\p{N}+#._-]+/gu, " ").replace(/\s+/g, " ").trim();
  }
  function compactText(value) {
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
      const quoted = match[2] !== void 0 || match[3] !== void 0 || match[4] !== void 0;
      parts.push({ value, quoted, negative: Boolean(match[1]) });
    }
    return parts;
  }
  function parseQuery(rawQuery) {
    const raw = String(rawQuery ?? "").trim();
    const rawParts = parseRawParts(raw);
    const positiveParts = rawParts.filter((part) => !part.negative);
    const negativeParts = rawParts.filter((part) => part.negative);
    const exactPhrases = positiveParts.filter((part) => part.quoted).map((part) => normalizeText(part.value)).filter(Boolean);
    const termMap = /* @__PURE__ */ new Map();
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
        weight: specificityWeight(key) * (quoted ? 1.45 : 1) * weightScale
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
      negativeTerms
    };
  }
  function levenshteinDistance(a, b) {
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
          diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)
        );
        diagonal = above;
      }
    }
    return previous[right.length];
  }
  function bestSubstringSimilarity(needleValue, haystackValue) {
    const needle = compactText(needleValue);
    const haystack = compactText(haystackValue);
    if (!needle || !haystack) return 0;
    if (haystack.includes(needle)) return 1;
    if (needle.length < 3 || haystack.length > 2e3) return 0;
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
  function ngramContainment(needleValue, haystackValue, size = 2) {
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
  function containsOrderedTerms(text, terms) {
    const haystack = compactText(text);
    let cursor = 0;
    for (const term of terms) {
      const position = haystack.indexOf(term.compact, cursor);
      if (position < 0) return false;
      cursor = position + term.compact.length;
    }
    return terms.length > 1;
  }

  // src/api-adapter.js
  var SEARCH_ENDPOINTS = Object.freeze({
    wbi: "https://api.bilibili.com/x/web-interface/wbi/search/type",
    legacy: "https://api.bilibili.com/x/web-interface/search/type",
    nav: "https://api.bilibili.com/x/web-interface/nav"
  });
  var MIXIN_KEY_ENCODE_TABLE = Object.freeze([
    46,
    47,
    18,
    2,
    53,
    8,
    23,
    32,
    15,
    50,
    10,
    31,
    58,
    3,
    45,
    35,
    27,
    43,
    5,
    49,
    33,
    9,
    42,
    19,
    29,
    28,
    14,
    39,
    12,
    38,
    41,
    13,
    37,
    48,
    7,
    16,
    24,
    55,
    40,
    61,
    26,
    17,
    0,
    1,
    60,
    51,
    30,
    4,
    22,
    25,
    54,
    21,
    56,
    59,
    6,
    63,
    57,
    62,
    11,
    36,
    20,
    34,
    44,
    52
  ]);
  var ORDER_LABELS = Object.freeze({
    totalrank: "综合",
    click: "播放",
    pubdate: "最新",
    stow: "收藏",
    dm: "弹幕"
  });
  var RISK_CODES = /* @__PURE__ */ new Set([-352, -412, -429, 412, 429]);
  var BilibiliApiError = class extends Error {
    constructor(message, { code = null, status = null, kind = "api", cause = null } = {}) {
      super(message, cause ? { cause } : void 0);
      this.name = "BilibiliApiError";
      this.code = code;
      this.status = status;
      this.kind = kind;
    }
  };
  function abortError() {
    if (typeof DOMException !== "undefined") return new DOMException("请求已取消", "AbortError");
    const error = new Error("请求已取消");
    error.name = "AbortError";
    return error;
  }
  function ensureNotAborted(signal) {
    if (signal?.aborted) throw abortError();
  }
  function sleep(milliseconds, signal) {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(abortError());
      }, { once: true });
    });
  }
  function safeNumber(value, fallback = null) {
    if (value === null || value === void 0 || value === "") return fallback;
    const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
  function httpsUrl(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const normalized = raw.startsWith("//") ? `https:${raw}` : raw.startsWith("http://") ? `https://${raw.slice(7)}` : raw;
    try {
      const url = new URL(normalized);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }
  function parseDuration(value) {
    if (value === null || value === void 0 || String(value).trim() === "") return null;
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
    const parts = String(value ?? "").trim().split(":").map(Number);
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
    return parts.reduce((seconds, part) => seconds * 60 + part, 0);
  }
  function durationLabel(value, seconds) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (!Number.isFinite(seconds)) return "";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const rest = seconds % 60;
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
  }
  function normalizeTags(raw) {
    const values = Array.isArray(raw.tags) ? raw.tags : String(raw.tag ?? "").split(/[,，]/);
    return [...new Set(values.map((value) => stripHtml(value).trim()).filter(Boolean))];
  }
  function normalizeVideo(raw, source = {}) {
    if (!raw || raw.type !== "video" || !raw.bvid) return null;
    const bvid = String(raw.bvid).trim();
    const durationSeconds = parseDuration(raw.duration);
    const publishedSeconds = safeNumber(raw.pubdate ?? raw.senddate);
    return {
      key: bvid,
      bvid,
      aid: safeNumber(raw.aid ?? raw.id),
      title: stripHtml(raw.title).replace(/\s+/g, " ").trim(),
      description: stripHtml(raw.description ?? raw.desc).replace(/\s+/g, " ").trim(),
      tags: normalizeTags(raw),
      category: stripHtml(raw.typename ?? raw.cate_name ?? raw.area).trim(),
      url: `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`,
      coverUrl: httpsUrl(raw.pic ?? raw.cover),
      durationSeconds,
      durationText: durationLabel(raw.duration, durationSeconds),
      publishedAt: publishedSeconds === null ? null : publishedSeconds * 1e3,
      author: {
        name: stripHtml(raw.author ?? raw.uname).trim(),
        mid: safeNumber(raw.mid ?? raw.uid),
        avatarUrl: httpsUrl(raw.upic ?? raw.uface)
      },
      stats: {
        views: safeNumber(raw.play),
        likes: safeNumber(raw.like),
        favorites: safeNumber(raw.favorites),
        replies: safeNumber(raw.review),
        danmaku: safeNumber(raw.danmaku ?? raw.video_review),
        coins: safeNumber(raw.coin),
        shares: safeNumber(raw.share)
      },
      sources: [{
        order: source.order ?? "unknown",
        orderLabel: ORDER_LABELS[source.order] ?? source.order ?? "未知",
        page: source.page ?? 1,
        position: source.position ?? null
      }]
    };
  }
  function pickLonger(left, right) {
    const first = String(left ?? "");
    const second = String(right ?? "");
    return second.length > first.length ? right : left;
  }
  function mergeVideo(existing, incoming) {
    if (!existing) return incoming;
    existing.title = pickLonger(existing.title, incoming.title);
    existing.description = pickLonger(existing.description, incoming.description);
    existing.tags = [.../* @__PURE__ */ new Set([...existing.tags ?? [], ...incoming.tags ?? []])];
    existing.category ||= incoming.category;
    existing.coverUrl ||= incoming.coverUrl;
    existing.durationSeconds ??= incoming.durationSeconds;
    existing.durationText ||= incoming.durationText;
    existing.publishedAt ??= incoming.publishedAt;
    existing.author.name ||= incoming.author.name;
    existing.author.mid ??= incoming.author.mid;
    existing.author.avatarUrl ||= incoming.author.avatarUrl;
    for (const [key, value] of Object.entries(incoming.stats)) {
      if (value === null || value === void 0) continue;
      existing.stats[key] = existing.stats[key] === null || existing.stats[key] === void 0 ? value : Math.max(existing.stats[key], value);
    }
    const sourceKeys = new Set(existing.sources.map((source) => `${source.order}:${source.page}:${source.position}`));
    for (const source of incoming.sources) {
      const key = `${source.order}:${source.page}:${source.position}`;
      if (!sourceKeys.has(key)) existing.sources.push(source);
    }
    return existing;
  }
  function deduplicateVideos(videos) {
    const byKey = /* @__PURE__ */ new Map();
    for (const video of videos) {
      if (!video?.key) continue;
      byKey.set(video.key, mergeVideo(byKey.get(video.key), video));
    }
    return [...byKey.values()];
  }
  function extractWbiKeys(payload) {
    const imageUrl = payload?.data?.wbi_img?.img_url;
    const subUrl = payload?.data?.wbi_img?.sub_url;
    if (!imageUrl || !subUrl) return null;
    const filename = (url) => String(url).split("/").pop()?.split(".")[0] ?? "";
    const imageKey = filename(imageUrl);
    const subKey = filename(subUrl);
    if (!imageKey || !subKey) return null;
    const source = imageKey + subKey;
    const mixinKey = MIXIN_KEY_ENCODE_TABLE.map((index) => source[index] ?? "").join("").slice(0, 32);
    return mixinKey ? { imageKey, subKey, mixinKey } : null;
  }
  function cleanWbiValue(value) {
    return String(value).replace(/[!'()*]/g, "");
  }
  function canonicalQuery(params) {
    return Object.entries(params).filter(([, value]) => value !== void 0 && value !== null).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(cleanWbiValue(value))}`).join("&");
  }
  function plainQuery(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== void 0 && value !== null) search.set(key, String(value));
    }
    return search.toString();
  }
  function signWbiParams(params, mixinKey, timestamp = Math.floor(Date.now() / 1e3)) {
    const withTimestamp = { ...params, wts: timestamp };
    const query = canonicalQuery(withTimestamp);
    return `${query}&w_rid=${md5(query + mixinKey)}`;
  }
  function parseJsonResponse(responseText, responseObject) {
    if (responseObject && typeof responseObject === "object") return responseObject;
    try {
      return JSON.parse(responseText);
    } catch (cause) {
      throw new BilibiliApiError("B站接口返回了无法解析的内容", { kind: "parse", cause });
    }
  }
  function gmRequest(url, { signal, timeout = 2e4 } = {}) {
    return new Promise((resolve, reject) => {
      ensureNotAborted(signal);
      let settled = false;
      let request;
      let timeoutId;
      const onAbort = () => {
        try {
          request?.abort?.();
        } catch {
        }
        finish(reject, abortError());
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        callback(value);
      };
      timeoutId = setTimeout(() => {
        finish(reject, new BilibiliApiError("B站搜索接口请求超时", { kind: "timeout" }));
        try {
          request?.abort?.();
        } catch {
        }
      }, timeout);
      request = GM_xmlhttpRequest({
        method: "GET",
        url,
        anonymous: true,
        timeout,
        responseType: "json",
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: "https://search.bilibili.com/"
        },
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            const kind = response.status === 412 || response.status === 429 ? "risk" : "http";
            finish(reject, new BilibiliApiError(`B站接口 HTTP ${response.status}`, { status: response.status, kind }));
            return;
          }
          try {
            finish(resolve, parseJsonResponse(response.responseText, response.response));
          } catch (error) {
            finish(reject, error);
          }
        },
        onerror: () => finish(reject, new BilibiliApiError("无法连接 B站搜索接口", { kind: "network" })),
        ontimeout: () => finish(reject, new BilibiliApiError("B站搜索接口请求超时", { kind: "timeout" })),
        onabort: () => finish(reject, abortError())
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  async function fetchRequest(url, { signal, timeout = 2e4 } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        mode: "cors",
        cache: "no-store",
        headers: { Accept: "application/json, text/plain, */*" },
        signal: controller.signal
      });
      if (!response.ok) {
        const kind = response.status === 412 || response.status === 429 ? "risk" : "http";
        throw new BilibiliApiError(`B站接口 HTTP ${response.status}`, { status: response.status, kind });
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        throw new BilibiliApiError("B站接口未返回 JSON", { status: response.status, kind: "parse" });
      }
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw signal?.aborted ? abortError() : new BilibiliApiError("B站搜索接口请求超时", { kind: "timeout" });
      if (error instanceof BilibiliApiError) throw error;
      throw new BilibiliApiError("无法连接 B站搜索接口", { kind: "network", cause: error });
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  function createDefaultRequest() {
    if (typeof GM_xmlhttpRequest === "function") return gmRequest;
    return fetchRequest;
  }
  function validatePayload(payload) {
    if (payload?.code === 0 && payload?.data?.v_voucher) {
      throw new BilibiliApiError("B站触发了访问验证，请稍后再试", { code: -352, kind: "risk" });
    }
    const code = Number(payload?.code);
    if (code === 0) return payload;
    const kind = RISK_CODES.has(code) ? "risk" : "api";
    const message = kind === "risk" ? "B站触发了访问验证，请稍后再试" : `B站搜索接口返回错误：${payload?.message || code}`;
    throw new BilibiliApiError(message, { code, kind });
  }
  function waitForSharedPromise(promise, signal) {
    if (!signal) return promise;
    ensureNotAborted(signal);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        }
      );
    });
  }
  function randomId() {
    if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  }
  var BilibiliSearchApiAdapter = class {
    constructor({ request = createDefaultRequest(), now = () => Date.now(), random = Math.random } = {}) {
      this.request = request;
      this.now = now;
      this.random = random;
      this.wbiCache = null;
      this.wbiPending = null;
    }
    async getWbiKeys(signal) {
      if (this.wbiCache && this.wbiCache.expiresAt > this.now()) return this.wbiCache.keys;
      if (!this.wbiPending) {
        this.wbiPending = (async () => {
          const payload = await this.request(SEARCH_ENDPOINTS.nav, {});
          const code = Number(payload?.code);
          if (payload?.data?.v_voucher || RISK_CODES.has(code)) {
            throw new BilibiliApiError("B站触发了访问验证，请稍后再试", { code, kind: "risk" });
          }
          const keys2 = extractWbiKeys(payload);
          if (!keys2) throw new BilibiliApiError("暂时无法取得 B站 WBI 签名参数", { kind: "signature" });
          this.wbiCache = { keys: keys2, expiresAt: this.now() + 6 * 60 * 60 * 1e3 };
          return keys2;
        })().finally(() => {
          this.wbiPending = null;
        });
      }
      const keys = await waitForSharedPromise(this.wbiPending, signal);
      ensureNotAborted(signal);
      return keys;
    }
    async buildWbiUrl(params, signal) {
      try {
        const keys = await this.getWbiKeys(signal);
        return `${SEARCH_ENDPOINTS.wbi}?${signWbiParams(params, keys.mixinKey, Math.floor(this.now() / 1e3))}`;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        if (error?.kind === "risk") throw error;
        return `${SEARCH_ENDPOINTS.wbi}?${plainQuery(params)}`;
      }
    }
    async searchPage({ keyword, order, page, pageSize = 50, qvId = randomId(), signal }) {
      ensureNotAborted(signal);
      const params = {
        search_type: "video",
        keyword,
        page,
        page_size: Math.min(50, Math.max(1, pageSize)),
        order,
        platform: "pc",
        highlight: 1,
        single_column: 0,
        web_location: 1430654,
        qv_id: qvId
      };
      let url = await this.buildWbiUrl(params, signal);
      let payload;
      try {
        payload = validatePayload(await this.request(url, { signal }));
      } catch (error) {
        const staleSignature = error instanceof BilibiliApiError && (error.code === -403 || error.status === 403);
        if (staleSignature) {
          this.wbiCache = null;
          try {
            url = await this.buildWbiUrl(params, signal);
            payload = validatePayload(await this.request(url, { signal }));
          } catch (retryError) {
            if (retryError instanceof BilibiliApiError && (retryError.code === -403 || retryError.status === 403)) {
              throw new BilibiliApiError("WBI 签名刷新后仍被拒绝，本轮搜索已停止", {
                code: retryError.code,
                status: retryError.status,
                kind: "signature",
                cause: retryError
              });
            }
            throw retryError;
          }
        } else {
          const mayUseLegacy = error instanceof BilibiliApiError && (error.kind === "http" && [404, 405].includes(error.status) || error.code === -404);
          if (!mayUseLegacy) throw error;
          payload = validatePayload(await this.request(`${SEARCH_ENDPOINTS.legacy}?${plainQuery(params)}`, { signal }));
        }
      }
      const rows = Array.isArray(payload?.data?.result) ? payload.data.result : Array.isArray(payload?.data?.result?.video) ? payload.data.result.video : [];
      const videos = rows.map((raw, index) => normalizeVideo(raw, {
        order,
        page,
        position: index + 1
      })).filter(Boolean);
      return {
        videos,
        rawCount: rows.length,
        ignoredCount: rows.length - videos.length,
        page: safeNumber(payload?.data?.page, page),
        numPages: safeNumber(payload?.data?.numPages),
        numResults: safeNumber(payload?.data?.numResults),
        hasNext: payload?.data?.next !== 0 && (safeNumber(payload?.data?.numPages) === null || page < safeNumber(payload?.data?.numPages))
      };
    }
    async collectCandidates(keyword, profile, { signal, onProgress } = {}) {
      const orders = [...profile.orders];
      const qvId = randomId();
      const collected = [];
      const errors = [];
      let completed = 0;
      let rawCount = 0;
      let ignoredCount = 0;
      const total = orders.length * profile.pagesPerOrder;
      let nextOrderIndex = 0;
      let fatalError = null;
      const internalController = new AbortController();
      const internalSignal = internalController.signal;
      const onExternalAbort = () => internalController.abort();
      signal?.addEventListener("abort", onExternalAbort, { once: true });
      if (signal?.aborted) internalController.abort();
      const worker = async () => {
        while (!internalSignal.aborted && nextOrderIndex < orders.length) {
          const orderIndex = nextOrderIndex;
          nextOrderIndex += 1;
          const order = orders[orderIndex];
          for (let page = 1; page <= profile.pagesPerOrder; page += 1) {
            ensureNotAborted(internalSignal);
            if (completed > 0) await sleep(150 + Math.floor(this.random() * 151), internalSignal);
            onProgress?.({ phase: "request", completed, total, order, page, candidateCount: collected.length });
            try {
              const result = await this.searchPage({
                keyword,
                order,
                page,
                pageSize: profile.pageSize,
                qvId,
                signal: internalSignal
              });
              collected.push(...result.videos);
              rawCount += result.rawCount;
              ignoredCount += result.ignoredCount;
              completed += 1;
              onProgress?.({ phase: "request", completed, total, order, page, candidateCount: collected.length });
              if (result.rawCount === 0 || !result.hasNext) break;
            } catch (error) {
              if (error?.kind === "risk" || error?.kind === "signature") {
                fatalError ??= error;
                internalController.abort();
                throw error;
              }
              if (error?.name === "AbortError") throw error;
              errors.push({ order, page, message: error?.message ?? String(error) });
              completed += 1;
              onProgress?.({ phase: "request", completed, total, order, page, candidateCount: collected.length });
              break;
            }
          }
        }
      };
      const workers = Array.from({ length: Math.min(2, orders.length) }, () => worker());
      const outcomes = await Promise.allSettled(workers);
      signal?.removeEventListener("abort", onExternalAbort);
      if (fatalError) throw fatalError;
      if (signal?.aborted) throw abortError();
      const unexpectedFailure = outcomes.find((outcome) => outcome.status === "rejected" && outcome.reason?.name !== "AbortError");
      if (unexpectedFailure) throw unexpectedFailure.reason;
      if (!collected.length && errors.length) {
        throw new BilibiliApiError(errors[0].message || "未能取得搜索结果", { kind: "partial" });
      }
      const videos = deduplicateVideos(collected);
      return {
        videos,
        rawCount,
        validCount: collected.length,
        uniqueCount: videos.length,
        ignoredCount,
        duplicateCount: collected.length - videos.length,
        errors,
        requestedRoutes: total,
        completedRoutes: completed
      };
    }
  };

  // src/scoring.js
  var FIELD_DEFINITIONS = Object.freeze([
    Object.freeze({ id: "title", label: "标题", strength: 1 }),
    Object.freeze({ id: "tags", label: "标签", strength: 0.78 }),
    Object.freeze({ id: "description", label: "简介", strength: 0.48 }),
    Object.freeze({ id: "author", label: "UP主", strength: 0.4 }),
    Object.freeze({ id: "category", label: "分区", strength: 0.28 })
  ]);
  var CORE_FIELDS = /* @__PURE__ */ new Set(["title", "tags", "description"]);
  var VERSION_QUALIFIERS = /* @__PURE__ */ new Set([
    "pro",
    "max",
    "ultra",
    "mini",
    "plus",
    "air",
    "se",
    "ti",
    "super",
    "xt",
    "edition",
    "mark",
    "mk",
    "ii",
    "iii",
    "iv",
    "v",
    "vi",
    "vii",
    "viii",
    "ix",
    "x",
    "版",
    "代"
  ]);
  var QUALITY_METRICS = Object.freeze([
    Object.freeze({ id: "views", label: "播放", weight: 0.16, rate: false }),
    Object.freeze({ id: "likes", label: "点赞", weight: 0.2, rate: true }),
    Object.freeze({ id: "favorites", label: "收藏", weight: 0.18, rate: true }),
    Object.freeze({ id: "coins", label: "投币", weight: 0.16, rate: true }),
    Object.freeze({ id: "replies", label: "评论", weight: 0.09, rate: true }),
    Object.freeze({ id: "danmaku", label: "弹幕", weight: 0.07, rate: true })
  ]);
  function clamp(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, value));
  }
  function weightedSum(items) {
    return items.reduce((sum, item) => sum + item.value * item.weight, 0);
  }
  function fieldText(video, fieldId) {
    if (fieldId === "tags") return (video.tags ?? []).join(" ");
    if (fieldId === "author") return video.author?.name ?? "";
    return video[fieldId] ?? "";
  }
  function isAsciiWord(value) {
    return /^[a-z0-9+#._-]+$/i.test(value);
  }
  function hasExactTerm(text, term) {
    const normalized = normalizeText(text);
    const compact = compactText(text);
    if (!term.compact) return false;
    if (!isAsciiWord(term.compact)) return compact.includes(term.compact);
    const escaped = term.compact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (/^\d+$/.test(term.compact)) return new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`, "i").test(normalized);
    if (/^[a-z]+$/i.test(term.compact) && /^[a-z]+$/i.test(term.text)) {
      return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(normalized);
    }
    const flexibleInner = [...term.compact].map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s._-]*");
    const leftBoundary = /^[a-z]/i.test(term.compact) ? "[^a-z]" : "[^a-z0-9]";
    const flexiblePattern = new RegExp(`(^|${leftBoundary})${flexibleInner}([^a-z0-9]|$)`, "i");
    if (flexiblePattern.test(normalized)) return true;
    return new RegExp(`(^|${leftBoundary})${escaped}([^a-z0-9]|$)`, "i").test(compact);
  }
  function matchTermInField(term, text, profile) {
    if (!text) return { confidence: 0, exact: false, fuzzy: false };
    if (hasExactTerm(text, term)) return { confidence: 1, exact: true, fuzzy: false };
    const shortAscii = /^[a-z]+$/i.test(term.compact) && term.compact.length < 5;
    if (profile.fuzzyThreshold >= 1 || /^\d+$/.test(term.compact) || term.compact.length < 3 || shortAscii) {
      return { confidence: 0, exact: false, fuzzy: false };
    }
    const similarity = bestSubstringSimilarity(term.compact, text);
    if (similarity < profile.fuzzyThreshold) return { confidence: 0, exact: false, fuzzy: false };
    return { confidence: similarity * 0.82, exact: false, fuzzy: true };
  }
  function phraseDetails(parsedQuery, video) {
    const author = compactText(video.author?.name);
    const category = compactText(video.category);
    const phrase = parsedQuery.compact;
    const phraseTerm = { text: parsedQuery.normalized, compact: phrase };
    if (phrase && hasExactTerm(video.title, phraseTerm)) return { score: 1, reason: "完整查询命中标题", field: "title" };
    if (phrase && hasExactTerm((video.tags ?? []).join(" "), phraseTerm)) return { score: 0.75, reason: "完整查询命中标签", field: "tags" };
    if (phrase && hasExactTerm(video.description, phraseTerm)) return { score: 0.65, reason: "完整查询命中简介", field: "description" };
    if (phrase && author === phrase) return { score: 0.55, reason: "查询精确命中 UP 主", field: "author" };
    if (phrase && category === phrase) return { score: 0.35, reason: "查询精确命中分区", field: "category" };
    if (containsOrderedTerms(video.title, parsedQuery.terms)) {
      return { score: 0.58, reason: "查询词按顺序出现在标题", field: "title" };
    }
    const affinity = parsedQuery.compact.length >= 4 ? ngramContainment(parsedQuery.compact, video.title) : 0;
    if (affinity >= 0.65) {
      return { score: Math.min(0.45, affinity * 0.5), reason: "标题与查询具有较高字面邻近度", field: "title" };
    }
    return { score: 0, reason: "", field: "" };
  }
  function proximityScore(parsedQuery, video) {
    if (parsedQuery.terms.length < 2) return 1;
    const title = compactText(video.title);
    const positions = [];
    let matchedLength = 0;
    for (const term of parsedQuery.terms) {
      const position = title.indexOf(term.compact);
      if (position >= 0) {
        positions.push({ position, length: term.compact.length });
        matchedLength += term.compact.length;
      }
    }
    if (positions.length < 2) return 0;
    const start = Math.min(...positions.map((item) => item.position));
    const end = Math.max(...positions.map((item) => item.position + item.length));
    return clamp(matchedLength / Math.max(1, end - start) * (positions.length / parsedQuery.terms.length));
  }
  function exactPhrasePasses(parsedQuery, video, mode) {
    if (parsedQuery.exactPhrases.length === 0) return true;
    const fieldIds = mode === "strict" ? ["title", "tags"] : ["title", "tags", "description", "author"];
    return parsedQuery.exactPhrases.every(
      (phrase) => fieldIds.some((fieldId) => hasExactTerm(fieldText(video, fieldId), { text: normalizeText(phrase), compact: compactText(phrase) }))
    );
  }
  function negativeMatch(parsedQuery, video) {
    const searchable = [
      video.title,
      (video.tags ?? []).join(" "),
      video.description,
      video.author?.name,
      video.category
    ].join(" ");
    return parsedQuery.negativeTerms.find((term) => hasExactTerm(searchable, term)) ?? null;
  }
  function modelTermPasses(matchedTerms, mode) {
    const modelTerms = matchedTerms.filter((item) => /\d/.test(item.term));
    const qualifiers = matchedTerms.filter((item) => VERSION_QUALIFIERS.has(item.term.toLocaleLowerCase()));
    if (modelTerms.length === 0 && qualifiers.length === 0) return true;
    const required = [...modelTerms, ...qualifiers];
    return required.every((item) => item.matches.some((match) => match.exact && CORE_FIELDS.has(match.field)));
  }
  function scoreRelevance(video, queryOrParsed, mode = "standard") {
    const profile = getModeProfile(mode);
    const parsedQuery = typeof queryOrParsed === "string" ? parseQuery(queryOrParsed) : queryOrParsed;
    if (!parsedQuery?.terms?.length) {
      return {
        value: 0,
        coverage: 0,
        titleCoverage: 0,
        passes: false,
        matchedTerms: [],
        missingTerms: [],
        positiveReasons: [],
        negativeReasons: ["查询中没有可评分的关键词"],
        rejectionReasons: ["查询中没有可评分的关键词"]
      };
    }
    const totalWeight = parsedQuery.terms.reduce((sum, term) => sum + term.weight, 0) || 1;
    const matchedTerms = parsedQuery.terms.map((term) => {
      const matches = FIELD_DEFINITIONS.map((field) => {
        const detail = matchTermInField(term, fieldText(video, field.id), profile);
        return { field: field.id, fieldLabel: field.label, strength: field.strength, ...detail };
      }).filter((match) => match.confidence > 0);
      const best = matches.reduce((winner, item) => {
        const score = item.confidence * item.strength;
        return score > winner.score ? { score, item } : winner;
      }, { score: 0, item: null });
      return {
        term: term.text,
        compact: term.compact,
        weight: term.weight,
        quoted: term.quoted,
        auxiliary: term.auxiliary,
        confidence: Math.max(0, ...matches.map((match) => match.confidence)),
        fieldScore: best.score,
        matches
      };
    });
    const coverage = matchedTerms.reduce((sum, item) => sum + item.weight * item.confidence, 0) / totalWeight;
    const fieldScore = matchedTerms.reduce((sum, item) => sum + item.weight * item.fieldScore, 0) / totalWeight;
    const titleCoverage = matchedTerms.reduce((sum, item) => {
      const titleMatch = item.matches.find((match) => match.field === "title");
      return sum + item.weight * (titleMatch?.confidence ?? 0);
    }, 0) / totalWeight;
    const coreCoverage = matchedTerms.reduce((sum, item) => {
      const confidence = Math.max(0, ...item.matches.filter((match) => CORE_FIELDS.has(match.field)).map((match) => match.confidence));
      return sum + item.weight * confidence;
    }, 0) / totalWeight;
    const phrase = phraseDetails(parsedQuery, video);
    const proximity = proximityScore(parsedQuery, video);
    const authorExact = phrase.field === "author" && phrase.score > 0;
    const value = clamp(
      0.5 * fieldScore + 0.25 * coverage + 0.13 * titleCoverage + 0.08 * phrase.score + 0.04 * proximity + (authorExact ? 0.06 : 0)
    );
    const missingTerms = matchedTerms.filter((item) => item.matches.length === 0 && !item.auxiliary).map((item) => item.term);
    const negative = negativeMatch(parsedQuery, video);
    const phrasePass = exactPhrasePasses(parsedQuery, video, mode);
    const modelPass = authorExact && mode !== "strict" ? true : modelTermPasses(matchedTerms, mode);
    const hasTitleOrTag = matchedTerms.some((item) => item.matches.some((match) => match.field === "title" || match.field === "tags"));
    const descriptionPhraseException = phrase.field === "description" && phrase.score >= 0.65;
    const corePass = mode === "strict" ? titleCoverage >= 0.45 : mode === "standard" ? hasTitleOrTag || descriptionPhraseException || authorExact : coreCoverage > 0 || authorExact;
    const rejectionReasons = [];
    if (negative) rejectionReasons.push(`命中排除词“${negative.text}”`);
    if (value < profile.threshold) rejectionReasons.push(`相关性低于 ${Math.round(profile.threshold * 100)} 分`);
    if (coverage < profile.minCoverage) rejectionReasons.push(`关键词覆盖低于 ${Math.round(profile.minCoverage * 100)}%`);
    if (!corePass) rejectionReasons.push(mode === "strict" ? "严格模式要求标题覆盖主要关键词" : "标题、标签或简介缺少核心命中");
    if (mode === "strict" && missingTerms.length) rejectionReasons.push("严格模式要求全部关键词命中");
    if (!phrasePass) rejectionReasons.push("引号中的短语未精确命中允许字段");
    if (!modelPass) rejectionReasons.push("数字、年份或型号词未在核心字段精确命中");
    const positiveReasons = [];
    if (phrase.reason) positiveReasons.push(phrase.reason);
    const titleMatchCount = matchedTerms.filter((item) => item.matches.some((match) => match.field === "title")).length;
    if (titleMatchCount === matchedTerms.length) positiveReasons.push(`标题命中全部 ${matchedTerms.length} 个词项`);
    else if (titleMatchCount > 0) positiveReasons.push(`标题命中 ${titleMatchCount}/${matchedTerms.length} 个词项`);
    if (coverage >= 0.99) positiveReasons.push("关键词覆盖完整");
    const negativeReasons = [];
    if (missingTerms.length) negativeReasons.push(`未命中：${missingTerms.join("、")}`);
    const nonTitleTerms = matchedTerms.filter((item) => item.matches.length > 0 && !item.matches.some((match) => match.field === "title")).map((item) => item.term);
    if (nonTitleTerms.length) negativeReasons.push(`仅在非标题字段命中：${nonTitleTerms.join("、")}`);
    if (matchedTerms.some((item) => item.matches.some((match) => match.fuzzy))) negativeReasons.push("包含探索模式的近似匹配");
    return {
      value,
      coverage,
      coreCoverage,
      titleCoverage,
      phrase,
      passes: rejectionReasons.length === 0,
      matchedTerms: matchedTerms.filter((item) => item.matches.length > 0 && !item.auxiliary).map((item) => ({
        term: item.term,
        confidence: item.confidence,
        fields: [...new Set(item.matches.map((match) => match.fieldLabel))],
        fuzzy: item.matches.some((match) => match.fuzzy)
      })),
      missingTerms,
      positiveReasons,
      negativeReasons,
      rejectionReasons
    };
  }
  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  function percentile(sortedValues, value) {
    if (!sortedValues.length || !Number.isFinite(value)) return 0.5;
    let below = 0;
    let equal = 0;
    for (const candidate of sortedValues) {
      if (candidate < value) below += 1;
      else if (candidate === value) equal += 1;
    }
    const midrank = (below + 0.5 * equal) / sortedValues.length;
    const confidence = Math.min(1, sortedValues.length / 25);
    return clamp(0.5 + (midrank - 0.5) * confidence);
  }
  function ageDays(video, now) {
    const publishedAt = Number(video.publishedAt);
    if (!Number.isFinite(publishedAt) || publishedAt <= 0) return null;
    return Math.max(0, (now - publishedAt) / 864e5);
  }
  function validStat(video, metricId) {
    const value = video.stats?.[metricId];
    return value === null || value === void 0 || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value));
  }
  function qualityContext(videos, now) {
    const categoryCounts = /* @__PURE__ */ new Map();
    for (const video of videos) {
      const key = video.category || "未分区";
      categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
    }
    const contextKey = (video) => categoryCounts.get(video.category || "未分区") >= 25 ? video.category || "未分区" : "__all__";
    const groups = /* @__PURE__ */ new Map([["__all__", videos]]);
    for (const [category, count] of categoryCounts) {
      if (count >= 25) groups.set(category, videos.filter((video) => (video.category || "未分区") === category));
    }
    const prepared = /* @__PURE__ */ new Map();
    for (const [key, members] of groups) {
      const viewValues = members.map((video) => validStat(video, "views")).filter((value) => value !== null);
      const priorViews = clamp(median(viewValues) * 0.02, 500, 1e4);
      const metrics = {};
      for (const metric of QUALITY_METRICS) {
        const rows = members.map((video) => {
          const count = validStat(video, metric.id);
          const views = validStat(video, "views");
          const age = ageDays(video, now);
          return { video, count, views, age };
        }).filter((row) => row.count !== null);
        const rates = metric.rate ? rows.filter((row) => row.views !== null).map((row) => row.count / Math.max(row.views, row.count, 1)) : [];
        const baseRate = median(rates);
        const values = rows.map((row) => {
          const velocityDivisor = Math.pow((row.age ?? 365) + 7, 0.35);
          const countLog = Math.log1p(row.count);
          const velocityLog = Math.log1p(row.count / velocityDivisor);
          const rate = metric.rate && row.views !== null ? (row.count + priorViews * baseRate) / (Math.max(row.views, row.count, 1) + priorViews) : null;
          return { video: row.video, countLog, velocityLog, rate };
        });
        metrics[metric.id] = {
          values,
          countLogs: values.map((item) => item.countLog).sort((a, b) => a - b),
          velocityLogs: values.map((item) => item.velocityLog).sort((a, b) => a - b),
          rates: values.map((item) => item.rate).filter((value) => value !== null).sort((a, b) => a - b)
        };
      }
      prepared.set(key, metrics);
    }
    const globalMetrics = prepared.get("__all__");
    for (const [key, metrics] of prepared) {
      if (key === "__all__") continue;
      for (const metric of QUALITY_METRICS) {
        if (metrics[metric.id].values.length < 25) metrics[metric.id] = globalMetrics[metric.id];
      }
    }
    return { contextKey, prepared };
  }
  function freshnessPolicy(parsedQuery, now) {
    const currentYear = new Date(now).getFullYear();
    const years = parsedQuery.normalized.match(/(?:19|20)\d{2}/g)?.map(Number) ?? [];
    if (years.some((year) => year < currentYear - 1)) return { enabled: false, halfLife: 730 };
    const recentWords = /最新|近期|最近|今日|今天|今年|latest|recent|current/.test(parsedQuery.normalized);
    if (recentWords || years.includes(currentYear)) return { enabled: true, halfLife: 120 };
    return { enabled: true, halfLife: 730 };
  }
  function scoreOneQuality(video, groupMetrics, freshness, now) {
    const components = [];
    for (const metric of QUALITY_METRICS) {
      const stat = validStat(video, metric.id);
      const preparedMetric = groupMetrics[metric.id];
      const item = preparedMetric.values.find((candidate) => candidate.video === video);
      if (stat === null || !item) continue;
      const countSignal = 0.6 * percentile(preparedMetric.countLogs, item.countLog) + 0.4 * percentile(preparedMetric.velocityLogs, item.velocityLog);
      const rateSignal = metric.rate && item.rate !== null ? percentile(preparedMetric.rates, item.rate) : null;
      const value2 = rateSignal === null ? countSignal : 0.45 * countSignal + 0.55 * rateSignal;
      components.push({ id: metric.id, label: metric.label, weight: metric.weight, value: value2, countSignal, rateSignal });
    }
    const age = ageDays(video, now);
    if (freshness.enabled && age !== null) {
      const value2 = (20 + 80 * Math.pow(2, -age / freshness.halfLife)) / 100;
      components.push({ id: "freshness", label: "时效", weight: 0.14, value: value2, countSignal: value2, rateSignal: null });
    }
    const activeWeight = QUALITY_METRICS.reduce((sum, metric) => sum + metric.weight, 0) + (freshness.enabled ? 0.14 : 0);
    const availableWeight = components.reduce((sum, component) => sum + component.weight, 0);
    const raw = availableWeight ? weightedSum(components) / availableWeight : 0.5;
    const completeness = activeWeight ? availableWeight / activeWeight : 0;
    const value = clamp(0.5 + (raw - 0.5) * (0.4 + 0.6 * completeness));
    const strongest = [...components].sort((a, b) => b.value - a.value).slice(0, 2);
    const positiveReasons = strongest.filter((component) => component.value >= 0.7).map(
      (component) => component.id === "freshness" ? "发布时间较近" : `${component.label}综合表现处于比较候选前列`
    );
    const negativeReasons = [];
    if (completeness < 0.7) negativeReasons.push("部分互动统计缺失，质量分已向中性收缩");
    if (!positiveReasons.length) positiveReasons.push("质量分仅用于相近相关性结果间的辅助排序");
    return { value, raw, completeness, components, positiveReasons, negativeReasons };
  }
  function applyQualityScores(scoredVideos, parsedQuery, now = Date.now()) {
    if (!scoredVideos.length) return scoredVideos;
    const { contextKey, prepared } = qualityContext(scoredVideos.map((item) => item.video), now);
    const freshness = freshnessPolicy(parsedQuery, now);
    for (const item of scoredVideos) {
      item.quality = scoreOneQuality(item.video, prepared.get(contextKey(item.video)), freshness, now);
    }
    return scoredVideos;
  }
  function rerankCandidates(videos, query, mode = "standard", options = {}) {
    const profile = getModeProfile(mode);
    const parsedQuery = parseQuery(query);
    const evaluated = videos.map((video) => ({
      video,
      relevance: scoreRelevance(video, parsedQuery, mode),
      quality: null,
      rank: null
    }));
    const accepted = evaluated.filter((item) => item.relevance.passes);
    const rejected = evaluated.filter((item) => !item.relevance.passes);
    applyQualityScores(accepted, parsedQuery, options.now ?? Date.now());
    for (const item of accepted) {
      const relevanceBand = Math.floor((item.relevance.value + Number.EPSILON) / profile.relevanceBand);
      const innerScore = profile.relevanceWeight * item.relevance.value + (1 - profile.relevanceWeight) * item.quality.value;
      item.rank = { relevanceBand, innerScore };
    }
    accepted.sort(
      (left, right) => right.rank.relevanceBand - left.rank.relevanceBand || right.rank.innerScore - left.rank.innerScore || right.relevance.value - left.relevance.value || right.quality.value - left.quality.value || (right.video.publishedAt ?? 0) - (left.video.publishedAt ?? 0) || String(left.video.bvid ?? left.video.key).localeCompare(String(right.video.bvid ?? right.video.key))
    );
    accepted.forEach((item, index) => {
      item.position = index + 1;
    });
    return {
      mode: profile.id,
      profile,
      parsedQuery,
      ranked: accepted,
      rejected,
      stats: {
        evaluated: evaluated.length,
        accepted: accepted.length,
        rejected: rejected.length,
        threshold: profile.threshold,
        minCoverage: profile.minCoverage
      }
    };
  }

  // src/style.js
  var APP_STYLES = String.raw`
:host {
  --bps-bg: var(--bg1, #ffffff);
  --bps-bg-soft: var(--bg2, #f6f7f8);
  --bps-bg-muted: var(--bg3, #eef0f2);
  --bps-text: var(--text1, #18191c);
  --bps-text-soft: var(--text2, #61666d);
  --bps-text-faint: var(--text3, #9499a0);
  --bps-line: var(--line_regular, #e3e5e7);
  --bps-brand: var(--brand_blue, #00aeec);
  --bps-brand-dark: #008ac5;
  --bps-pink: #fb7299;
  --bps-good: #2f9b72;
  --bps-warn: #d7862f;
  --bps-shadow: 0 12px 38px rgba(0, 0, 0, .14);
  color: var(--bps-text);
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  pointer-events: none;
  position: fixed;
  inset: 0;
  z-index: 1000;
}

* { box-sizing: border-box; }
button, input { font: inherit; }
button { color: inherit; }
[hidden] { display: none !important; }

.launcher {
  align-items: center;
  background: var(--bps-bg);
  border: 1px solid color-mix(in srgb, var(--bps-brand) 42%, var(--bps-line));
  border-radius: 999px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .1);
  cursor: pointer;
  display: inline-flex;
  gap: 7px;
  height: 40px;
  justify-content: center;
  min-width: 120px;
  padding: 0 16px;
  pointer-events: auto;
  position: fixed;
  transition: border-color .16s ease, color .16s ease, transform .16s ease;
  white-space: nowrap;
  z-index: 6;
}
.launcher:hover { border-color: var(--bps-brand); color: var(--bps-brand-dark); transform: translateY(-1px); }
.launcher[aria-pressed="true"] { background: var(--bps-brand); border-color: var(--bps-brand); color: white; }
.launcher:focus-visible, button:focus-visible, input:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--bps-brand) 35%, transparent);
  outline-offset: 2px;
}
.launcher-icon { font-size: 17px; }
.launcher[data-floating="true"] {
  bottom: calc(18px + env(safe-area-inset-bottom, 0px)) !important;
  height: 48px;
  left: auto !important;
  min-width: 48px;
  padding: 0;
  right: 16px !important;
  top: auto !important;
  width: 48px;
}
.launcher[data-floating="true"] .launcher-label { display: none; }

.panel {
  background: var(--bps-bg);
  border-top: 1px solid var(--bps-line);
  bottom: 0;
  box-shadow: 0 -8px 28px rgba(0, 0, 0, .08);
  left: 0;
  overflow: hidden;
  pointer-events: auto;
  position: fixed;
  right: 0;
}
.panel-shell { height: 100%; overflow: auto; overscroll-behavior: contain; }
.toolbar {
  background: var(--bps-bg);
  background: color-mix(in srgb, var(--bps-bg) 94%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--bps-line);
  position: sticky;
  top: 0;
  z-index: 4;
}
.toolbar-inner, .content {
  margin: 0 auto;
  max-width: 1900px;
  padding-left: clamp(16px, 4vw, 72px);
  padding-right: clamp(16px, 4vw, 72px);
}
.toolbar-inner { padding-bottom: 14px; padding-top: 14px; }
.toolbar-top { align-items: center; display: flex; gap: 12px; }
.heading-wrap { min-width: 170px; }
.heading { font-size: 20px; font-weight: 700; line-height: 1.25; margin: 0; }
.privacy-note { color: var(--bps-text-faint); font-size: 12px; margin: 3px 0 0; }
.search-form { display: flex; flex: 1; gap: 8px; min-width: 220px; }
.query-input {
  background: var(--bps-bg-soft);
  border: 1px solid var(--bps-line);
  border-radius: 9px;
  color: var(--bps-text);
  height: 42px;
  min-width: 0;
  padding: 0 13px;
  width: 100%;
}
.query-input:focus { background: var(--bps-bg); border-color: var(--bps-brand); }
.primary, .secondary, .mode-button, .page-button, .retry-button {
  border: 1px solid var(--bps-line);
  border-radius: 9px;
  cursor: pointer;
  min-height: 40px;
  padding: 0 14px;
}
.primary { background: var(--bps-brand); border-color: var(--bps-brand); color: #fff; font-weight: 650; }
.primary:hover { background: var(--bps-brand-dark); }
.secondary, .retry-button, .page-button { background: var(--bps-bg); }
.secondary:hover, .retry-button:hover, .page-button:hover { border-color: var(--bps-brand); color: var(--bps-brand-dark); }
.mode-row { align-items: center; display: flex; gap: 12px; margin-top: 12px; }
.mode-group { background: var(--bps-bg-soft); border-radius: 10px; display: inline-flex; gap: 3px; padding: 3px; }
.mode-button { background: transparent; border-color: transparent; min-height: 36px; padding: 0 15px; }
.mode-button[aria-pressed="true"] { background: var(--bps-bg); border-color: var(--bps-line); box-shadow: 0 1px 5px rgba(0, 0, 0, .07); color: var(--bps-brand-dark); font-weight: 650; }
.mode-note { color: var(--bps-text-soft); font-size: 13px; margin: 0; }
.sr-only { height: 1px; margin: -1px; overflow: hidden; padding: 0; position: absolute; width: 1px; clip: rect(0, 0, 0, 0); white-space: nowrap; }

.content { min-height: 100%; padding-bottom: 54px; padding-top: 18px; }
.status-box {
  align-items: center;
  background: var(--bps-bg-soft);
  border: 1px solid var(--bps-line);
  border-radius: 12px;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-height: 54px;
  padding: 10px 14px;
}
.status-main { min-width: 0; }
.status-title { font-size: 14px; font-weight: 650; margin: 0; }
.status-detail { color: var(--bps-text-soft); font-size: 12px; margin: 3px 0 0; }
.progress-track { background: var(--bps-bg-muted); border-radius: 99px; height: 5px; margin-top: 8px; overflow: hidden; }
.progress-bar { background: linear-gradient(90deg, var(--bps-brand), var(--bps-pink)); height: 100%; transition: width .18s ease; width: 0; }
.warning { background: color-mix(in srgb, var(--bps-warn) 10%, var(--bps-bg)); border: 1px solid color-mix(in srgb, var(--bps-warn) 35%, var(--bps-line)); border-radius: 10px; color: var(--bps-text-soft); font-size: 13px; margin-top: 12px; padding: 10px 13px; }

.results-grid {
  display: grid;
  gap: 22px 16px;
  grid-template-columns: repeat(auto-fill, minmax(min(285px, 100%), 1fr));
  margin-top: 18px;
}
.card { background: var(--bps-bg); border: 1px solid var(--bps-line); border-radius: 13px; min-width: 0; overflow: hidden; transition: box-shadow .16s ease, transform .16s ease; }
.card:hover { box-shadow: 0 8px 24px rgba(0, 0, 0, .1); transform: translateY(-2px); }
.cover-link { aspect-ratio: 16 / 9; background: var(--bps-bg-muted); display: block; overflow: hidden; position: relative; }
.cover { display: block; height: 100%; object-fit: cover; transition: transform .2s ease; width: 100%; }
.card:hover .cover { transform: scale(1.02); }
.duration { background: rgba(0, 0, 0, .72); border-radius: 5px; bottom: 7px; color: white; font-size: 11px; padding: 2px 5px; position: absolute; right: 7px; }
.source-badge { background: rgba(0, 0, 0, .66); border-radius: 5px; color: white; font-size: 11px; left: 7px; padding: 2px 5px; position: absolute; top: 7px; }
.card-body { padding: 12px; }
.card-title { color: var(--bps-text); display: -webkit-box; font-size: 15px; font-weight: 650; line-height: 1.45; margin: 0; min-height: 43px; overflow: hidden; text-decoration: none; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.card-title:hover { color: var(--bps-brand-dark); }
.meta, .metrics { color: var(--bps-text-soft); display: flex; flex-wrap: wrap; font-size: 12px; gap: 5px 10px; margin-top: 8px; }
.scores { display: flex; gap: 7px; margin-top: 11px; }
.score { border-radius: 999px; font-size: 12px; font-weight: 650; padding: 4px 8px; }
.score-relevance { background: color-mix(in srgb, var(--bps-brand) 13%, var(--bps-bg)); color: var(--bps-brand-dark); }
.score-quality { background: color-mix(in srgb, var(--bps-good) 12%, var(--bps-bg)); color: var(--bps-good); }
.reason-primary { color: var(--bps-text-soft); font-size: 12px; line-height: 1.45; margin: 9px 0 0; }
.explanations { border-top: 1px solid var(--bps-line); margin-top: 10px; padding-top: 8px; }
.explanations summary { color: var(--bps-text-soft); cursor: pointer; font-size: 12px; }
.explanations ul { color: var(--bps-text-soft); font-size: 12px; line-height: 1.5; margin: 7px 0 0; padding-left: 18px; }
.match-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.match-chip { background: var(--bps-bg-soft); border-radius: 5px; color: var(--bps-text-soft); font-size: 11px; padding: 3px 6px; }

.empty, .error {
  align-items: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 280px;
  padding: 30px;
  text-align: center;
}
.empty-icon { font-size: 40px; }
.empty h3, .error h3 { font-size: 18px; margin: 12px 0 6px; }
.empty p, .error p { color: var(--bps-text-soft); margin: 0 0 16px; max-width: 620px; }
.pagination { align-items: center; display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; margin-top: 28px; }
.page-button { min-height: 36px; min-width: 38px; padding: 0 10px; }
.page-button[aria-current="page"] { background: var(--bps-brand); border-color: var(--bps-brand); color: white; }
.page-button:disabled { cursor: default; opacity: .45; }

@media (max-width: 860px) {
  .toolbar-top { align-items: stretch; flex-wrap: wrap; }
  .heading-wrap { flex: 1; }
  .search-form { flex-basis: 100%; order: 3; }
  .mode-row { align-items: flex-start; flex-direction: column; gap: 7px; }
  .results-grid { grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); }
}
@media (max-width: 520px) {
  .launcher { bottom: calc(18px + env(safe-area-inset-bottom, 0px)) !important; height: 48px; left: auto !important; min-width: 48px; padding: 0; right: 16px !important; top: auto !important; width: 48px; }
  .launcher-label { display: none; }
  .panel { top: 62px !important; }
  .toolbar-inner, .content { padding-left: 12px; padding-right: 12px; }
  .secondary { padding: 0 10px; }
  .mode-group { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
  .mode-button { padding: 0 8px; }
  .status-box { align-items: flex-start; }
  .results-grid { grid-template-columns: 1fr; }
  .card { display: grid; grid-template-columns: minmax(130px, 42%) 1fr; }
  .cover-link { align-self: start; margin: 10px 0 10px 10px; }
  .card-body { padding: 10px; }
  .metrics span:nth-child(n+3) { display: none; }
}
@media (prefers-color-scheme: dark) {
  :host {
    --bps-bg: var(--bg1, #18191c);
    --bps-bg-soft: var(--bg2, #23252a);
    --bps-bg-muted: var(--bg3, #2f3137);
    --bps-text: var(--text1, #f1f2f3);
    --bps-text-soft: var(--text2, #c9ccd0);
    --bps-text-faint: var(--text3, #9499a0);
    --bps-line: var(--line_regular, #3b3d43);
  }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
}
`;

  // src/ui.js
  var NATIVE_TAB_LABELS = /* @__PURE__ */ new Set(["综合", "视频", "番剧", "影视", "直播", "专栏", "用户"]);
  function normalizeNativeTabLabel(value) {
    return String(value ?? "").trim().replace(/\s*(?:\d+\+?)\s*$/g, "").trim();
  }
  function scoreNativeTabAnchor(nav) {
    if (!nav) return 0;
    const labels = [...nav.querySelectorAll("li, button, a, [role='tab']")].map((node) => normalizeNativeTabLabel(node.textContent));
    return [...new Set(labels.filter((label) => NATIVE_TAB_LABELS.has(label)))].length;
  }
  function element(documentRef, tag, className = "", text = "") {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text !== "") node.textContent = text;
    return node;
  }
  function formatCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (number >= 1e8) return `${(number / 1e8).toFixed(number >= 1e9 ? 0 : 1)}亿`;
    if (number >= 1e4) return `${(number / 1e4).toFixed(number >= 1e5 ? 0 : 1)}万`;
    return new Intl.NumberFormat("zh-CN").format(number);
  }
  function formatDate(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "日期未知";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  }
  function setSafeImage(image, url, title) {
    image.alt = title ? `${title} 封面` : "视频封面";
    image.loading = "lazy";
    image.decoding = "async";
    if (url) image.src = url;
    image.addEventListener("error", () => {
      image.removeAttribute("src");
      image.alt = "封面加载失败";
    }, { once: true });
  }
  function externalLink(documentRef, className, text, href) {
    const link = element(documentRef, "a", className, text);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }
  var PrecisionSearchView = class {
    constructor({ documentRef = document, handlers = {} } = {}) {
      this.document = documentRef;
      this.window = documentRef.defaultView ?? globalThis;
      this.handlers = handlers;
      this.host = null;
      this.shadow = null;
      this.anchor = null;
      this.mode = DEFAULT_MODE;
      this.page = 1;
      this.result = null;
      this.pool = null;
      this.lastError = null;
      this.available = true;
      this.resizeObserver = null;
      this.repositionFrame = null;
      this.lastProgressBucket = -1;
    }
    mount() {
      if (this.host?.isConnected) return this;
      this.host = this.document.createElement("div");
      this.host.id = "bps-host";
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.shadow.innerHTML = `
      <style>${APP_STYLES}</style>
      <button class="launcher" type="button" aria-pressed="false" aria-controls="bps-panel">
        <span class="launcher-icon" aria-hidden="true">🎯</span><span class="launcher-label">精准搜索</span>
      </button>
      <section class="panel" id="bps-panel" role="region" aria-label="精准搜索结果" aria-busy="false" hidden>
        <div class="panel-shell">
          <header class="toolbar">
            <div class="toolbar-inner">
              <div class="toolbar-top">
                <div class="heading-wrap"><h2 class="heading" tabindex="-1">精准搜索</h2><p class="privacy-note">匿名请求，不带观看记录；原生结果保留在面板下方</p></div>
                <form class="search-form" role="search">
                  <input class="query-input" type="search" aria-label="精准搜索关键词" autocomplete="off" placeholder="输入关键词，可用“短语”或 -排除词">
                  <button class="primary" type="submit">重新搜索</button>
                </form>
                <button class="secondary close-button" type="button">返回原生</button>
              </div>
              <div class="mode-row"><div class="mode-group" role="group" aria-label="精准搜索模式"></div><p class="mode-note"></p></div>
            </div>
          </header>
          <main class="content">
            <div class="status-box">
              <div class="status-main"><p class="status-title">点击“精准搜索”开始</p><p class="status-detail">将从多个排序入口收集候选，再执行相关性硬过滤。</p><div class="progress-track" hidden><div class="progress-bar"></div></div></div>
              <button class="secondary cancel-button" type="button" hidden>取消</button>
              <span class="sr-only live-status" role="status" aria-live="polite" aria-atomic="true"></span>
            </div>
            <div class="warning" hidden></div>
            <div class="results-grid"></div>
            <div class="state-view"></div>
            <nav class="pagination" aria-label="精准搜索结果分页" hidden></nav>
          </main>
        </div>
      </section>`;
      this.document.body.append(this.host);
      this.refs = {
        launcher: this.shadow.querySelector(".launcher"),
        panel: this.shadow.querySelector(".panel"),
        panelShell: this.shadow.querySelector(".panel-shell"),
        heading: this.shadow.querySelector(".heading"),
        form: this.shadow.querySelector(".search-form"),
        input: this.shadow.querySelector(".query-input"),
        close: this.shadow.querySelector(".close-button"),
        modeGroup: this.shadow.querySelector(".mode-group"),
        modeNote: this.shadow.querySelector(".mode-note"),
        statusBox: this.shadow.querySelector(".status-box"),
        statusTitle: this.shadow.querySelector(".status-title"),
        statusDetail: this.shadow.querySelector(".status-detail"),
        progressTrack: this.shadow.querySelector(".progress-track"),
        progressBar: this.shadow.querySelector(".progress-bar"),
        cancel: this.shadow.querySelector(".cancel-button"),
        warning: this.shadow.querySelector(".warning"),
        grid: this.shadow.querySelector(".results-grid"),
        stateView: this.shadow.querySelector(".state-view"),
        pagination: this.shadow.querySelector(".pagination"),
        liveStatus: this.shadow.querySelector(".live-status")
      };
      this.renderModeButtons();
      this.bindEvents();
      this.positionToNativeTabs();
      return this;
    }
    bindEvents() {
      this.refs.launcher.addEventListener("click", () => this.handlers.onToggle?.());
      this.refs.close.addEventListener("click", () => this.handlers.onClose?.());
      this.refs.cancel.addEventListener("click", () => this.handlers.onCancel?.());
      this.refs.form.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handlers.onSearch?.(this.refs.input.value.trim());
      });
      this.shadow.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.isOpen()) {
          event.preventDefault();
          event.stopPropagation();
          this.handlers.onClose?.();
        }
      }, true);
      this.window.addEventListener?.("resize", () => this.schedulePosition());
      this.window.addEventListener?.("scroll", () => this.schedulePosition(), { passive: true });
    }
    renderModeButtons() {
      this.refs.modeGroup.replaceChildren();
      for (const profile of Object.values(MODE_PROFILES)) {
        const button = element(this.document, "button", "mode-button", profile.label);
        button.type = "button";
        button.dataset.mode = profile.id;
        button.title = profile.shortDescription;
        button.setAttribute("aria-pressed", String(profile.id === this.mode));
        button.addEventListener("click", () => this.handlers.onModeChange?.(profile.id));
        this.refs.modeGroup.append(button);
      }
      this.setMode(this.mode);
    }
    setMode(mode) {
      this.mode = MODE_PROFILES[mode] ? mode : DEFAULT_MODE;
      this.shadow?.querySelectorAll(".mode-button").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.mode === this.mode));
      });
      if (this.refs) this.refs.modeNote.textContent = MODE_PROFILES[this.mode].shortDescription;
    }
    setQuery(query) {
      if (this.refs && this.refs.input.value !== query) this.refs.input.value = query;
    }
    setAvailable(available) {
      this.available = Boolean(available);
      if (this.refs) this.refs.launcher.hidden = !this.available;
    }
    showPanel({ focus = true } = {}) {
      if (!this.available) return;
      this.refs.panel.hidden = false;
      this.refs.launcher.setAttribute("aria-pressed", "true");
      this.schedulePosition();
      if (focus) queueMicrotask(() => this.refs.heading.focus({ preventScroll: true }));
    }
    hidePanel({ restoreFocus = true } = {}) {
      this.refs.panel.hidden = true;
      this.refs.launcher.setAttribute("aria-pressed", "false");
      this.refs.panel.setAttribute("aria-busy", "false");
      if (restoreFocus && !this.refs.launcher.hidden) this.refs.launcher.focus({ preventScroll: true });
    }
    isOpen() {
      return Boolean(this.refs && !this.refs.panel.hidden);
    }
    setLoading({ completed = 0, total = 1, candidateCount = 0, order = "", page = 1 } = {}) {
      if (completed === 0 && candidateCount === 0 && !order) this.lastProgressBucket = -1;
      this.refs.panel.setAttribute("aria-busy", "true");
      this.refs.statusTitle.textContent = `正在扩展候选池… ${completed}/${total}`;
      this.refs.statusDetail.textContent = order ? `正在读取 ${order} 排序第 ${page} 页，已取得 ${candidateCount} 条有效候选` : "正在连接 B站搜索接口";
      this.refs.progressTrack.hidden = false;
      this.refs.progressBar.style.width = `${Math.round(Math.min(1, completed / Math.max(1, total)) * 100)}%`;
      this.refs.cancel.hidden = false;
      this.refs.warning.hidden = true;
      this.refs.grid.replaceChildren();
      this.refs.stateView.replaceChildren();
      this.refs.pagination.hidden = true;
      const bucket = Math.floor(Math.min(1, completed / Math.max(1, total)) * 4);
      if (bucket > this.lastProgressBucket) {
        this.lastProgressBucket = bucket;
        this.refs.liveStatus.textContent = `精准搜索进度 ${Math.round(bucket * 25)}%`;
      }
    }
    setResults(result, pool) {
      this.result = result;
      this.pool = pool;
      this.page = 1;
      this.lastError = null;
      this.lastProgressBucket = -1;
      this.refs.panel.setAttribute("aria-busy", "false");
      this.refs.cancel.hidden = true;
      this.refs.progressTrack.hidden = true;
      this.refs.statusTitle.textContent = `保留 ${result.ranked.length} 条精准结果`;
      this.refs.statusDetail.textContent = `接口返回 ${pool.rawCount} 条 · 有效 ${pool.validCount} 条 · 去重 ${pool.uniqueCount} 条 · 门槛过滤 ${result.rejected.length} 条`;
      this.refs.liveStatus.textContent = `精准搜索完成，保留 ${result.ranked.length} 条结果`;
      if (pool.errors.length) {
        this.refs.warning.hidden = false;
        this.refs.warning.textContent = `${pool.errors.length} 路候选请求未完成；已用其余成功结果排序。`;
      } else {
        this.refs.warning.hidden = true;
      }
      this.renderCurrentPage();
    }
    setError(error) {
      this.result = null;
      this.pool = null;
      this.lastError = error;
      this.lastProgressBucket = -1;
      this.refs.panel.setAttribute("aria-busy", "false");
      this.refs.cancel.hidden = true;
      this.refs.progressTrack.hidden = true;
      this.refs.statusTitle.textContent = "精准搜索未完成";
      this.refs.statusDetail.textContent = error?.kind === "risk" ? "已停止继续请求，避免加重访问验证。" : "可以稍后重试，原生搜索不受影响。";
      this.refs.liveStatus.textContent = `精准搜索失败：${error?.message || "未知错误"}`;
      this.refs.warning.hidden = true;
      this.refs.grid.replaceChildren();
      this.refs.pagination.hidden = true;
      this.refs.stateView.replaceChildren(this.buildState("error", "搜索失败", error?.message || "发生未知错误", true));
    }
    setCancelled() {
      this.lastProgressBucket = -1;
      this.refs.panel.setAttribute("aria-busy", "false");
      this.refs.cancel.hidden = true;
      this.refs.progressTrack.hidden = true;
      this.refs.statusTitle.textContent = "已取消本次精准搜索";
      this.refs.statusDetail.textContent = "原生页面仍保持原样，可修改关键词后重试。";
      this.refs.liveStatus.textContent = "已取消精准搜索";
    }
    buildState(kind, title, message, retry = false) {
      const wrapper = element(this.document, "div", kind);
      const icon = element(this.document, "div", "empty-icon", kind === "error" ? "⚠️" : "🎯");
      icon.setAttribute("aria-hidden", "true");
      wrapper.append(icon, element(this.document, "h3", "", title), element(this.document, "p", "", message));
      if (retry) {
        const button = element(this.document, "button", "retry-button", "重试");
        button.type = "button";
        button.addEventListener("click", () => this.handlers.onRetry?.());
        wrapper.append(button);
      }
      return wrapper;
    }
    renderCurrentPage() {
      this.refs.grid.replaceChildren();
      this.refs.stateView.replaceChildren();
      if (!this.result?.ranked.length) {
        const profile = MODE_PROFILES[this.mode];
        this.refs.stateView.append(this.buildState(
          "empty",
          "没有结果通过相关性硬门槛",
          `当前为${profile.label}模式（相关性至少 ${Math.round(profile.threshold * 100)} 分、覆盖至少 ${Math.round(profile.minCoverage * 100)}%）。可核对关键词，或切换到探索模式。`
        ));
        this.refs.pagination.hidden = true;
        return;
      }
      const totalPages = Math.ceil(this.result.ranked.length / RESULTS_PER_PAGE);
      this.page = Math.min(totalPages, Math.max(1, this.page));
      const start = (this.page - 1) * RESULTS_PER_PAGE;
      for (const item of this.result.ranked.slice(start, start + RESULTS_PER_PAGE)) {
        this.refs.grid.append(this.buildCard(item));
      }
      this.renderPagination(totalPages);
    }
    buildCard(item) {
      const { video, relevance, quality } = item;
      const card = element(this.document, "article", "card");
      const coverLink = externalLink(this.document, "cover-link", "", video.url);
      const image = element(this.document, "img", "cover");
      setSafeImage(image, video.coverUrl, video.title);
      coverLink.append(image);
      if (video.durationText) coverLink.append(element(this.document, "span", "duration", video.durationText));
      const sourceLabels = [...new Set(video.sources.map((source) => source.orderLabel))];
      coverLink.append(element(this.document, "span", "source-badge", `${sourceLabels.length} 路召回`));
      const body = element(this.document, "div", "card-body");
      body.append(externalLink(this.document, "card-title", video.title || video.bvid, video.url));
      const meta = element(this.document, "div", "meta");
      meta.append(
        element(this.document, "span", "", `UP：${video.author.name || "未知"}`),
        element(this.document, "span", "", video.category || "未分区"),
        element(this.document, "span", "", formatDate(video.publishedAt))
      );
      body.append(meta);
      const metrics = element(this.document, "div", "metrics");
      metrics.append(
        element(this.document, "span", "", `播放 ${formatCount(video.stats.views)}`),
        element(this.document, "span", "", `点赞 ${formatCount(video.stats.likes)}`),
        element(this.document, "span", "", `收藏 ${formatCount(video.stats.favorites)}`),
        element(this.document, "span", "", `评论 ${formatCount(video.stats.replies)}`)
      );
      body.append(metrics);
      const scores = element(this.document, "div", "scores");
      scores.append(
        element(this.document, "span", "score score-relevance", `相关 ${Math.round(relevance.value * 100)}`),
        element(this.document, "span", "score score-quality", `质量 ${Math.round(quality.value * 100)}`)
      );
      body.append(scores);
      const primaryReason = relevance.positiveReasons[0] ?? quality.positiveReasons[0] ?? "通过相关性硬门槛";
      body.append(element(this.document, "p", "reason-primary", primaryReason));
      const chips = element(this.document, "div", "match-list");
      for (const match of relevance.matchedTerms.slice(0, 6)) {
        const suffix = match.fuzzy ? "≈" : "→";
        chips.append(element(this.document, "span", "match-chip", `${match.term}${suffix}${match.fields.join("/")}`));
      }
      if (chips.childElementCount) body.append(chips);
      const details = element(this.document, "details", "explanations");
      details.append(element(this.document, "summary", "", "查看匹配与质量说明"));
      const list = element(this.document, "ul");
      const reasons = [
        ...relevance.positiveReasons,
        ...relevance.negativeReasons,
        ...quality.positiveReasons,
        ...quality.negativeReasons,
        `候选来源：${sourceLabels.join("、")}`
      ];
      for (const reason of [...new Set(reasons)].slice(0, 8)) list.append(element(this.document, "li", "", reason));
      details.append(list);
      body.append(details);
      card.append(coverLink, body);
      return card;
    }
    renderPagination(totalPages) {
      this.refs.pagination.replaceChildren();
      if (totalPages <= 1) {
        this.refs.pagination.hidden = true;
        return;
      }
      this.refs.pagination.hidden = false;
      const addButton = (label, page, { current = false, disabled = false } = {}) => {
        const button = element(this.document, "button", "page-button", label);
        button.type = "button";
        button.disabled = disabled;
        if (current) button.setAttribute("aria-current", "page");
        button.addEventListener("click", () => this.goToPage(page));
        this.refs.pagination.append(button);
      };
      addButton("上一页", this.page - 1, { disabled: this.page <= 1 });
      const candidates = /* @__PURE__ */ new Set([1, totalPages, this.page - 2, this.page - 1, this.page, this.page + 1, this.page + 2]);
      const pages = [...candidates].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
      let previous = 0;
      for (const page of pages) {
        if (previous && page - previous > 1) this.refs.pagination.append(element(this.document, "span", "", "…"));
        addButton(String(page), page, { current: page === this.page });
        previous = page;
      }
      addButton("下一页", this.page + 1, { disabled: this.page >= totalPages });
    }
    goToPage(page) {
      this.page = page;
      this.renderCurrentPage();
      if (typeof this.refs.panelShell.scrollTo === "function") {
        this.refs.panelShell.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        this.refs.panelShell.scrollTop = 0;
      }
    }
    findNativeTabAnchor() {
      let winner = null;
      let winnerScore = 0;
      for (const nav of this.document.querySelectorAll("nav")) {
        const semanticScore = scoreNativeTabAnchor(nav);
        const visibleBonus = nav.getBoundingClientRect().width > 0 ? 0.2 : 0;
        const quickBonus = nav.closest(".search-tabs") ? 0.1 : 0;
        const score = semanticScore + visibleBonus + quickBonus;
        if (semanticScore >= 4 && score > winnerScore) {
          winner = nav;
          winnerScore = score;
        }
      }
      return winner;
    }
    positionToNativeTabs() {
      if (!this.refs) return;
      const nextAnchor = this.findNativeTabAnchor();
      if (nextAnchor !== this.anchor) {
        this.resizeObserver?.disconnect();
        this.anchor = nextAnchor;
        if (this.anchor && typeof this.window.ResizeObserver !== "undefined") {
          this.resizeObserver = new this.window.ResizeObserver(() => this.schedulePosition());
          this.resizeObserver.observe(this.anchor);
        }
      }
      const viewportWidth = this.window.innerWidth || this.document.documentElement.clientWidth || 1280;
      if (!this.anchor) {
        this.refs.launcher.dataset.floating = "true";
        this.refs.panel.style.top = "132px";
        return;
      }
      const anchorRect = this.anchor.getBoundingClientRect();
      const tabNodes = [...this.anchor.querySelectorAll("li, button, a, [role='tab']")].filter((node) => node.getBoundingClientRect().width > 0);
      const lastRect = tabNodes.at(-1)?.getBoundingClientRect() ?? anchorRect;
      const launcherWidth = this.refs.launcher.getBoundingClientRect().width || 120;
      let left = lastRect.right + 12;
      let top = Math.max(6, lastRect.top + (lastRect.height - 40) / 2);
      const floating = left + launcherWidth > viewportWidth - 12;
      this.refs.launcher.dataset.floating = String(floating);
      if (floating) {
        this.refs.launcher.style.left = "auto";
        this.refs.launcher.style.right = "16px";
        this.refs.launcher.style.top = "auto";
      } else {
        this.refs.launcher.style.left = `${Math.round(left)}px`;
        this.refs.launcher.style.right = "auto";
        this.refs.launcher.style.top = `${Math.round(top)}px`;
      }
      this.refs.panel.style.top = `${Math.max(62, Math.round(anchorRect.bottom + 8))}px`;
    }
    schedulePosition() {
      if (this.repositionFrame !== null) return;
      const requestFrame = this.window.requestAnimationFrame?.bind(this.window) ?? ((callback) => this.window.setTimeout(callback, 0));
      this.repositionFrame = requestFrame(() => {
        this.repositionFrame = null;
        this.positionToNativeTabs();
      });
    }
  };

  // src/main.js
  var LOCATION_EVENT = "bps:locationchange";
  var ALLOWED_PATHS = /* @__PURE__ */ new Set(["/all", "/all/", "/video", "/video/"]);
  function currentContext(locationRef = location) {
    const url = new URL(locationRef.href);
    return {
      url,
      path: url.pathname,
      keyword: (url.searchParams.get("keyword") ?? "").trim(),
      signature: `${url.pathname}
${(url.searchParams.get("keyword") ?? "").trim()}`,
      available: ALLOWED_PATHS.has(url.pathname)
    };
  }
  function safeStorageGet(storage, key, fallback) {
    try {
      return storage?.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }
  function safeStorageSet(storage, key, value) {
    try {
      storage?.setItem(key, value);
    } catch {
    }
  }
  function installLocationWatcher(windowRef = window) {
    const marker = Symbol.for("bilibili-precision-search:location-watcher");
    if (windowRef[marker]) return windowRef[marker];
    let lastHref = windowRef.location.href;
    let queued = false;
    let stopped = false;
    const historyPatches = [];
    const eventListeners = [];
    const notify = (source) => {
      if (queued || stopped) return;
      queued = true;
      (windowRef.queueMicrotask ?? queueMicrotask)(() => {
        queued = false;
        if (stopped) return;
        const href = windowRef.location.href;
        if (href === lastHref && source === "poll") return;
        lastHref = href;
        windowRef.dispatchEvent(new windowRef.CustomEvent(LOCATION_EVENT, { detail: { source } }));
      });
    };
    for (const name of ["pushState", "replaceState"]) {
      const original = windowRef.history[name];
      try {
        const patched = function patchedHistory(...args) {
          const before = windowRef.location.href;
          const result = Reflect.apply(original, this, args);
          if (windowRef.location.href !== before) notify(name);
          return result;
        };
        windowRef.history[name] = patched;
        if (windowRef.history[name] === patched) historyPatches.push({ name, original, patched });
      } catch {
      }
    }
    for (const eventName of ["popstate", "hashchange", "pageshow"]) {
      const listener = () => notify(eventName);
      eventListeners.push({ eventName, listener });
      windowRef.addEventListener(eventName, listener);
    }
    const interval = windowRef.setInterval(() => {
      if (windowRef.location.href !== lastHref) notify("poll");
    }, 1e3);
    const controller = {
      notify,
      stop: () => {
        if (stopped) return;
        stopped = true;
        windowRef.clearInterval(interval);
        for (const { eventName, listener } of eventListeners) windowRef.removeEventListener(eventName, listener);
        for (const { name, original, patched } of historyPatches) {
          if (windowRef.history[name] === patched) windowRef.history[name] = original;
        }
        try {
          if (windowRef[marker] === controller) delete windowRef[marker];
        } catch {
        }
      }
    };
    try {
      windowRef[marker] = controller;
    } catch {
    }
    return controller;
  }
  var NativePageGuard = class {
    constructor(documentRef) {
      this.document = documentRef;
      this.window = documentRef.defaultView ?? globalThis;
      this.saved = /* @__PURE__ */ new Map();
    }
    activate() {
      const candidates = [...this.document.querySelectorAll(".search-conditions, .search-filter-wrap, .search-content")];
      const targets = candidates.filter((target) => !candidates.some((other) => other !== target && other.contains(target)));
      for (const target of targets) {
        if (target.closest("#bps-host") || this.saved.has(target)) continue;
        const fallbackFocusables = !("inert" in this.window.HTMLElement.prototype) ? [...target.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].map((node) => ({
          node,
          tabindex: node.getAttribute("tabindex")
        })) : [];
        this.saved.set(target, {
          inert: Boolean(target.inert),
          inertAttribute: target.hasAttribute("inert"),
          inertAttributeValue: target.getAttribute("inert"),
          ariaHidden: target.getAttribute("aria-hidden"),
          fallbackFocusables
        });
        target.inert = true;
        target.setAttribute("inert", "");
        target.setAttribute("aria-hidden", "true");
        for (const { node } of fallbackFocusables) node.setAttribute("tabindex", "-1");
      }
    }
    restore() {
      for (const [target, state] of this.saved) {
        if (!target.isConnected) continue;
        target.inert = state.inert;
        if (state.inertAttribute) target.setAttribute("inert", state.inertAttributeValue ?? "");
        else target.removeAttribute("inert");
        if (state.ariaHidden === null) target.removeAttribute("aria-hidden");
        else target.setAttribute("aria-hidden", state.ariaHidden);
        for (const { node, tabindex } of state.fallbackFocusables) {
          if (!node.isConnected) continue;
          if (tabindex === null) node.removeAttribute("tabindex");
          else node.setAttribute("tabindex", tabindex);
        }
      }
      this.saved.clear();
    }
  };
  var PrecisionSearchApp = class {
    constructor({ documentRef = document, windowRef = window, adapter = new BilibiliSearchApiAdapter() } = {}) {
      this.document = documentRef;
      this.window = windowRef;
      this.adapter = adapter;
      const storedMode = safeStorageGet(windowRef.localStorage, STORAGE_MODE_KEY, DEFAULT_MODE);
      this.mode = MODE_PROFILES[storedMode] ? storedMode : DEFAULT_MODE;
      this.view = null;
      this.guard = new NativePageGuard(documentRef);
      this.controller = null;
      this.generation = 0;
      this.context = currentContext(windowRef.location);
      this.cache = /* @__PURE__ */ new Map();
      this.mutationObserver = null;
      this.nativeSyncFrame = null;
    }
    start() {
      if (this.view) return;
      this.view = new PrecisionSearchView({
        documentRef: this.document,
        handlers: {
          onToggle: () => this.toggle(),
          onClose: () => this.close(),
          onCancel: () => this.cancel(),
          onSearch: (query) => this.search(query),
          onRetry: () => this.search(this.view.refs.input.value),
          onModeChange: (mode) => this.changeMode(mode)
        }
      }).mount();
      this.view.setMode(this.mode);
      this.view.setQuery(this.context.keyword);
      this.view.setAvailable(this.context.available);
      this.window.addEventListener(LOCATION_EVENT, () => this.syncContext());
      this.document.addEventListener("click", (event) => this.handleNativeTabClick(event), true);
      this.mutationObserver = new this.window.MutationObserver(() => this.scheduleNativeSync());
      this.mutationObserver.observe(this.document.body, { childList: true, subtree: true });
    }
    scheduleNativeSync() {
      if (this.nativeSyncFrame !== null) return;
      const requestFrame = this.window.requestAnimationFrame?.bind(this.window) ?? ((callback) => this.window.setTimeout(callback, 0));
      this.nativeSyncFrame = requestFrame(() => {
        this.nativeSyncFrame = null;
        this.view.schedulePosition();
        if (this.view.isOpen()) this.guard.activate();
      });
    }
    resolveVisibleKeyword() {
      const input = this.document.querySelector(".search-input-el, input[type='search']");
      const inputValue = input && typeof input.value === "string" ? input.value.trim() : "";
      return inputValue || this.context.keyword;
    }
    toggle() {
      if (this.view.isOpen()) {
        this.close();
        return;
      }
      const query = this.resolveVisibleKeyword();
      this.view.setQuery(query);
      this.view.showPanel();
      this.guard.activate();
      if (query) this.search(query);
      else this.view.setError(new Error("请先输入要搜索的关键词"));
    }
    close({ restoreFocus = true } = {}) {
      this.cancel({ silent: true });
      this.guard.restore();
      this.view.hidePanel({ restoreFocus });
    }
    cancel({ silent = false } = {}) {
      this.generation += 1;
      this.controller?.abort();
      this.controller = null;
      if (!silent && this.view.isOpen()) this.view.setCancelled();
    }
    changeMode(mode) {
      if (!MODE_PROFILES[mode] || mode === this.mode) return;
      this.mode = mode;
      safeStorageSet(this.window.localStorage, STORAGE_MODE_KEY, mode);
      this.view.setMode(mode);
      if (this.view.isOpen()) this.search(this.view.refs.input.value);
    }
    async search(rawQuery) {
      const query = String(rawQuery ?? "").trim();
      this.view.setQuery(query);
      this.view.showPanel({ focus: false });
      this.guard.activate();
      this.cancel({ silent: true });
      const generation = this.generation;
      const parsedQuery = parseQuery(query);
      if (!query || !parsedQuery.terms.length) {
        this.view.setError(new Error("请输入至少一个正向关键词"));
        return;
      }
      const cacheKey = `${this.mode}
${query}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
        this.view.setResults(cached.result, cached.pool);
        return;
      }
      this.controller = new AbortController();
      const signal = this.controller.signal;
      const profile = getModeProfile(this.mode);
      this.view.setLoading({ total: profile.orders.length * profile.pagesPerOrder });
      try {
        const pool = await this.adapter.collectCandidates(parsedQuery.normalized, profile, {
          signal,
          onProgress: (progress) => {
            if (generation !== this.generation) return;
            this.view.setLoading(progress);
          }
        });
        if (generation !== this.generation) return;
        const result = rerankCandidates(pool.videos, query, this.mode);
        for (const [key, entry] of this.cache) {
          if (Date.now() - entry.createdAt >= CACHE_TTL_MS) this.cache.delete(key);
        }
        while (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(cacheKey, { createdAt: Date.now(), result, pool });
        this.view.setResults(result, pool);
      } catch (error) {
        if (generation !== this.generation || error?.name === "AbortError") return;
        this.view.setError(error);
      } finally {
        if (generation === this.generation) this.controller = null;
      }
    }
    syncContext() {
      const next = currentContext(this.window.location);
      if (next.signature === this.context.signature && next.available === this.context.available) {
        this.context = next;
        this.view.schedulePosition();
        return;
      }
      const keywordChanged = next.keyword !== this.context.keyword || next.path !== this.context.path;
      this.context = next;
      this.view.setAvailable(next.available);
      this.view.setQuery(next.keyword);
      if (!next.available) {
        this.close({ restoreFocus: false });
        return;
      }
      this.view.schedulePosition();
      if (keywordChanged && this.view.isOpen()) this.search(next.keyword);
    }
    handleNativeTabClick(event) {
      if (!this.view?.isOpen()) return;
      if (event.composedPath?.().includes(this.view.host)) return;
      const target = event.target instanceof this.window.Element ? event.target : null;
      if (!target || target.closest("#bps-host")) return;
      const candidate = target.closest("li, button, a, [role='tab']");
      const anchor = this.view.findNativeTabAnchor();
      if (!candidate || !anchor?.contains(candidate)) return;
      const label = normalizeNativeTabLabel(candidate.textContent);
      if (NATIVE_TAB_LABELS.has(label)) {
        this.close({ restoreFocus: false });
      }
    }
  };
  function boot() {
    if (window.top !== window.self || document.getElementById("bps-host")) return;
    const app = new PrecisionSearchApp();
    app.start();
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    installLocationWatcher(window);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }
})();
