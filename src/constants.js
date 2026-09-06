export const SCRIPT_VERSION = "1.0.0";

export const MODE_PROFILES = Object.freeze({
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
    pageSize: 50,
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
    pageSize: 50,
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
    pageSize: 50,
  }),
});

export const DEFAULT_MODE = "standard";
export const RESULTS_PER_PAGE = 24;
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const STORAGE_MODE_KEY = "bps:mode:v1";

export function getModeProfile(mode) {
  return MODE_PROFILES[mode] ?? MODE_PROFILES[DEFAULT_MODE];
}
