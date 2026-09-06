export const SCRIPT_VERSION = "1.2.0";

export const RELEVANCE_ADMISSION = Object.freeze({
  fuzzyThreshold: 0.74,
  relevanceBand: 0.05,
  singleTerm: Object.freeze({ threshold: 0.45, minCoverage: 1 }),
  shortQuery: Object.freeze({ threshold: 0.35, minCoverage: 0.5 }),
  longQuery: Object.freeze({ threshold: 0.3, minCoverage: 0.4 }),
});

const COMMON_RECALL = Object.freeze({
  threshold: RELEVANCE_ADMISSION.shortQuery.threshold,
  minCoverage: RELEVANCE_ADMISSION.shortQuery.minCoverage,
  fuzzyThreshold: RELEVANCE_ADMISSION.fuzzyThreshold,
  relevanceBand: RELEVANCE_ADMISSION.relevanceBand,
  orders: Object.freeze(["totalrank", "click", "pubdate", "stow", "dm"]),
  pagesPerOrder: 3,
  pageSize: 50,
});

function viewProfile({ id, label, shortDescription, relevanceWeight, signalWeight, qualityWeight }) {
  return Object.freeze({
    ...COMMON_RECALL,
    id,
    label,
    shortDescription,
    relevanceWeight,
    signalWeight,
    qualityWeight,
  });
}

// MODE_PROFILES is retained as a compatibility export for the controller and
// API adapter. Entries are now ranking views, not separate relevance modes:
// every view uses the same admission rules and the same candidate pool.
export const MODE_PROFILES = Object.freeze({
  quality: viewProfile({
    id: "quality",
    label: "长期质量",
    shortDescription: "优先展示长期累计表现与深度互动更强的内容",
    relevanceWeight: 0.4,
    signalWeight: 0.6,
    qualityWeight: 0,
  }),
  growth: viewProfile({
    id: "growth",
    label: "增长趋势",
    shortDescription: "优先展示近期增速更快的内容；无快照时使用低置信度估算",
    relevanceWeight: 0.35,
    signalWeight: 0.55,
    qualityWeight: 0.1,
  }),
  timeliness: viewProfile({
    id: "timeliness",
    label: "最新热播",
    shortDescription: "综合发布时间与当前观看热度，质量仅作小幅辅助",
    relevanceWeight: 0.35,
    signalWeight: 0.55,
    qualityWeight: 0.1,
  }),
});

export const SORT_VIEW_PROFILES = MODE_PROFILES;
export const DEFAULT_MODE = "quality";
export const DEFAULT_SORT_VIEW = DEFAULT_MODE;
export const RESULTS_PER_PAGE = 24;
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const STORAGE_MODE_KEY = "bps:sort-view:v2";

export function getModeProfile(mode) {
  return MODE_PROFILES[mode] ?? MODE_PROFILES[DEFAULT_MODE];
}

export const getSortViewProfile = getModeProfile;
