import { md5 } from "./md5.js";
import { stripHtml } from "./text.js";

export const SEARCH_ENDPOINTS = Object.freeze({
  wbi: "https://api.bilibili.com/x/web-interface/wbi/search/type",
  legacy: "https://api.bilibili.com/x/web-interface/search/type",
  nav: "https://api.bilibili.com/x/web-interface/nav",
});

// Keep all non-search endpoints here so future Bilibili API changes remain
// isolated from scoring and UI code.
export const DATA_ENDPOINTS = Object.freeze({
  detail: "https://api.bilibili.com/x/web-interface/view",
  statFallback: "https://api.bilibili.com/x/web-interface/archive/stat",
  pageList: "https://api.bilibili.com/x/player/pagelist",
  online: "https://api.bilibili.com/x/player/online/total",
});

const MIXIN_KEY_ENCODE_TABLE = Object.freeze([
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]);

const ORDER_LABELS = Object.freeze({
  totalrank: "综合",
  click: "播放",
  pubdate: "最新",
  stow: "收藏",
  dm: "弹幕",
});

const RISK_CODES = new Set([-352, -412, -429, 412, 429]);

const STAT_FIELD_MAP = Object.freeze({
  views: "view",
  likes: "like",
  favorites: "favorite",
  replies: "reply",
  danmaku: "danmaku",
  coins: "coin",
  shares: "share",
});

export class BilibiliApiError extends Error {
  constructor(message, { code = null, status = null, kind = "api", cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "BilibiliApiError";
    this.code = code;
    this.status = status;
    this.kind = kind;
  }
}

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
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function searchInteraction(value) {
  const parsed = safeNumber(value);
  // The search endpoint commonly sends literal zero placeholders for these
  // fields even when the detail endpoint has non-zero authoritative values.
  return parsed === 0 ? null : parsed;
}

function httpsUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.startsWith("//")
    ? `https:${raw}`
    : raw.startsWith("http://")
      ? `https://${raw.slice(7)}`
      : raw;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function parseDuration(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const parts = String(value ?? "").trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

function durationLabel(value, seconds) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Number.isFinite(seconds)) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function normalizeTags(raw) {
  const values = Array.isArray(raw.tags)
    ? raw.tags
    : String(raw.tag ?? "").split(/[,，]/);
  return [...new Set(values.map((value) => stripHtml(value).trim()).filter(Boolean))];
}

export function normalizeVideo(raw, source = {}) {
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
    publishedAt: publishedSeconds === null ? null : publishedSeconds * 1000,
    author: {
      name: stripHtml(raw.author ?? raw.uname).trim(),
      mid: safeNumber(raw.mid ?? raw.uid),
      avatarUrl: httpsUrl(raw.upic ?? raw.uface),
    },
    stats: {
      views: safeNumber(raw.play),
      likes: searchInteraction(raw.like),
      favorites: searchInteraction(raw.favorites),
      replies: safeNumber(raw.review),
      danmaku: safeNumber(raw.danmaku ?? raw.video_review),
      coins: searchInteraction(raw.coin),
      shares: searchInteraction(raw.share),
    },
    sources: [{
      order: source.order ?? "unknown",
      orderLabel: ORDER_LABELS[source.order] ?? source.order ?? "未知",
      page: source.page ?? 1,
      position: source.position ?? null,
    }],
  };
}

function normalizeStats(raw) {
  const stats = {};
  for (const [target, source] of Object.entries(STAT_FIELD_MAP)) {
    stats[target] = safeNumber(raw?.[source]);
  }
  return stats;
}

