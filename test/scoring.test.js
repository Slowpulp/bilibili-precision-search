import test from "node:test";
import assert from "node:assert/strict";

import { MODE_PROFILES, RELEVANCE_ADMISSION } from "../src/constants.js";
import {
  applyGrowthScores,
  applyQualityScores,
  applyTimelinessScores,
  rerankCandidates,
  resolveAdmissionRules,
  scoreRelevance,
} from "../src/scoring.js";
import { parseQuery } from "../src/text.js";

let index = 0;
function video(overrides = {}) {
  index += 1;
  return {
    key: `BV${index}`,
    bvid: `BV${index}`,
    title: "",
    description: "",
    tags: [],
    category: "竞技体育",
    author: { name: "测试UP", mid: index },
    publishedAt: Date.UTC(2024, 0, 1),
    stats: {
      views: 1_000,
      likes: 50,
      favorites: 20,
      coins: 10,
      shares: 2,
      replies: 5,
      danmaku: 10,
    },
    sources: [{ order: "totalrank", orderLabel: "综合", page: 1, position: 1 }],
    url: `https://www.bilibili.com/video/BV${index}`,
    coverUrl: "",
    durationText: "1:00",
    ...overrides,
  };
}

const NOW = Date.UTC(2026, 8, 7, 12);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

test("三个入口是共享召回与准入规则的排序视图", () => {
  assert.deepEqual(Object.keys(MODE_PROFILES), ["quality", "growth", "timeliness"]);
  const profiles = Object.values(MODE_PROFILES);
  for (const profile of profiles) {
    assert.deepEqual(profile.orders, profiles[0].orders);
    assert.equal(profile.pagesPerOrder, profiles[0].pagesPerOrder);
    assert.equal(profile.threshold, profiles[0].threshold);
    assert.equal(profile.minCoverage, profiles[0].minCoverage);
    assert.equal(profile.relevanceBand, 0.05);
    assert.ok(Math.abs(profile.relevanceWeight + profile.signalWeight + profile.qualityWeight - 1) < 1e-12);
  }
});

test("统一准入会按有效查询长度调整门槛", () => {
  assert.deepEqual(resolveAdmissionRules(parseQuery("网球")), {
    ...RELEVANCE_ADMISSION.singleTerm,
    effectiveTermCount: 1,
  });
  assert.equal(resolveAdmissionRules(parseQuery("费德勒 澳网")).threshold, 0.35);
  assert.equal(resolveAdmissionRules(parseQuery("费德勒 2017 澳网 纳达尔")).threshold, 0.3);
});

test("完整标题命中通过全部排序视图，无关高播放结果仍被过滤", () => {
  const relevant = video({ title: "费德勒 2017 澳网决赛 对阵纳达尔" });
  const unrelated = video({
    title: "德约科维奇 2026 训练集锦",
    stats: { views: 90_000_000, likes: 4_000_000, favorites: 500_000, coins: 200_000, shares: 50_000, replies: 20_000, danmaku: 80_000 },
  });
  for (const view of ["quality", "growth", "timeliness"]) {
    const result = rerankCandidates([unrelated, relevant], "费德勒 2017 澳网 纳达尔", view, { now: NOW });
    assert.deepEqual(result.ranked.map((item) => item.video.bvid), [relevant.bvid]);
    assert.equal(result.rejected[0].video.bvid, unrelated.bvid);
  }
});

test("部分关键词命中不能被长期质量挽救", () => {
  const partial = video({
    title: "纳达尔红土十大击球",
    stats: { views: 50_000_000, likes: 2_000_000, favorites: 800_000, coins: 300_000, shares: 80_000, replies: 40_000, danmaku: 90_000 },
  });
  const score = scoreRelevance(partial, "费德勒 2017 澳网 纳达尔");
  assert.equal(score.passes, false);
  assert.ok(score.rejectionReasons.length > 0);
});

test("数字、型号和版本限定词必须在核心字段精确命中", () => {
  assert.equal(scoreRelevance(video({ title: "RTX 4090 显卡完整评测" }), "RTX 5090").passes, false);
  assert.equal(scoreRelevance(video({ title: "RTX 5090 显卡完整评测" }), "RTX 5090").passes, true);
  assert.equal(scoreRelevance(video({ title: "MacBook Pro M4 review" }), "MacBook Pro M4 Max").passes, false);
  assert.equal(scoreRelevance(video({ title: "Galaxy review" }), "Galaxy Ultra").passes, false);
});

