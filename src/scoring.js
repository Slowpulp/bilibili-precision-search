import { RELEVANCE_ADMISSION, getModeProfile } from "./constants.js";
import {
  bestSubstringSimilarity,
  compactText,
  containsOrderedTerms,
  ngramContainment,
  normalizeText,
  parseQuery,
} from "./text.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

const FIELD_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "title", label: "标题", strength: 1 }),
  Object.freeze({ id: "tags", label: "标签", strength: 0.78 }),
  Object.freeze({ id: "description", label: "简介", strength: 0.48 }),
  Object.freeze({ id: "author", label: "UP主", strength: 0.4 }),
  Object.freeze({ id: "category", label: "分区", strength: 0.28 }),
]);

const CORE_FIELDS = new Set(["title", "tags", "description"]);
const TITLE_OR_TAG_FIELDS = new Set(["title", "tags"]);
const VERSION_QUALIFIERS = new Set([
  "pro", "max", "ultra", "mini", "plus", "air", "se", "ti", "super", "xt",
  "edition", "mark", "mk", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "版", "代",
]);

// Fixed anchors make a video's long-term quality stable across different
// searches. They deliberately do not contain age, velocity, or freshness.
const QUALITY_METRICS = Object.freeze([
  Object.freeze({ id: "favorites", label: "收藏", weight: 0.25, anchor: 2_000, baseRate: 0.012 }),
  Object.freeze({ id: "coins", label: "投币", weight: 0.2, anchor: 1_000, baseRate: 0.006 }),
  Object.freeze({ id: "shares", label: "分享", weight: 0.15, anchor: 500, baseRate: 0.002 }),
  Object.freeze({ id: "likes", label: "点赞", weight: 0.15, anchor: 5_000, baseRate: 0.035 }),
  Object.freeze({ id: "replies", label: "评论", weight: 0.1, anchor: 300, baseRate: 0.002 }),
  Object.freeze({ id: "views", label: "播放", weight: 0.1, anchor: 100_000, baseRate: null }),
  Object.freeze({ id: "danmaku", label: "弹幕", weight: 0.05, anchor: 1_000, baseRate: 0.006 }),
]);

const GROWTH_METRICS = Object.freeze([
  Object.freeze({ id: "views", label: "播放", weight: 0.25, dailyAnchor: 100_000 }),
  Object.freeze({ id: "likes", label: "点赞", weight: 0.2, dailyAnchor: 5_000 }),
  Object.freeze({ id: "favorites", label: "收藏", weight: 0.18, dailyAnchor: 2_000 }),
  Object.freeze({ id: "coins", label: "投币", weight: 0.14, dailyAnchor: 1_000 }),
  Object.freeze({ id: "shares", label: "分享", weight: 0.08, dailyAnchor: 500 }),
  Object.freeze({ id: "replies", label: "评论", weight: 0.07, dailyAnchor: 300 }),
  Object.freeze({ id: "danmaku", label: "弹幕", weight: 0.08, dailyAnchor: 1_000 }),
]);

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function weightedAverage(items, valueKey = "value") {
  const available = items.filter((item) => Number.isFinite(item[valueKey]) && item.weight > 0);
  const weight = available.reduce((sum, item) => sum + item.weight, 0);
  if (!weight) return null;
  return available.reduce((sum, item) => sum + item[valueKey] * item.weight, 0) / weight;
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
  const flexibleInner = [...term.compact]
    .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s._-]*");
  const leftBoundary = /^[a-z]/i.test(term.compact) ? "[^a-z]" : "[^a-z0-9]";
  const flexiblePattern = new RegExp(`(^|${leftBoundary})${flexibleInner}([^a-z0-9]|$)`, "i");
  if (flexiblePattern.test(normalized)) return true;
  return new RegExp(`(^|${leftBoundary})${escaped}([^a-z0-9]|$)`, "i").test(compact);
}