export function normalizePageList(rawPages) {
  if (!Array.isArray(rawPages)) return [];
  return rawPages.map((raw, index) => {
    const cid = safeNumber(raw?.cid);
    if (cid === null) return null;
    return {
      cid,
      page: safeNumber(raw?.page, index + 1),
      part: stripHtml(raw?.part ?? raw?.title).replace(/\s+/g, " ").trim(),
      durationSeconds: safeNumber(raw?.duration),
      dimension: raw?.dimension && typeof raw.dimension === "object"
        ? {
            width: safeNumber(raw.dimension.width),
            height: safeNumber(raw.dimension.height),
            rotate: safeNumber(raw.dimension.rotate, 0),
          }
        : null,
    };
  }).filter(Boolean);
}

export function normalizeVideoDetail(raw, fallbackBvid = "", source = "detail") {
  if (!raw || typeof raw !== "object") return null;
  const bvid = String(raw.bvid ?? fallbackBvid).trim();
  if (!bvid) return null;
  const durationSeconds = safeNumber(raw.duration);
  const publishedSeconds = safeNumber(raw.pubdate);
  const pages = normalizePageList(raw.pages);
  return {
    bvid,
    aid: safeNumber(raw.aid),
    title: stripHtml(raw.title).replace(/\s+/g, " ").trim(),
    description: stripHtml(raw.desc ?? raw.description).replace(/\s+/g, " ").trim(),
    coverUrl: httpsUrl(raw.pic ?? raw.cover),
    durationSeconds,
    durationText: durationLabel(null, durationSeconds),
    publishedAt: publishedSeconds === null ? null : publishedSeconds * 1000,
    author: {
      name: stripHtml(raw.owner?.name ?? raw.author).trim(),
      mid: safeNumber(raw.owner?.mid ?? raw.mid),
      avatarUrl: httpsUrl(raw.owner?.face ?? raw.face),
    },
    stats: normalizeStats(raw.stat ?? raw),
    pages,
    pageCount: safeNumber(raw.videos, pages.length || null),
    source,
    partial: source !== "detail",
  };
}

/**
 * Parse the deliberately rounded values returned by /online/total.
 * `value` is the lower-bound approximation for strings such as "1.7万+".
 */
export function parseOnlineCount(input) {
  if (input === null || input === undefined) return { value: null, approximate: false, raw: "" };
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0
      ? { value: Math.round(input), approximate: false, raw: String(input) }
      : { value: null, approximate: false, raw: String(input) };
  }
  const raw = String(input).trim();
  const match = raw.replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*([万亿]?)\s*(\+)?$/);
  if (!match) return { value: null, approximate: false, raw };
  const multiplier = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : 1;
  const value = Number(match[1]) * multiplier;
  return {
    value: Number.isFinite(value) ? Math.round(value) : null,
    approximate: Boolean(match[2] || match[3]),
    raw,
  };
}

function switchEnabled(showSwitch, key) {
  const value = showSwitch?.[key];
  if (value === undefined || value === null) return true;
  return value === true || value === 1 || value === "1";
}

export function normalizeOnlineStats(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;
  const totalVisible = switchEnabled(raw.show_switch, "total");
  const webVisible = switchEnabled(raw.show_switch, "count");
  const total = parseOnlineCount(raw.total);
  const web = parseOnlineCount(raw.count);
  return {
    bvid: context.bvid ?? "",
    cid: safeNumber(context.cid),
    // Bilibili requires a cid, so online counts always describe the selected
    // page/part. Automatic selection uses page 1 and never claims to aggregate
    // all parts of a multi-P video.
    scope: "page",
    selection: context.selection ?? "explicit",
    page: safeNumber(context.page),
    part: String(context.part ?? ""),
    multiPart: Boolean(context.multiPart),
    total: totalVisible ? total.value : null,
    web: webVisible ? web.value : null,
    totalApproximate: totalVisible && total.approximate,
    webApproximate: webVisible && web.approximate,
    raw: { total: total.raw, web: web.raw },
    visible: { total: totalVisible, web: webVisible },
  };
}

function pickLonger(left, right) {
  const first = String(left ?? "");
  const second = String(right ?? "");
  return second.length > first.length ? right : left;
}