test("复合型号允许点号、空格和连字符差异，但不允许代际替换", () => {
  assert.equal(scoreRelevance(video({ title: "NodeJS 教程" }), "Node.js").passes, true);
  assert.equal(scoreRelevance(video({ title: "GPT 4o 使用教程" }), "GPT-4o").passes, true);
  assert.equal(scoreRelevance(video({ title: "RTX-5090 显卡评测" }), "\"RTX 5090\"").passes, true);
  assert.equal(scoreRelevance(video({ title: "Sony A7 III review" }), "Sony A7 IV").passes, false);
  assert.equal(scoreRelevance(video({ title: "Wilson Pro Staff 97 V13 网球拍" }), "Wilson Pro Staff 97 v14").passes, false);
});

test("引号短语必须精确命中允许字段", () => {
  assert.equal(scoreRelevance(video({ title: "Machine Learning tutorial" }), "\"machine learning\"").passes, true);
  const split = video({ title: "Machine tutorial", description: "Learning resources" });
  assert.equal(scoreRelevance(split, "\"machine learning\"").passes, false);
});

test("无空格中文长查询仍可通过字组回退", () => {
  const candidate = video({ title: "费德勒与纳达尔的澳网决赛" });
  assert.equal(scoreRelevance(candidate, "费德勒澳网纳达尔").passes, true);
});

test("排除词保持硬门槛且英文数字使用边界", () => {
  const excluded = video({ title: "费德勒 2017 澳网决赛", tags: ["德约科维奇"] });
  assert.equal(scoreRelevance(excluded, "费德勒 2017 澳网 -德约科维奇").passes, false);
  assert.equal(scoreRelevance(video({ title: "2014 Programming 教程" }), "教程 -pro -14").passes, true);
});

test("只有足够长且高度相似的单词允许有限模糊匹配", () => {
  assert.equal(scoreRelevance(video({ title: "Transformer tutorial for beginners" }), "transformr").passes, true);
  assert.equal(scoreRelevance(video({ title: "Programming tutorial" }), "pro").passes, false);
  assert.equal(scoreRelevance(video({ title: "RTX 4090" }), "RTX 5090").passes, false);
});

test("长期质量与发布时间、年龄和候选池组成无关", () => {
  const stats = { views: 500_000, likes: 30_000, favorites: 12_000, coins: 8_000, shares: 2_000, replies: 1_200, danmaku: 4_000 };
  const oldVideo = video({ title: "同一主题", publishedAt: Date.UTC(2010, 0, 1), stats });
  const newVideo = video({ title: "同一主题", publishedAt: Date.UTC(2026, 8, 7), stats: { ...stats } });
  const alone = [{ video: oldVideo }];
  const inPool = [{ video: oldVideo }, { video: video({ stats: { views: 1, likes: 0, favorites: 0, coins: 0, shares: 0, replies: 0, danmaku: 0 } }) }];
  applyQualityScores(alone);
  applyQualityScores(inPool);
  const pair = [{ video: oldVideo }, { video: newVideo }];
  applyQualityScores(pair);
  assert.equal(alone[0].quality.value, inPool[0].quality.value);
  assert.equal(pair[0].quality.value, pair[1].quality.value);
  assert.equal(pair[0].quality.components.some((component) => ["freshness", "velocity", "age"].includes(component.id)), false);
});

test("长期绝对沉淀较强的视频取得更高质量分", () => {
  const low = video({ stats: { views: 2_000, likes: 80, favorites: 20, coins: 10, shares: 2, replies: 5, danmaku: 10 } });
  const high = video({ stats: { views: 2_000_000, likes: 150_000, favorites: 90_000, coins: 50_000, shares: 20_000, replies: 8_000, danmaku: 30_000 } });
  const items = [{ video: low }, { video: high }];
  applyQualityScores(items);
  assert.ok(items[1].quality.value > items[0].quality.value);
  assert.ok(items[1].quality.absolute > items[0].quality.absolute);
});

test("质量统计缺失会降低完整度并向中性分收缩", () => {
  const complete = [{ video: video({ stats: { views: 1, likes: 0, favorites: 0, coins: 0, shares: 0, replies: 0, danmaku: 0 } }) }];
  const missing = [{ video: video({ stats: { views: 1 } }) }];
  applyQualityScores(complete);
  applyQualityScores(missing);
  assert.ok(missing[0].quality.completeness < complete[0].quality.completeness);
  assert.ok(Math.abs(missing[0].quality.value - 0.5) < Math.abs(complete[0].quality.value - 0.5));
});