function matchTermInField(term, text, profile) {
  if (!text) return { confidence: 0, exact: false, fuzzy: false, similarity: 0 };
  if (hasExactTerm(text, term)) return { confidence: 1, exact: true, fuzzy: false, similarity: 1 };
  const shortAscii = /^[a-z]+$/i.test(term.compact) && term.compact.length < 5;
  if (/^\d+$/.test(term.compact) || term.compact.length < 3 || shortAscii) {
    return { confidence: 0, exact: false, fuzzy: false, similarity: 0 };
  }
  const similarity = bestSubstringSimilarity(term.compact, text);
  if (similarity < profile.fuzzyThreshold) return { confidence: 0, exact: false, fuzzy: false, similarity };
  return { confidence: similarity * 0.82, exact: false, fuzzy: true, similarity };
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
  return clamp((matchedLength / Math.max(1, end - start)) * (positions.length / parsedQuery.terms.length));
}

function exactPhrasePasses(parsedQuery, video) {
  if (parsedQuery.exactPhrases.length === 0) return true;
  return parsedQuery.exactPhrases.every((phrase) =>
    ["title", "tags", "description", "author"].some((fieldId) =>
      hasExactTerm(fieldText(video, fieldId), { text: normalizeText(phrase), compact: compactText(phrase) }),
    ),
  );
}

function negativeMatch(parsedQuery, video) {
  const searchable = [
    video.title,
    (video.tags ?? []).join(" "),
    video.description,
    video.author?.name,
    video.category,
  ].join(" ");
  return parsedQuery.negativeTerms.find((term) => hasExactTerm(searchable, term)) ?? null;
}

function modelTermPasses(matchedTerms) {
  const required = matchedTerms.filter((item) =>
    /\d/.test(item.term) || VERSION_QUALIFIERS.has(item.term.toLocaleLowerCase()),
  );
  return required.every((item) => item.matches.some((match) => match.exact && CORE_FIELDS.has(match.field)));
}

export function resolveAdmissionRules(parsedQuery) {
  const primaryCount = parsedQuery.terms.filter((term) => !term.auxiliary).length;
  const auxiliaryCount = parsedQuery.terms.length - primaryCount;
  // Long unspaced CJK queries consist of one low-weight full phrase and a set
  // of auxiliary bigrams. Count those as a multi-term intent for admission.
  const effectiveTermCount = primaryCount === 1 && auxiliaryCount >= 3
    ? Math.min(4, 1 + Math.ceil(auxiliaryCount / 3))
    : Math.max(1, primaryCount);
  const base = effectiveTermCount === 1
    ? RELEVANCE_ADMISSION.singleTerm
    : effectiveTermCount <= 3
      ? RELEVANCE_ADMISSION.shortQuery
      : RELEVANCE_ADMISSION.longQuery;
  return { ...base, effectiveTermCount };
}