export function mergeVideo(existing, incoming) {
  if (!existing) return incoming;
  existing.title = pickLonger(existing.title, incoming.title);
  existing.description = pickLonger(existing.description, incoming.description);
  existing.tags = [...new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])];
  existing.category ||= incoming.category;
  existing.coverUrl ||= incoming.coverUrl;
  existing.durationSeconds ??= incoming.durationSeconds;
  existing.durationText ||= incoming.durationText;
  existing.publishedAt ??= incoming.publishedAt;
  existing.author.name ||= incoming.author.name;
  existing.author.mid ??= incoming.author.mid;
  existing.author.avatarUrl ||= incoming.author.avatarUrl;
  for (const [key, value] of Object.entries(incoming.stats)) {
    if (value === null || value === undefined) continue;
    existing.stats[key] = existing.stats[key] === null || existing.stats[key] === undefined
      ? value
      : Math.max(existing.stats[key], value);
  }
  const sourceKeys = new Set(existing.sources.map((source) => `${source.order}:${source.page}:${source.position}`));
  for (const source of incoming.sources) {
    const key = `${source.order}:${source.page}:${source.position}`;
    if (!sourceKeys.has(key)) existing.sources.push(source);
  }
  return existing;
}

export function deduplicateVideos(videos) {
  const byKey = new Map();
  for (const video of videos) {
    if (!video?.key) continue;
    byKey.set(video.key, mergeVideo(byKey.get(video.key), video));
  }
  return [...byKey.values()];
}

