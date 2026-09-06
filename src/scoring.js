import { getModeProfile } from "./constants.js";
import {
  bestSubstringSimilarity,
  compactText,
  containsOrderedTerms,
  ngramContainment,
  normalizeText,
  parseQuery,
} from "./text.js";

const FIELD_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "title", label: "标题", strength: 1 }),
  Object.freeze({ id: "tags", label: "标签", strength: 0.78 }),
  Object.freeze({ id: "description", label: "简介", strength: 0.48 }),
  Object.freeze({ id: "author", label: "UP主", strength: 0.4 }),
  Object.freeze({ id: "category", label: "分区", strength: 0.28 }),
]);

const CORE_FIELDS = new Set(["title", "tags", "description"]);
const VERSION_QUALIFIERS = new Set([
  "pro", "max", "ultra", "mini", "plus", "air", "se", "ti", "super", "xt",
  "edition", "mark", "mk", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "版", "代",
]);
const QUALITY_METRICS = Object.freeze([
  Object.freeze({ id: "views", label: "播放", weight: 0.16, rate: false }),
  Object.freeze({ id: "likes", label: "点赞", weight: 0.2, rate: true }),
  Object.freeze({ id: "favorites", label: "收藏", weight: 0.18, rate: true }),
  Object.freeze({ id: "coins", label: "投币", weight: 0.16, rate: true }),
  Object.freeze({ id: "replies", label: "评论", weight: 0.09, rate: true }),
  Object.freeze({ id: "danmaku", label: "弹幕", weight: 0.07, rate: true }),
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
  const flexibleInner = [...term.compact]
    .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s._-]*");
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
  const affinity = parsedQuery.compact.length >= 4
    ? ngramContainment(parsedQuery.compact, video.title)
    : 0;
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

function exactPhrasePasses(parsedQuery, video, mode) {
  if (parsedQuery.exactPhrases.length === 0) return true;
  const fieldIds = mode === "strict" ? ["title", "tags"] : ["title", "tags", "description", "author"];
  return parsedQuery.exactPhrases.every((phrase) =>
    fieldIds.some((fieldId) => hasExactTerm(fieldText(video, fieldId), { text: normalizeText(phrase), compact: compactText(phrase) })),
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

function modelTermPasses(matchedTerms, mode) {
  const modelTerms = matchedTerms.filter((item) => /\d/.test(item.term));
  const qualifiers = matchedTerms.filter((item) => VERSION_QUALIFIERS.has(item.term.toLocaleLowerCase()));
  if (modelTerms.length === 0 && qualifiers.length === 0) return true;
  const required = [...modelTerms, ...qualifiers];
  return required.every((item) => item.matches.some((match) => match.exact && CORE_FIELDS.has(match.field)));
}

export function scoreRelevance(video, queryOrParsed, mode = "standard") {
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

  const missingTerms = matchedTerms.filter((item) => item.matches.length === 0 && !item.auxiliary).map((item) => item.term);
  const negative = negativeMatch(parsedQuery, video);
  const phrasePass = exactPhrasePasses(parsedQuery, video, mode);
  const modelPass = authorExact && mode !== "strict" ? true : modelTermPasses(matchedTerms, mode);
  const hasTitleOrTag = matchedTerms.some((item) => item.matches.some((match) => match.field === "title" || match.field === "tags"));
  const descriptionPhraseException = phrase.field === "description" && phrase.score >= 0.65;
  const corePass = mode === "strict"
    ? titleCoverage >= 0.45
    : mode === "standard"
      ? hasTitleOrTag || descriptionPhraseException || authorExact
      : coreCoverage > 0 || authorExact;

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
  const nonTitleTerms = matchedTerms
    .filter((item) => item.matches.length > 0 && !item.matches.some((match) => match.field === "title"))
    .map((item) => item.term);
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
      fuzzy: item.matches.some((match) => match.fuzzy),
    })),
    missingTerms,
    positiveReasons,
    negativeReasons,
    rejectionReasons,
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
  return Math.max(0, (now - publishedAt) / 86_400_000);
}

function validStat(video, metricId) {
  const value = video.stats?.[metricId];
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value));
}