export function scoreRelevance(video, queryOrParsed, view = "quality") {
  const profile = getModeProfile(view);
  const parsedQuery = typeof queryOrParsed === "string" ? parseQuery(queryOrParsed) : queryOrParsed;
  if (!parsedQuery?.terms?.length) {
    return {
      value: 0,
      coverage: 0,
      titleCoverage: 0,
      passes: false,
      admission: { threshold: 1, minCoverage: 1, effectiveTermCount: 0 },
      matchedTerms: [],
      missingTerms: [],
      positiveReasons: [],
      negativeReasons: ["查询中没有可评分的关键词"],
      rejectionReasons: ["查询中没有可评分的关键词"],
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
      matches,
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
    0.5 * fieldScore +
    0.25 * coverage +
    0.13 * titleCoverage +
    0.08 * phrase.score +
    0.04 * proximity +
    (authorExact ? 0.06 : 0),
  );

  const missingTerms = matchedTerms
    .filter((item) => item.matches.length === 0 && !item.auxiliary)
    .map((item) => item.term);
  const negative = negativeMatch(parsedQuery, video);
  const phrasePass = exactPhrasePasses(parsedQuery, video);
  const modelPass = authorExact || modelTermPasses(matchedTerms);
  const primaryTerms = matchedTerms.filter((item) => !item.auxiliary);
  const hasExactTitleOrTag = primaryTerms.some((item) =>
    item.matches.some((match) => match.exact && TITLE_OR_TAG_FIELDS.has(match.field)),
  );
  const hasStrongSingleTermFuzzyAnchor = primaryTerms.length === 1 && primaryTerms[0].compact.length >= 5 &&
    primaryTerms[0].matches.some((match) =>
      match.fuzzy && TITLE_OR_TAG_FIELDS.has(match.field) && match.similarity >= 0.85,
    );
  const exactAuxiliaryAnchors = matchedTerms.filter((item) => item.auxiliary && item.matches.some((match) =>
    match.exact && TITLE_OR_TAG_FIELDS.has(match.field),
  )).length;
  const hasCjkBigramAnchor = primaryTerms.length === 1 &&
    parsedQuery.terms.some((term) => term.auxiliary) && exactAuxiliaryAnchors >= 2;
  const corePass = hasExactTitleOrTag || authorExact || hasStrongSingleTermFuzzyAnchor || hasCjkBigramAnchor;
  const admission = resolveAdmissionRules(parsedQuery);
  // A single long misspelling can be admitted only with a strong title/tag
  // fuzzy anchor; numeric, model and short terms never enter this branch.
  if (admission.effectiveTermCount === 1 && !hasExactTitleOrTag && hasStrongSingleTermFuzzyAnchor) {
    admission.minCoverage = 0.7;
  }

  const rejectionReasons = [];
  if (negative) rejectionReasons.push(`命中排除词“${negative.text}”`);
  if (value < admission.threshold) rejectionReasons.push(`相关性低于 ${Math.round(admission.threshold * 100)} 分`);
  if (coverage < admission.minCoverage) rejectionReasons.push(`关键词覆盖低于 ${Math.round(admission.minCoverage * 100)}%`);
  if (!corePass) rejectionReasons.push("至少一个核心词须精确命中标题或标签");
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
  const nonTitleTerms = matchedTerms
    .filter((item) => item.matches.length > 0 && !item.matches.some((match) => match.field === "title"))
    .map((item) => item.term);
  if (nonTitleTerms.length) negativeReasons.push(`仅在非标题字段命中：${nonTitleTerms.join("、")}`);
  if (matchedTerms.some((item) => item.matches.some((match) => match.fuzzy))) negativeReasons.push("包含有限近似匹配");

  return {
    value,
    coverage,
    coreCoverage,
    titleCoverage,
    phrase,
    admission,
    passes: rejectionReasons.length === 0,
    matchedTerms: matchedTerms.filter((item) => item.matches.length > 0 && !item.auxiliary).map((item) => ({
      term: item.term,
      confidence: item.confidence,
      fields: [...new Set(item.matches.map((match) => match.fieldLabel))],
      fuzzy: item.matches.some((match) => match.fuzzy),
    })),
    missingTerms,
    positiveReasons,
    negativeReasons,
    rejectionReasons,
  };
}

function validStat(videoOrStats, metricId) {
  const stats = videoOrStats?.stats ?? videoOrStats;
  const value = stats?.[metricId];
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return null;
  return Math.max(0, Number(value));
}

function sigmoidLog(value, anchor, steepness = 1.15) {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(anchor) || anchor <= 0) return null;
  const logRatio = Math.log((value + 1) / (anchor + 1));
  return clamp(1 / (1 + Math.exp(-steepness * logRatio)));
}

function scoreOneQuality(video) {
  const views = validStat(video, "views");
  const components = QUALITY_METRICS.map((metric) => {
    const count = validStat(video, metric.id);
    if (count === null) return { ...metric, value: null, countSignal: null, rateSignal: null };
    const countSignal = sigmoidLog(count, metric.anchor);
    let rateSignal = null;
    if (metric.baseRate !== null && views !== null) {
      const priorViews = 2_000;
      const denominator = Math.max(views, count, 0) + priorViews;
      const smoothedRate = (count + priorViews * metric.baseRate) / Math.max(1, denominator);
      rateSignal = clamp(smoothedRate / (smoothedRate + metric.baseRate));
    }
    return { ...metric, value: countSignal, count, countSignal, rateSignal };
  });

  const absolute = weightedAverage(components, "countSignal") ?? 0.5;
  const rateComponents = components.filter((component) => component.baseRate !== null);
  const rate = weightedAverage(rateComponents, "rateSignal") ?? 0.5;
  const absoluteCompleteness = components
    .filter((component) => component.countSignal !== null)
    .reduce((sum, component) => sum + component.weight, 0);
  const totalRateWeight = rateComponents.reduce((sum, component) => sum + component.weight, 0);
  const rateCompleteness = totalRateWeight
    ? rateComponents.filter((component) => component.rateSignal !== null).reduce((sum, component) => sum + component.weight, 0) / totalRateWeight
    : 0;
  const completeness = clamp(0.65 * absoluteCompleteness + 0.35 * rateCompleteness);
  const raw = 0.65 * absolute + 0.35 * rate;
  const value = clamp(0.5 + (raw - 0.5) * (0.35 + 0.65 * completeness));

  const strongest = components
    .filter((component) => component.countSignal !== null)
    .sort((left, right) => (right.countSignal ?? 0) - (left.countSignal ?? 0))
    .slice(0, 2);
  const positiveReasons = strongest
    .filter((component) => component.countSignal >= 0.68)
    .map((component) => `${component.label}长期累计表现突出`);
  const negativeReasons = [];
  if (completeness < 0.7) negativeReasons.push("部分互动统计缺失，长期质量分已向中性收缩");
  if (!positiveReasons.length) positiveReasons.push("长期质量由累计沉淀与平滑互动率综合估算");
  return {
    value,
    raw,
    completeness,
    absolute,
    rate,
    components,
    positiveReasons,
    negativeReasons,
  };
}