export function extractWbiKeys(payload) {
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

export function canonicalQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(cleanWbiValue(value))}`)
    .join("&");
}

export function plainQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  return search.toString();
}

export function signWbiParams(params, mixinKey, timestamp = Math.floor(Date.now() / 1000)) {
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

function gmRequest(url, { signal, timeout = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    ensureNotAborted(signal);
    let settled = false;
    let request;
    let timeoutId;
    const onAbort = () => {
      try { request?.abort?.(); } catch { /* noop */ }
      finish(reject, abortError());
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    // Tampermonkey's anonymous/fetch mode may ignore details.timeout in
    // Chromium, so enforce a userscript-side deadline as well.
    timeoutId = setTimeout(() => {
      finish(reject, new BilibiliApiError("B站搜索接口请求超时", { kind: "timeout" }));
      try { request?.abort?.(); } catch { /* noop */ }
    }, timeout);
    request = GM_xmlhttpRequest({
      method: "GET",
      url,
      anonymous: true,
      timeout,
      responseType: "json",
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://search.bilibili.com/",
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
      onabort: () => finish(reject, abortError()),
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchRequest(url, { signal, timeout = 20_000 } = {}) {
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
      signal: controller.signal,
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

export function createDefaultRequest() {
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
  const message = kind === "risk"
    ? "B站触发了访问验证，请稍后再试"
    : `B站搜索接口返回错误：${payload?.message || code}`;
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
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
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

function normalizedBvid(value) {
  const bvid = String(value ?? "").trim();
  if (!/^BV[0-9A-Za-z]{8,24}$/.test(bvid)) {
    throw new BilibiliApiError("无效的 BV 号", { kind: "input" });
  }
  return bvid;
}

function isStructuralEndpointError(error) {
  return error instanceof BilibiliApiError &&
    ((error.kind === "http" && [404, 405].includes(error.status)) || error.code === -404);
}

function cloneVideoForEnrichment(video) {
  return {
    ...video,
    author: { ...(video.author ?? {}) },
    stats: { ...(video.stats ?? {}) },
    tags: [...(video.tags ?? [])],
    sources: [...(video.sources ?? [])],
    enrichment: { ...(video.enrichment ?? {}) },
  };
}

function mergeDetailIntoVideo(video, detail) {
  const merged = cloneVideoForEnrichment(video);
  if (!detail) {
    merged.enrichment.detail = "unavailable";
    return merged;
  }
  merged.aid ??= detail.aid;
  merged.title ||= detail.title;
  merged.description ||= detail.description;
  merged.coverUrl ||= detail.coverUrl;
  merged.durationSeconds ??= detail.durationSeconds;
  merged.durationText ||= detail.durationText;
  merged.publishedAt ??= detail.publishedAt;
  merged.author.name ||= detail.author?.name;
  merged.author.mid ??= detail.author?.mid;
  merged.author.avatarUrl ||= detail.author?.avatarUrl;
  for (const [key, value] of Object.entries(detail.stats ?? {})) {
    // Detail endpoints are authoritative even when the real value is zero.
    if (value !== null && value !== undefined) merged.stats[key] = value;
  }
  merged.pages = [...(detail.pages ?? [])];
  merged.enrichment = {
    ...merged.enrichment,
    detail: detail.partial ? "partial" : "complete",
    detailSource: detail.source,
    pageCount: detail.pageCount,
  };
  return merged;
}

async function runPool(items, worker, { signal, concurrency = 2, onProgress } = {}) {
  ensureNotAborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const results = new Map();
  const errors = [];
  let cursor = 0;
  let completed = 0;
  let fatalError = null;

  const run = async () => {
    while (!controller.signal.aborted && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      try {
        const value = await worker(item, controller.signal, index);
        results.set(item, value);
      } catch (error) {
        if (error?.kind === "risk" || error?.kind === "signature") {
          fatalError ??= error;
          controller.abort();
          break;
        }
        if (error?.name === "AbortError") {
          if (signal?.aborted) break;
          if (controller.signal.aborted) break;
        } else {
          errors.push({ item, message: error?.message ?? String(error), kind: error?.kind ?? "unknown" });
        }
      } finally {
        completed += 1;
        onProgress?.({ completed, total: items.length, item });
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => run()));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (fatalError) throw fatalError;
  if (signal?.aborted) throw abortError();
  return { results, errors, completed };
}

export class BilibiliSearchApiAdapter {
  constructor({
    request = createDefaultRequest(),
    now = () => Date.now(),
    random = Math.random,
    detailTtl = 30 * 60 * 1000,
    pageTtl = 30 * 60 * 1000,
    onlineTtl = 45 * 1000,
    enrichmentDelayMs = 80,
  } = {}) {
    this.request = request;
    this.now = now;
    this.random = random;
    this.detailTtl = detailTtl;
    this.pageTtl = pageTtl;
    this.onlineTtl = onlineTtl;
    this.enrichmentDelayMs = enrichmentDelayMs;
    this.wbiCache = null;
    this.wbiPending = null;
    this.detailCache = new Map();
    this.detailPending = new Map();
    this.pageCache = new Map();
    this.pagePending = new Map();
    this.onlineCache = new Map();
    this.onlinePending = new Map();
  }

  async readThrough(cache, pending, key, ttl, loader, { signal, force = false } = {}) {
    ensureNotAborted(signal);
    const cached = cache.get(key);
    if (!force && cached && cached.expiresAt > this.now()) return cached.value;
    if (force) cache.delete(key);

    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, waiters: 0, settled: false, promise: null };
      entry.promise = Promise.resolve()
        .then(() => loader(controller.signal))
        .then((value) => {
          cache.set(key, { value, expiresAt: this.now() + ttl });
          return value;
        })
        .finally(() => {
          entry.settled = true;
          if (pending.get(key) === entry) pending.delete(key);
        });
      pending.set(key, entry);
    }

    entry.waiters += 1;
    try {
      return await waitForSharedPromise(entry.promise, signal);
    } finally {
      entry.waiters -= 1;
      if (!entry.settled && entry.waiters === 0) entry.controller.abort();
    }
  }

  clearEnrichmentCache() {
    this.detailCache.clear();
    this.pageCache.clear();
    this.onlineCache.clear();
  }

  async getWbiKeys(signal) {
    if (this.wbiCache && this.wbiCache.expiresAt > this.now()) return this.wbiCache.keys;
    if (!this.wbiPending) {
      this.wbiPending = (async () => {
        // WBI keys are shared across searches, so this tiny cached request is not
        // tied to one search's AbortSignal. A cancelled search cannot poison the
        // next search by cancelling the shared pending promise.
        const payload = await this.request(SEARCH_ENDPOINTS.nav, {});
        const code = Number(payload?.code);
        if (payload?.data?.v_voucher || RISK_CODES.has(code)) {
          throw new BilibiliApiError("B站触发了访问验证，请稍后再试", { code, kind: "risk" });
        }
        const keys = extractWbiKeys(payload);
        if (!keys) throw new BilibiliApiError("暂时无法取得 B站 WBI 签名参数", { kind: "signature" });
        this.wbiCache = { keys, expiresAt: this.now() + 6 * 60 * 60 * 1000 };
        return keys;
      })().finally(() => { this.wbiPending = null; });
    }
    const keys = await waitForSharedPromise(this.wbiPending, signal);
    ensureNotAborted(signal);
    return keys;
  }

  async buildWbiUrl(params, signal) {
    try {
      const keys = await this.getWbiKeys(signal);
      return `${SEARCH_ENDPOINTS.wbi}?${signWbiParams(params, keys.mixinKey, Math.floor(this.now() / 1000))}`;
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
      qv_id: qvId,
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
              cause: retryError,
            });
          }
          throw retryError;
        }
      } else {
        const mayUseLegacy = error instanceof BilibiliApiError &&
          ((error.kind === "http" && [404, 405].includes(error.status)) || error.code === -404);
        if (!mayUseLegacy) throw error;
        payload = validatePayload(await this.request(`${SEARCH_ENDPOINTS.legacy}?${plainQuery(params)}`, { signal }));
      }
    }
    const rows = Array.isArray(payload?.data?.result)
      ? payload.data.result
      : Array.isArray(payload?.data?.result?.video)
        ? payload.data.result.video
        : [];
    const videos = rows.map((raw, index) => normalizeVideo(raw, {
      order,
      page,
      position: index + 1,
    })).filter(Boolean);
    return {
      videos,
      rawCount: rows.length,
      ignoredCount: rows.length - videos.length,
      page: safeNumber(payload?.data?.page, page),
      numPages: safeNumber(payload?.data?.numPages),
      numResults: safeNumber(payload?.data?.numResults),
      hasNext: payload?.data?.next !== 0 && (safeNumber(payload?.data?.numPages) === null || page < safeNumber(payload?.data?.numPages)),
    };
  }

  async getVideoDetail(bvidValue, { signal, force = false } = {}) {
    const bvid = normalizedBvid(bvidValue);
    return this.readThrough(
      this.detailCache,
      this.detailPending,
      bvid,
      this.detailTtl,
      async (requestSignal) => {
        const detailUrl = `${DATA_ENDPOINTS.detail}?${plainQuery({ bvid })}`;
        let payload;
        try {
          payload = validatePayload(await this.request(detailUrl, { signal: requestSignal }));
          const detail = normalizeVideoDetail(payload?.data, bvid, "detail");
          if (detail) return detail;
        } catch (error) {
          if (!isStructuralEndpointError(error)) throw error;
        }

        // The archive/stat endpoint has fewer fields, but provides enough
        // authoritative cumulative counters for quality scoring.
        const fallbackUrl = `${DATA_ENDPOINTS.statFallback}?${plainQuery({ bvid })}`;
        const fallbackPayload = validatePayload(await this.request(fallbackUrl, { signal: requestSignal }));
        const fallback = normalizeVideoDetail(fallbackPayload?.data, bvid, "stat-fallback");
        if (!fallback) throw new BilibiliApiError("B站未返回视频详情", { kind: "data" });
        return fallback;
      },
      { signal, force },
    );
  }

  async getVideoCards(bvidValues, {
    signal,
    batchSize = 12,
    concurrency = 2,
    maxItems = 60,
    force = false,
    onProgress,
  } = {}) {
    ensureNotAborted(signal);
    const unique = [];
    const seen = new Set();
    for (const value of bvidValues ?? []) {
      const bvid = normalizedBvid(value);
      if (!seen.has(bvid)) {
        seen.add(bvid);
        unique.push(bvid);
      }
    }
    const limited = unique.slice(0, Math.max(0, maxItems));
    const skipped = unique.slice(limited.length);
    const size = Math.min(20, Math.max(10, Math.round(batchSize)));
    const cards = new Map();
    const errors = [];
    let completed = 0;

    for (let offset = 0; offset < limited.length; offset += size) {
      ensureNotAborted(signal);
      const chunk = limited.slice(offset, offset + size);
      const pooled = await runPool(chunk, async (bvid, poolSignal, index) => {
        if (offset + index > 0 && this.enrichmentDelayMs > 0) {
          await sleep(this.enrichmentDelayMs + Math.floor(this.random() * this.enrichmentDelayMs), poolSignal);
        }
        return this.getVideoDetail(bvid, { signal: poolSignal, force });
      }, {
        signal,
        concurrency: Math.min(3, Math.max(1, concurrency)),
        onProgress: ({ item }) => {
          completed += 1;
          onProgress?.({ phase: "detail", completed, total: limited.length, bvid: item });
        },
      });
      for (const [bvid, card] of pooled.results) cards.set(bvid, card);
      errors.push(...pooled.errors.map((error) => ({ bvid: error.item, ...error })));
    }

    return {
      cards,
      videos: limited.map((bvid) => cards.get(bvid)).filter(Boolean),
      errors,
      requestedCount: limited.length,
      enrichedCount: cards.size,
      skippedBvids: skipped,
    };
  }

  async getPageList(bvidValue, { signal, force = false } = {}) {
    const bvid = normalizedBvid(bvidValue);
    const detailCached = this.detailCache.get(bvid);
    if (!force && detailCached?.expiresAt > this.now() && detailCached.value?.pages?.length) {
      return detailCached.value.pages;
    }
    return this.readThrough(
      this.pageCache,
      this.pagePending,
      bvid,
      this.pageTtl,
      async (requestSignal) => {
        const url = `${DATA_ENDPOINTS.pageList}?${plainQuery({ bvid, jsonp: "jsonp" })}`;
        try {
          const payload = validatePayload(await this.request(url, { signal: requestSignal }));
          const pages = normalizePageList(payload?.data);
          if (pages.length) return pages;
        } catch (error) {
          if (!isStructuralEndpointError(error)) throw error;
        }
        const detail = await this.getVideoDetail(bvid, { signal: requestSignal, force });
        if (!detail.pages.length) throw new BilibiliApiError("B站未返回分P信息", { kind: "data" });
        return detail.pages;
      },
      { signal, force },
    );
  }

  async getOnline(bvidValue, {
    cid: cidValue = null,
    page = 1,
    part = "",
    multiPart = null,
    signal,
    force = false,
  } = {}) {
    const bvid = normalizedBvid(bvidValue);
    let cid = safeNumber(cidValue);
    let pageNumber = safeNumber(page, 1);
    let partName = String(part ?? "");
    let isMultiPart = Boolean(multiPart);
    let selection = "explicit";

    if (cid === null) {
      const pages = await this.getPageList(bvid, { signal });
      const requestedPage = pageNumber;
      const requested = pages.find((entry) => entry.page === requestedPage);
      const selected = requested ?? pages[0];
      if (!selected) throw new BilibiliApiError("无法确定在线人数对应的分P", { kind: "data" });
      cid = selected.cid;
      pageNumber = selected.page;
      partName = selected.part;
      isMultiPart = pages.length > 1;
      selection = requested
        ? (selected.page === 1 ? "first-page" : "requested-page")
        : "first-page-fallback";
    }

    const key = `${bvid}:${cid}`;
    const rawOnline = await this.readThrough(
      this.onlineCache,
      this.onlinePending,
      key,
      this.onlineTtl,
      async (requestSignal) => {
        const url = `${DATA_ENDPOINTS.online}?${plainQuery({ bvid, cid })}`;
        const payload = validatePayload(await this.request(url, { signal: requestSignal }));
        if (!payload?.data || typeof payload.data !== "object") {
          throw new BilibiliApiError("B站未返回在线人数", { kind: "data" });
        }
        return payload.data;
      },
      { signal, force },
    );
    return normalizeOnlineStats(rawOnline, {
      bvid,
      cid,
      page: pageNumber,
      part: partName,
      multiPart: isMultiPart,
      selection,
    });
  }

  async getOnlineForVideos(videos, {
    signal,
    limit = 24,
    concurrency = 2,
    force = false,
    onProgress,
  } = {}) {
    const seen = new Set();
    const targets = (videos ?? []).filter((video) => {
      if (!video?.bvid || seen.has(video.bvid)) return false;
      seen.add(video.bvid);
      return true;
    }).slice(0, Math.max(0, limit));
    const pooled = await runPool(targets, async (video, poolSignal, index) => {
      if (index > 0 && this.enrichmentDelayMs > 0) {
        await sleep(this.enrichmentDelayMs + Math.floor(this.random() * this.enrichmentDelayMs), poolSignal);
      }
      const firstPage = video.pages?.[0];
      return this.getOnline(video.bvid, {
        cid: firstPage?.cid,
        page: firstPage?.page ?? 1,
        part: firstPage?.part ?? "",
        multiPart: (video.pages?.length ?? 0) > 1,
        signal: poolSignal,
        force,
      });
    }, {
      signal,
      concurrency: Math.min(2, Math.max(1, concurrency)),
      onProgress: ({ completed, total, item }) => onProgress?.({
        phase: "online",
        completed,
        total,
        bvid: item?.bvid,
      }),
    });
    const onlineByBvid = new Map();
    for (const [video, online] of pooled.results) onlineByBvid.set(video.bvid, online);
    return {
      onlineByBvid,
      errors: pooled.errors.map((error) => ({ bvid: error.item?.bvid, ...error })),
      requestedCount: targets.length,
      enrichedCount: onlineByBvid.size,
    };
  }

  async enrichStats(videos, {
    signal,
    detailLimit = 60,
    includeOnline = false,
    onlineLimit = 24,
    onProgress,
  } = {}) {
    ensureNotAborted(signal);
    const cloned = (videos ?? []).map(cloneVideoForEnrichment);
    const eligibleBvids = cloned.map((video) => video?.bvid).filter(Boolean).slice(0, detailLimit);
    const details = await this.getVideoCards(eligibleBvids, {
      signal,
      maxItems: detailLimit,
      onProgress,
    });
    const enriched = cloned.map((video) => mergeDetailIntoVideo(video, details.cards.get(video.bvid)));
    const errors = [...details.errors];
    let onlineEnrichedCount = 0;
    let onlineByBvid = new Map();

    if (includeOnline) {
      const onlineResult = await this.getOnlineForVideos(enriched, {
        signal,
        limit: onlineLimit,
        onProgress,
      });
      onlineByBvid = onlineResult.onlineByBvid;
      for (const video of enriched) {
        const online = onlineByBvid.get(video.bvid);
        if (online) {
          video.online = online;
          video.enrichment.online = "complete";
          onlineEnrichedCount += 1;
        }
      }
      errors.push(...onlineResult.errors);
    }

    return {
      videos: enriched,
      enrichedVideos: enriched,
      onlineByBvid,
      errors,
      detailEnrichedCount: details.enrichedCount,
      onlineEnrichedCount,
      skippedBvids: details.skippedBvids,
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
              signal: internalSignal,
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
      completedRoutes: completed,
    };
  }
}
