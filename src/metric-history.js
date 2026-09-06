const DEFAULT_STORAGE_KEY = "bps:metric-history:v1";
const DEFAULT_MAX_VIDEOS = 240;
const DEFAULT_MAX_SNAPSHOTS = 16;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MIN_INTERVAL_MS = 30 * 60 * 1000;

const METRIC_KEYS = ["views", "likes", "favorites", "coins", "replies", "danmaku", "shares"];

function finiteMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function compactStats(stats = {}) {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, finiteMetric(stats[key])]));
}

function validSnapshot(snapshot) {
  return snapshot
    && Number.isFinite(Number(snapshot.capturedAt))
    && snapshot.stats
    && typeof snapshot.stats === "object";
}

export class MetricHistoryStore {
  constructor({
    storage = globalThis.localStorage,
    storageKey = DEFAULT_STORAGE_KEY,
    now = () => Date.now(),
    maxVideos = DEFAULT_MAX_VIDEOS,
    maxSnapshots = DEFAULT_MAX_SNAPSHOTS,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  } = {}) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.now = now;
    this.maxVideos = maxVideos;
    this.maxSnapshots = maxSnapshots;
    this.maxAgeMs = maxAgeMs;
    this.minIntervalMs = minIntervalMs;
    this.memory = { version: 1, videos: {} };
  }

  load() {
    let parsed = this.memory;
    try {
      const raw = this.storage?.getItem(this.storageKey);
      if (raw) parsed = JSON.parse(raw);
    } catch { /* blocked or malformed storage falls back to memory */ }
    if (!parsed || parsed.version !== 1 || !parsed.videos || typeof parsed.videos !== "object") {
      parsed = { version: 1, videos: {} };
    }
    this.memory = parsed;
    return parsed;
  }

  save(data) {
    this.memory = data;
    try { this.storage?.setItem(this.storageKey, JSON.stringify(data)); } catch { /* memory remains usable */ }
  }

  snapshotsFor(videos = []) {
    const data = this.load();
    const cutoff = this.now() - this.maxAgeMs;
    const result = new Map();
    for (const video of videos) {
      const bvid = String(video?.bvid ?? video?.key ?? "").trim();
      if (!bvid) continue;
      const snapshots = Array.isArray(data.videos[bvid]?.snapshots)
        ? data.videos[bvid].snapshots
          .filter(validSnapshot)
          .filter((snapshot) => Number(snapshot.capturedAt) >= cutoff)
          .sort((left, right) => Number(left.capturedAt) - Number(right.capturedAt))
        : [];
      result.set(bvid, snapshots);
    }
    return result;
  }

  record(videos = []) {
    const capturedAt = this.now();
    const cutoff = capturedAt - this.maxAgeMs;
    const data = this.load();
    for (const video of videos) {
      const bvid = String(video?.bvid ?? video?.key ?? "").trim();
      if (!bvid || !video?.stats) continue;
      const stats = compactStats(video.stats);
      if (!METRIC_KEYS.some((key) => stats[key] !== null)) continue;
      const previous = Array.isArray(data.videos[bvid]?.snapshots)
        ? data.videos[bvid].snapshots.filter(validSnapshot)
        : [];
      const snapshots = previous
        .filter((snapshot) => Number(snapshot.capturedAt) >= cutoff)
        .sort((left, right) => Number(left.capturedAt) - Number(right.capturedAt));
      const last = snapshots.at(-1);
      if (last && capturedAt - Number(last.capturedAt) < this.minIntervalMs) continue;
      snapshots.push({ capturedAt, stats });
      data.videos[bvid] = {
        updatedAt: capturedAt,
        snapshots: snapshots.slice(-this.maxSnapshots),
      };
    }

    const retained = Object.entries(data.videos)
      .filter(([, entry]) => Number(entry?.updatedAt) >= cutoff)
      .sort((left, right) => Number(right[1]?.updatedAt) - Number(left[1]?.updatedAt))
      .slice(0, this.maxVideos);
    data.videos = Object.fromEntries(retained);
    this.save(data);
  }
}

export const METRIC_HISTORY_STORAGE_KEY = DEFAULT_STORAGE_KEY;
