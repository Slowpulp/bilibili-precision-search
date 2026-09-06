import {
  CACHE_TTL_MS,
  DEFAULT_MODE,
  MODE_PROFILES,
  STORAGE_MODE_KEY,
  getModeProfile,
} from "./constants.js";
import { BilibiliSearchApiAdapter } from "./api-adapter.js";
import { MetricHistoryStore } from "./metric-history.js";
import { rerankCandidates } from "./scoring.js";
import { parseQuery } from "./text.js";
import { NATIVE_TAB_LABELS, PrecisionSearchView, normalizeNativeTabLabel } from "./ui.js";

const LOCATION_EVENT = "bps:locationchange";
const ALLOWED_PATHS = new Set(["/all", "/all/", "/video", "/video/"]);
const SORT_KEYS = Object.freeze(Object.keys(MODE_PROFILES));
const DETAIL_ENRICH_LIMIT = 60;
const ONLINE_SAMPLE_LIMIT = 24;

export function currentContext(locationRef = location) {
  const url = new URL(locationRef.href);
  return {
    url,
    path: url.pathname,
    keyword: (url.searchParams.get("keyword") ?? "").trim(),
    signature: `${url.pathname}\n${(url.searchParams.get("keyword") ?? "").trim()}`,
    available: ALLOWED_PATHS.has(url.pathname),
  };
}

function safeStorageGet(storage, key, fallback) {
  try { return storage?.getItem(key) ?? fallback; } catch { return fallback; }
}

function safeStorageSet(storage, key, value) {
  try { storage?.setItem(key, value); } catch { /* storage can be blocked */ }
}

function rankingOptions({ now, snapshots, onlineByBvid } = {}) {
  return { now: now ?? Date.now(), snapshots, onlineByBvid };
}

export function buildRankings(videos, query, options = {}) {
  return Object.fromEntries(SORT_KEYS.map((sort) => [
    sort,
    rerankCandidates(videos, query, sort, rankingOptions(options)),
  ]));
}

export function balancedEnrichmentShortlist(rankings, limit = DETAIL_ENRICH_LIMIT) {
  const rankedLists = SORT_KEYS.map((sort) => rankings?.[sort]?.ranked ?? []);
  const selected = [];
  const seen = new Set();
  let position = 0;
  while (selected.length < limit && rankedLists.some((items) => position < items.length)) {
    for (const items of rankedLists) {
      const video = items[position]?.video;
      const key = String(video?.bvid ?? video?.key ?? "");
      if (!video || !key || seen.has(key)) continue;
      seen.add(key);
      selected.push(video);
      if (selected.length >= limit) break;
    }
    position += 1;
  }
  return selected;
}

export function mergeEnrichedVideos(videos, enrichedVideos) {
  const replacements = new Map((enrichedVideos ?? []).map((video) => [
    String(video?.bvid ?? video?.key ?? ""),
    video,
  ]));
  return (videos ?? []).map((video) => replacements.get(String(video?.bvid ?? video?.key ?? "")) ?? video);
}

export function installLocationWatcher(windowRef = window) {
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
    } catch { /* polling below remains available */ }
  }
  for (const eventName of ["popstate", "hashchange", "pageshow"]) {
    const listener = () => notify(eventName);
    eventListeners.push({ eventName, listener });
    windowRef.addEventListener(eventName, listener);
  }
  const interval = windowRef.setInterval(() => {
    if (windowRef.location.href !== lastHref) notify("poll");
  }, 1000);
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
      try { if (windowRef[marker] === controller) delete windowRef[marker]; } catch { /* noop */ }
    },
  };
  try { windowRef[marker] = controller; } catch { /* noop */ }
  return controller;
}

class NativePageGuard {
  constructor(documentRef) {
    this.document = documentRef;
    this.window = documentRef.defaultView ?? globalThis;
    this.saved = new Map();
  }