test("增长分优先使用历史快照真实增量并混合生命周期增速", () => {
  const candidate = video({
    publishedAt: NOW - 30 * DAY_MS,
    stats: { views: 200_000, likes: 10_000, favorites: 4_000, coins: 2_000, shares: 600, replies: 500, danmaku: 2_000 },
  });
  const snapshots = new Map([[candidate.bvid, [{
    capturedAt: NOW - 6 * 60 * 60 * 1_000,
    stats: { views: 170_000, likes: 8_500, favorites: 3_400, coins: 1_700, shares: 500, replies: 420, danmaku: 1_700 },
  }]]]);
  const items = [{ video: candidate }];
  applyGrowthScores(items, snapshots, NOW);
  assert.equal(items[0].growth.status, "observed");
  assert.equal(items[0].growth.observationHours, 6);
  assert.ok(items[0].growth.components.find((component) => component.id === "views").actualPerDay > 0);
  assert.match(items[0].growth.positiveReasons.join(" "), /真实增量/);
});

test("快照太新时回退为低置信度生命周期估算", () => {
  const candidate = video({ publishedAt: NOW - 10 * DAY_MS });
  const snapshots = new Map([[candidate.bvid, [{ capturedAt: NOW - 5 * 60 * 1_000, stats: { ...candidate.stats } }]]]);
  const items = [{ video: candidate }];
  applyGrowthScores(items, snapshots, NOW);
  assert.equal(items[0].growth.status, "estimated");
  assert.ok(items[0].growth.confidence <= 0.35);
  assert.match(items[0].growth.negativeReasons.join(" "), /低置信度估算/);
});

test("统计回退不会被误判为负增长", () => {
  const candidate = video({ publishedAt: NOW - 10 * DAY_MS, stats: { views: 900, likes: 40 } });
  const snapshots = new Map([[candidate.bvid, [{ capturedAt: NOW - 6 * HOUR_MS, stats: { views: 1_000, likes: 50 } }]]]);
  const items = [{ video: candidate }];
  applyGrowthScores(items, snapshots, NOW);
  assert.equal(items[0].growth.status, "estimated");
  assert.equal(items[0].growth.components.find((component) => component.id === "views").actualPerDay, null);
});

test("没有快照时增长是明确标记的低置信度估算", () => {
  const items = [{ video: video({ publishedAt: NOW - 20 * DAY_MS }) }];
  applyGrowthScores(items, null, NOW);
  assert.equal(items[0].growth.status, "estimated");
  assert.ok(items[0].growth.value > 0 && items[0].growth.value < 1);
  assert.match(items[0].growth.negativeReasons.join(" "), /历史快照/);
});

test("时效分以发布时间和正在观看数计算，缺失在线数不视为零", () => {
  const oldVideo = video({ publishedAt: NOW - 500 * DAY_MS });
  const newVideo = video({ publishedAt: NOW - 2 * DAY_MS });
  const items = [{ video: oldVideo }, { video: newVideo }];
  applyTimelinessScores(items, parseQuery("网球"), null, NOW);
  assert.ok(items[1].timeliness.value > items[0].timeliness.value);
  assert.equal(items[0].timeliness.onlineStatus, "unavailable");
  assert.equal(items[0].timeliness.components.find((component) => component.id === "online").value, null);
});

test("未采样在线人数保持中性，不会退化为满分的纯发布时间排序", () => {
  const missing = video({ bvid: "BV1MISSING01", publishedAt: NOW - DAY_MS });
  const cold = video({ bvid: "BV1COLD00001", publishedAt: NOW - DAY_MS });
  const hot = video({ bvid: "BV1HOT000001", publishedAt: NOW - DAY_MS });
  const items = [{ video: missing }, { video: cold }, { video: hot }];
  applyTimelinessScores(items, parseQuery("网球"), new Map([
    [cold.bvid, 0],
    [hot.bvid, "1.7万+"],
  ]), NOW);
  assert.ok(items[0].timeliness.value > items[1].timeliness.value);
  assert.ok(items[0].timeliness.value < items[2].timeliness.value);
  assert.ok(items[0].timeliness.value < 0.85);
});

test("中文单位在线人数能被解析并提高同发布时间视频的时效分", () => {
  const quiet = video({ publishedAt: NOW - 5 * DAY_MS });
  const hot = video({ publishedAt: NOW - 5 * DAY_MS });
  const online = new Map([[quiet.bvid, "2"], [hot.bvid, "1.7万+"]]);
  const items = [{ video: quiet }, { video: hot }];
  applyTimelinessScores(items, parseQuery("网球"), online, NOW);
  assert.equal(items[1].timeliness.onlineCount, 17_000);
  assert.ok(items[1].timeliness.value > items[0].timeliness.value);
});

test("全端在线隐藏时可回退使用网页端在线数", () => {
  const candidate = video({ publishedAt: NOW - 5 * DAY_MS });
  const items = [{ video: candidate }];
  applyTimelinessScores(items, parseQuery("网球"), new Map([[
    candidate.bvid,
    { total: null, web: 321, scope: "page" },
  ]]), NOW);
  assert.equal(items[0].timeliness.onlineStatus, "available");
  assert.equal(items[0].timeliness.onlineCount, 321);
});