export function applyQualityScores(scoredVideos) {
  for (const item of scoredVideos) item.quality = scoreOneQuality(item.video);
  return scoredVideos;
}

function normalizeTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
}

function snapshotListFor(snapshots, video) {
  if (!snapshots) return [];
  const key = video.bvid ?? video.key;
  let values;
  if (snapshots instanceof Map) values = snapshots.get(key);
  else if (Array.isArray(snapshots)) values = snapshots.filter((snapshot) => (snapshot.bvid ?? snapshot.key) === key);
  else if (typeof snapshots === "object") values = snapshots[key];
  if (!Array.isArray(values)) values = values ? [values] : [];
  return values.map((snapshot) => ({
    ...snapshot,
    capturedAt: normalizeTimestamp(snapshot.capturedAt ?? snapshot.sampledAt ?? snapshot.timestamp),
    stats: snapshot.stats ?? snapshot,
  })).filter((snapshot) => snapshot.capturedAt !== null);
}

function latestUsableSnapshot(snapshots, video, now) {
  return snapshotListFor(snapshots, video)
    .filter((snapshot) => snapshot.capturedAt <= now - MIN_SNAPSHOT_INTERVAL_MS)
    .sort((left, right) => right.capturedAt - left.capturedAt)[0] ?? null;
}

function videoAgeDays(video, now) {
  const publishedAt = normalizeTimestamp(video.publishedAt);
  if (publishedAt === null || publishedAt > now) return null;
  return Math.max(1 / 24, (now - publishedAt) / DAY_MS);
}