  activate() {
    const candidates = [...this.document.querySelectorAll(".search-conditions, .search-filter-wrap, .search-content")];
    const targets = candidates.filter((target) => !candidates.some((other) => other !== target && other.contains(target)));
    for (const target of targets) {
      if (target.closest("#bps-host") || this.saved.has(target)) continue;
      const fallbackFocusables = !("inert" in this.window.HTMLElement.prototype)
        ? [...target.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].map((node) => ({
          node,
          tabindex: node.getAttribute("tabindex"),
        }))
        : [];
      this.saved.set(target, {
        inert: Boolean(target.inert),
        inertAttribute: target.hasAttribute("inert"),
        inertAttributeValue: target.getAttribute("inert"),
        ariaHidden: target.getAttribute("aria-hidden"),
        fallbackFocusables,
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
}

export class PrecisionSearchApp {
  constructor({
    documentRef = document,
    windowRef = window,
    adapter = new BilibiliSearchApiAdapter(),
    historyStore = null,
  } = {}) {
    this.document = documentRef;
    this.window = windowRef;
    this.adapter = adapter;
    const storedSort = safeStorageGet(windowRef.localStorage, STORAGE_MODE_KEY, DEFAULT_MODE);
    this.sort = MODE_PROFILES[storedSort] ? storedSort : DEFAULT_MODE;
    // Kept as a compatibility property for integrations written against v1.0.x.
    this.mode = this.sort;
    this.historyStore = historyStore ?? new MetricHistoryStore({ storage: windowRef.localStorage });
    this.view = null;
    this.guard = new NativePageGuard(documentRef);
    this.controller = null;
    this.generation = 0;
    this.context = currentContext(windowRef.location);
    this.cache = new Map();
    this.activeSearch = null;
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
        onSortChange: (sort) => this.changeSort(sort),
      },
    }).mount();
    this.view.setSort(this.sort);
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

  changeSort(sort) {
    if (!MODE_PROFILES[sort]) return;
    this.sort = sort;
    this.mode = sort;
    safeStorageSet(this.window.localStorage, STORAGE_MODE_KEY, sort);
    this.view.setSort(sort, { render: false });
    if (!this.controller && this.activeSearch?.rankings?.[sort]) {
      this.view.setResults(this.activeSearch.rankings[sort], this.activeSearch.pool);
    }
  }

  // Compatibility method for callers written against v1.0.x.
  changeMode(sort) {
    this.changeSort(sort);
  }

  async search(rawQuery) {
    const query = String(rawQuery ?? "").trim();
    this.view.setQuery(query);
    this.view.showPanel({ focus: false });
    this.guard.activate();
    this.cancel({ silent: true });
    const generation = this.generation;
    this.activeSearch = null;
    const parsedQuery = parseQuery(query);
    if (!query || !parsedQuery.terms.length) {
      this.view.setError(new Error("请输入至少一个正向关键词"));
      return;
    }
    const cacheKey = query;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      this.activeSearch = cached;
      this.view.setResults(cached.rankings[this.sort], cached.pool);
      return;
    }

    this.controller = new AbortController();
    const signal = this.controller.signal;
    // Every ranking view shares this one recall/admission profile.
    const profile = getModeProfile(DEFAULT_MODE);
    this.view.setLoading({ stage: "recall", total: profile.orders.length * profile.pagesPerOrder });
    try {
      const pool = await this.adapter.collectCandidates(parsedQuery.normalized, profile, {
        signal,
        onProgress: (progress) => {
          if (generation !== this.generation) return;
          this.view.setLoading({ ...progress, stage: "recall" });
        },
      });
      if (generation !== this.generation) return;
      pool.errors ??= [];
      const now = Date.now();

      this.view.setLoading({ stage: "history", completed: 0, total: 1 });
      const snapshots = this.historyStore.snapshotsFor(pool.videos);
      let workingVideos = pool.videos;
      let onlineByBvid = new Map();
      const enrichmentErrors = [];

      const preliminaryRankings = buildRankings(workingVideos, query, { now, snapshots });
      const detailShortlist = balancedEnrichmentShortlist(preliminaryRankings, DETAIL_ENRICH_LIMIT);
      if (detailShortlist.length && typeof this.adapter.enrichStats === "function") {
        this.view.setLoading({ stage: "details", completed: 0, total: detailShortlist.length });
        try {
          const details = await this.adapter.enrichStats(detailShortlist, {
            signal,
            detailLimit: DETAIL_ENRICH_LIMIT,
            includeOnline: false,
            onProgress: (progress) => {
              if (generation !== this.generation) return;
              this.view.setLoading({
                stage: "details",
                completed: progress.completed,
                total: progress.total,
              });
            },
          });
          if (generation !== this.generation) return;
          workingVideos = mergeEnrichedVideos(workingVideos, details.enrichedVideos ?? details.videos);
          enrichmentErrors.push(...(details.errors ?? []));
          pool.detailEnrichedCount = details.detailEnrichedCount ?? 0;
          pool.detailSkippedCount = details.skippedBvids?.length ?? 0;
        } catch (error) {
          if (error?.name === "AbortError" || error?.kind === "risk" || error?.kind === "signature") throw error;
          enrichmentErrors.push({ phase: "detail", message: error?.message ?? String(error) });
        }
      }

      const rankingsBeforeOnline = buildRankings(workingVideos, query, { now, snapshots });
      const onlineShortlist = rankingsBeforeOnline.timeliness.ranked
        .slice(0, ONLINE_SAMPLE_LIMIT)
        .map((item) => item.video);
      if (onlineShortlist.length && typeof this.adapter.getOnlineForVideos === "function") {
        this.view.setLoading({ stage: "online", completed: 0, total: onlineShortlist.length });
        try {
          const online = await this.adapter.getOnlineForVideos(onlineShortlist, {
            signal,
            limit: ONLINE_SAMPLE_LIMIT,
            concurrency: 2,
            onProgress: (progress) => {
              if (generation !== this.generation) return;
              this.view.setLoading({
                stage: "online",
                completed: progress.completed,
                total: progress.total,
              });
            },
          });
          if (generation !== this.generation) return;
          onlineByBvid = online.onlineByBvid ?? new Map();
          enrichmentErrors.push(...(online.errors ?? []));
          pool.onlineEnrichedCount = online.enrichedCount ?? 0;
        } catch (error) {
          if (error?.name === "AbortError" || error?.kind === "risk" || error?.kind === "signature") throw error;
          enrichmentErrors.push({ phase: "online", message: error?.message ?? String(error) });
        }
      }

      this.view.setLoading({ stage: "ranking", completed: 0, total: 1 });
      const rankings = buildRankings(workingVideos, query, { now, snapshots, onlineByBvid });
      pool.enrichmentErrors = enrichmentErrors;
      // Search cards sometimes expose zero placeholders for interactions. Only
      // persist authoritative detail/stat responses, otherwise a later detail
      // fetch could look like explosive growth from a fake zero baseline.
      const snapshotCandidates = rankings.quality.ranked
        .map((item) => item.video)
        .filter((video) => ["complete", "partial"].includes(video.enrichment?.detail));
      this.historyStore.record(snapshotCandidates);
      this.view.setLoading({ stage: "ranking", completed: 1, total: 1 });
      for (const [key, entry] of this.cache) {
        if (Date.now() - entry.createdAt >= CACHE_TTL_MS) this.cache.delete(key);
      }
      while (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value);
      const completedSearch = { createdAt: Date.now(), query, rankings, pool };
      this.cache.set(cacheKey, completedSearch);
      this.activeSearch = completedSearch;
      this.view.setResults(rankings[this.sort], pool);
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
}

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