test("时效半衰期会根据查询意图调整", () => {
  const candidate = video({ publishedAt: NOW - 100 * DAY_MS });
  const latest = [{ video: candidate }];
  const normal = [{ video: candidate }];
  const historic = [{ video: candidate }];
  applyTimelinessScores(latest, parseQuery("最新 网球"), null, NOW);
  applyTimelinessScores(normal, parseQuery("网球"), null, NOW);
  applyTimelinessScores(historic, parseQuery("2017 澳网"), null, NOW);
  assert.equal(latest[0].timeliness.halfLifeDays, 30);
  assert.equal(normal[0].timeliness.halfLifeDays, 180);
  assert.equal(historic[0].timeliness.halfLifeDays, 730);
});

test("时效指标本身不内嵌长期质量", () => {
  const base = { title: "同题视频", publishedAt: NOW - 5 * DAY_MS };
  const low = video({ ...base, stats: { views: 100, likes: 1, favorites: 0, coins: 0, shares: 0, replies: 0, danmaku: 0 } });
  const high = video({ ...base, stats: { views: 10_000_000, likes: 500_000, favorites: 200_000, coins: 100_000, shares: 50_000, replies: 20_000, danmaku: 80_000 } });
  const items = [{ video: low }, { video: high }];
  applyTimelinessScores(items, parseQuery("同题视频"), null, NOW);
  assert.equal(items[0].timeliness.value, items[1].timeliness.value);
});

test("五分相关性档位是不可跨越的第一排序键", () => {
  const strongest = video({
    title: "费德勒 2017 澳网 纳达尔 决赛完整回放",
    stats: { views: 20, likes: 1, favorites: 0, coins: 0, shares: 0, replies: 0, danmaku: 0 },
  });
  const weaker = video({
    title: "费德勒与纳达尔经典比赛",
    tags: ["2017", "澳网"],
    stats: { views: 90_000_000, likes: 5_000_000, favorites: 900_000, coins: 500_000, shares: 100_000, replies: 90_000, danmaku: 300_000 },
  });
  const result = rerankCandidates([weaker, strongest], "费德勒 2017 澳网 纳达尔", "quality", { now: NOW });
  assert.equal(result.ranked.length, 2);
  assert.equal(result.ranked[0].video.bvid, strongest.bvid);
  assert.ok(result.ranked[0].rank.relevanceBand > result.ranked[1].rank.relevanceBand);
});

test("同一相关性档内按所选质量或增长视图改变顺序", () => {
  const settled = video({
    title: "网球教程",
    publishedAt: NOW - 1_000 * DAY_MS,
    stats: { views: 5_000_000, likes: 300_000, favorites: 150_000, coins: 100_000, shares: 30_000, replies: 15_000, danmaku: 50_000 },
  });
  const rising = video({
    title: "网球教程",
    publishedAt: NOW - 10 * DAY_MS,
    stats: { views: 100_000, likes: 6_000, favorites: 2_500, coins: 1_200, shares: 600, replies: 350, danmaku: 1_200 },
  });
  const snapshots = new Map([
    [settled.bvid, [{ capturedAt: NOW - 6 * HOUR_MS, stats: { ...settled.stats } }]],
    [rising.bvid, [{ capturedAt: NOW - 6 * HOUR_MS, stats: { views: 60_000, likes: 4_000, favorites: 1_500, coins: 700, shares: 300, replies: 200, danmaku: 700 } }]],
  ]);
  const quality = rerankCandidates([rising, settled], "网球教程", "quality", { now: NOW, snapshots });
  const growth = rerankCandidates([rising, settled], "网球教程", "growth", { now: NOW, snapshots });
  assert.equal(quality.ranked[0].video.bvid, settled.bvid);
  assert.equal(growth.ranked[0].video.bvid, rising.bvid);
});

test("每个排序结果都公开 Q、G、T 和可解释状态", () => {
  const candidate = video({ title: "网球教程", publishedAt: NOW - DAY_MS });
  const result = rerankCandidates([candidate], "网球教程", "timeliness", {
    now: NOW,
    onlineByBvid: new Map([[candidate.bvid, 800]]),
  });
  const item = result.ranked[0];
  assert.ok(Number.isFinite(item.quality.value));
  assert.ok(Number.isFinite(item.growth.value));
  assert.ok(Number.isFinite(item.timeliness.value));
  assert.equal(item.growth.status, "estimated");
  assert.equal(item.timeliness.onlineStatus, "available");
  assert.equal(item.rank.view, "timeliness");
});