function scoreOneGrowth(video, snapshots, now) {
  const snapshot = latestUsableSnapshot(snapshots, video, now);
  const age = videoAgeDays(video, now);
  const elapsedDays = snapshot ? (now - snapshot.capturedAt) / DAY_MS : null;
  const components = GROWTH_METRICS.map((metric) => {
    const current = validStat(video, metric.id);
    const previous = snapshot ? validStat(snapshot.stats, metric.id) : null;
    const lifecyclePerDay = current !== null && age !== null ? current / age : null;
    const lifecycleSignal = lifecyclePerDay === null ? null : sigmoidLog(lifecyclePerDay, metric.dailyAnchor);
    let actualPerDay = null;
    let observedSignal = null;
    if (current !== null && previous !== null && elapsedDays > 0 && current >= previous) {
      actualPerDay = (current - previous) / elapsedDays;
      observedSignal = sigmoidLog(actualPerDay, metric.dailyAnchor);
    }
    const value = observedSignal === null
      ? lifecycleSignal
      : lifecycleSignal === null
        ? observedSignal
        : 0.7 * observedSignal + 0.3 * lifecycleSignal;
    return {
      ...metric,
      value,
      current,
      previous,
      actualPerDay,
      lifecyclePerDay,
      observedSignal,
      lifecycleSignal,
    };
  });

  const observed = components.filter((component) => component.observedSignal !== null);
  const lifecycle = components.filter((component) => component.lifecycleSignal !== null);
  const observedWeight = observed.reduce((sum, component) => sum + component.weight, 0);
  const lifecycleWeight = lifecycle.reduce((sum, component) => sum + component.weight, 0);
  let status = "unavailable";
  let confidence = 0;
  let raw = 0.5;
  let completeness = 0;
  if (observedWeight > 0) {
    status = "observed";
    raw = weightedAverage(components) ?? 0.5;
    completeness = observedWeight;
    const intervalConfidence = clamp((now - snapshot.capturedAt) / (6 * HOUR_MS), 0.25, 1);
    confidence = clamp((0.65 + 0.35 * intervalConfidence) * completeness);
  } else if (lifecycleWeight > 0) {
    status = "estimated";
    raw = weightedAverage(components, "lifecycleSignal") ?? 0.5;
    completeness = lifecycleWeight;
    confidence = 0.35 * completeness;
  }
  const value = status === "unavailable"
    ? 0.5
    : clamp(0.5 + (raw - 0.5) * confidence);

  const positiveReasons = [];
  const negativeReasons = [];
  const strongest = [...components]
    .filter((component) => component.value !== null)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))[0];
  if (strongest?.value >= 0.68) positiveReasons.push(`${strongest.label}增速表现突出`);
  if (status === "observed") positiveReasons.push(`基于约 ${Math.max(0.25, (now - snapshot.capturedAt) / HOUR_MS).toFixed(1)} 小时的真实增量`);
  if (status === "estimated") negativeReasons.push("尚无可用历史快照，当前为发布以来平均增速的低置信度估算");
  if (status === "unavailable") negativeReasons.push("缺少发布时间或统计数据，暂无法估算增长");
  if (snapshot && observedWeight < lifecycleWeight) negativeReasons.push("部分指标发生回退或缺失，未将其误判为负增长");

  return {
    value,
    raw,
    completeness,
    confidence,
    status,
    observationHours: snapshot ? (now - snapshot.capturedAt) / HOUR_MS : null,
    snapshotAt: snapshot?.capturedAt ?? null,
    components,
    positiveReasons,
    negativeReasons,
  };
}

export function applyGrowthScores(scoredVideos, snapshots = null, now = Date.now()) {
  for (const item of scoredVideos) item.growth = scoreOneGrowth(item.video, snapshots, now);
  return scoredVideos;
}

function parseOnlineCount(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const normalized = String(value).trim().replace(/[,，+]/g, "");
  const match = normalized.match(/([\d.]+)\s*(万|亿)?/);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const multiplier = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : 1;
  return numeric * multiplier;
}

function onlineValueFor(onlineByBvid, video) {
  const key = video.bvid ?? video.key;
  let raw = onlineByBvid instanceof Map ? onlineByBvid.get(key) : onlineByBvid?.[key];
  raw ??= video.onlineCount ?? video.stats?.onlineCount ?? video.stats?.online;
  if (raw && typeof raw === "object") {
    raw = raw.onlineCount ?? raw.total ?? raw.web ?? raw.count ?? raw.data?.total ?? raw.data?.count;
  }
  return parseOnlineCount(raw);
}

function timelinessPolicy(parsedQuery, now) {
  const currentYear = new Date(now).getFullYear();
  const years = parsedQuery.normalized.match(/(?:19|20)\d{2}/g)?.map(Number) ?? [];
  const recentWords = /最新|近期|最近|今日|今天|当下|latest|recent|current/.test(parsedQuery.normalized);
  if (recentWords) return { halfLifeDays: 30, reason: "查询包含明确的近期意图" };
  if (years.includes(currentYear)) return { halfLifeDays: 90, reason: "查询包含当前年份" };
  if (years.some((year) => year < currentYear - 1)) return { halfLifeDays: 730, reason: "历史主题采用较长时效半衰期" };
  return { halfLifeDays: 180, reason: "使用普通时效半衰期" };
}