function qualityContext(videos, now) {
  const categoryCounts = new Map();
  for (const video of videos) {
    const key = video.category || "未分区";
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
  }
  const contextKey = (video) => (categoryCounts.get(video.category || "未分区") >= 25 ? video.category || "未分区" : "__all__");
  const groups = new Map([["__all__", videos]]);
  for (const [category, count] of categoryCounts) {
    if (count >= 25) groups.set(category, videos.filter((video) => (video.category || "未分区") === category));
  }

  const prepared = new Map();
  for (const [key, members] of groups) {
    const viewValues = members.map((video) => validStat(video, "views")).filter((value) => value !== null);
    const priorViews = clamp(median(viewValues) * 0.02, 500, 10_000);
    const metrics = {};
    for (const metric of QUALITY_METRICS) {
      const rows = members.map((video) => {
        const count = validStat(video, metric.id);
        const views = validStat(video, "views");
        const age = ageDays(video, now);
        return { video, count, views, age };
      }).filter((row) => row.count !== null);
      const rates = metric.rate
        ? rows.filter((row) => row.views !== null).map((row) => row.count / Math.max(row.views, row.count, 1))
        : [];
      const baseRate = median(rates);
      const values = rows.map((row) => {
        const velocityDivisor = Math.pow((row.age ?? 365) + 7, 0.35);
        const countLog = Math.log1p(row.count);
        const velocityLog = Math.log1p(row.count / velocityDivisor);
        const rate = metric.rate && row.views !== null
          ? (row.count + priorViews * baseRate) / (Math.max(row.views, row.count, 1) + priorViews)
          : null;
        return { video: row.video, countLog, velocityLog, rate };
      });
      metrics[metric.id] = {
        values,
        countLogs: values.map((item) => item.countLog).sort((a, b) => a - b),
        velocityLogs: values.map((item) => item.velocityLog).sort((a, b) => a - b),
        rates: values.map((item) => item.rate).filter((value) => value !== null).sort((a, b) => a - b),
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
    const countSignal = 0.6 * percentile(preparedMetric.countLogs, item.countLog) +
      0.4 * percentile(preparedMetric.velocityLogs, item.velocityLog);
    const rateSignal = metric.rate && item.rate !== null
      ? percentile(preparedMetric.rates, item.rate)
      : null;
    const value = rateSignal === null ? countSignal : 0.45 * countSignal + 0.55 * rateSignal;
    components.push({ id: metric.id, label: metric.label, weight: metric.weight, value, countSignal, rateSignal });
  }
  const age = ageDays(video, now);
  if (freshness.enabled && age !== null) {
    const value = (20 + 80 * Math.pow(2, -age / freshness.halfLife)) / 100;
    components.push({ id: "freshness", label: "时效", weight: 0.14, value, countSignal: value, rateSignal: null });
  }
  const activeWeight = QUALITY_METRICS.reduce((sum, metric) => sum + metric.weight, 0) + (freshness.enabled ? 0.14 : 0);
  const availableWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const raw = availableWeight ? weightedSum(components) / availableWeight : 0.5;
  const completeness = activeWeight ? availableWeight / activeWeight : 0;
  const value = clamp(0.5 + (raw - 0.5) * (0.4 + 0.6 * completeness));

  const strongest = [...components].sort((a, b) => b.value - a.value).slice(0, 2);
  const positiveReasons = strongest.filter((component) => component.value >= 0.7).map((component) =>
    component.id === "freshness"
      ? "发布时间较近"
      : `${component.label}综合表现处于比较候选前列`,
  );
  const negativeReasons = [];
  if (completeness < 0.7) negativeReasons.push("部分互动统计缺失，质量分已向中性收缩");
  if (!positiveReasons.length) positiveReasons.push("质量分仅用于相近相关性结果间的辅助排序");
  return { value, raw, completeness, components, positiveReasons, negativeReasons };
}

export function applyQualityScores(scoredVideos, parsedQuery, now = Date.now()) {
  if (!scoredVideos.length) return scoredVideos;
  const { contextKey, prepared } = qualityContext(scoredVideos.map((item) => item.video), now);
  const freshness = freshnessPolicy(parsedQuery, now);
  for (const item of scoredVideos) {
    item.quality = scoreOneQuality(item.video, prepared.get(contextKey(item.video)), freshness, now);
  }
  return scoredVideos;
}

export function rerankCandidates(videos, query, mode = "standard", options = {}) {
  const profile = getModeProfile(mode);
  const parsedQuery = parseQuery(query);
  const evaluated = videos.map((video) => ({
    video,
    relevance: scoreRelevance(video, parsedQuery, mode),
    quality: null,
    rank: null,
  }));
  const accepted = evaluated.filter((item) => item.relevance.passes);
  const rejected = evaluated.filter((item) => !item.relevance.passes);
  applyQualityScores(accepted, parsedQuery, options.now ?? Date.now());

  for (const item of accepted) {
    const relevanceBand = Math.floor((item.relevance.value + Number.EPSILON) / profile.relevanceBand);
    const innerScore = profile.relevanceWeight * item.relevance.value +
      (1 - profile.relevanceWeight) * item.quality.value;
    item.rank = { relevanceBand, innerScore };
  }
  accepted.sort((left, right) =>
    right.rank.relevanceBand - left.rank.relevanceBand ||
    right.rank.innerScore - left.rank.innerScore ||
    right.relevance.value - left.relevance.value ||
    right.quality.value - left.quality.value ||
    (right.video.publishedAt ?? 0) - (left.video.publishedAt ?? 0) ||
    String(left.video.bvid ?? left.video.key).localeCompare(String(right.video.bvid ?? right.video.key)),
  );
  accepted.forEach((item, index) => { item.position = index + 1; });

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
      minCoverage: profile.minCoverage,
    },
  };
}