function scoreOneTimeliness(video, parsedQuery, onlineByBvid, now) {
  const policy = timelinessPolicy(parsedQuery, now);
  const age = videoAgeDays(video, now);
  const recency = age === null ? null : clamp(2 ** (-age / policy.halfLifeDays));
  const onlineCount = onlineValueFor(onlineByBvid, video);
  const online = onlineCount === null ? null : sigmoidLog(onlineCount, 500, 1);
  const components = [
    { id: "recency", label: "发布时间", weight: 0.65, value: recency },
    { id: "online", label: "正在观看", weight: 0.35, value: online },
  ];
  // A missing signal must be genuinely neutral. Renormalizing only the
  // available component would let an unsampled video receive a perfect
  // recency-only score and systematically outrank sampled candidates.
  const raw = 0.65 * (recency ?? 0.5) + 0.35 * (online ?? 0.5);
  const completeness = components
    .filter((component) => component.value !== null)
    .reduce((sum, component) => sum + component.weight, 0);
  const value = clamp(raw);
  const positiveReasons = [];
  const negativeReasons = [];
  if (recency !== null && recency >= 0.7) positiveReasons.push("发布时间较近");
  if (online !== null && online >= 0.65) positiveReasons.push("当前观看热度较高");
  if (online === null) negativeReasons.push("缺少正在观看数据，在线信号按中性值处理");
  if (age === null) negativeReasons.push("缺少有效发布时间");
  positiveReasons.push(policy.reason);
  return {
    value,
    raw,
    completeness,
    halfLifeDays: policy.halfLifeDays,
    onlineStatus: onlineCount === null ? "unavailable" : "available",
    onlineCount,
    components,
    positiveReasons,
    negativeReasons,
  };
}

export function applyTimelinessScores(scoredVideos, parsedQuery, onlineByBvid = null, now = Date.now()) {
  for (const item of scoredVideos) {
    item.timeliness = scoreOneTimeliness(item.video, parsedQuery, onlineByBvid, now);
  }
  return scoredVideos;
}

export function applyDimensionScores(scoredVideos, parsedQuery, options = {}) {
  const now = options.now ?? Date.now();
  applyQualityScores(scoredVideos);
  applyGrowthScores(scoredVideos, options.snapshots, now);
  applyTimelinessScores(scoredVideos, parsedQuery, options.onlineByBvid, now);
  return scoredVideos;
}

function scoreForView(item, view) {
  if (view === "growth") return item.growth.value;
  if (view === "timeliness") return item.timeliness.value;
  return item.quality.value;
}

export function rerankCandidates(videos, query, view = "quality", options = {}) {
  const profile = getModeProfile(view);
  const parsedQuery = parseQuery(query);
  const evaluated = videos.map((video) => ({
    video,
    relevance: scoreRelevance(video, parsedQuery, profile.id),
    quality: null,
    growth: null,
    timeliness: null,
    rank: null,
  }));
  const accepted = evaluated.filter((item) => item.relevance.passes);
  const rejected = evaluated.filter((item) => !item.relevance.passes);
  applyDimensionScores(accepted, parsedQuery, options);

  for (const item of accepted) {
    const maximumBand = Math.ceil(1 / profile.relevanceBand) - 1;
    const relevanceBand = Math.min(
      maximumBand,
      Math.floor((item.relevance.value + Number.EPSILON) / profile.relevanceBand),
    );
    const bandFloor = relevanceBand * profile.relevanceBand;
    const bandPosition = clamp((item.relevance.value - bandFloor) / profile.relevanceBand);
    const signal = scoreForView(item, profile.id);
    const innerScore = profile.relevanceWeight * bandPosition +
      profile.signalWeight * signal +
      profile.qualityWeight * item.quality.value;
    item.rank = { relevanceBand, bandPosition, innerScore, view: profile.id, signal };
  }
  accepted.sort((left, right) =>
    right.rank.relevanceBand - left.rank.relevanceBand ||
    right.rank.innerScore - left.rank.innerScore ||
    right.relevance.value - left.relevance.value ||
    scoreForView(right, profile.id) - scoreForView(left, profile.id) ||
    right.quality.value - left.quality.value ||
    String(left.video.bvid ?? left.video.key).localeCompare(String(right.video.bvid ?? right.video.key)),
  );
  accepted.forEach((item, index) => { item.position = index + 1; });

  const admission = resolveAdmissionRules(parsedQuery);
  return {
    mode: profile.id,
    view: profile.id,
    profile,
    parsedQuery,
    ranked: accepted,
    rejected,
    stats: {
      evaluated: evaluated.length,
      accepted: accepted.length,
      rejected: rejected.length,
      threshold: admission.threshold,
      minCoverage: admission.minCoverage,
      relevanceBand: profile.relevanceBand,
    },
  };
}
