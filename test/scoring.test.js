import test from "node:test";
import assert from "node:assert/strict";

import { applyQualityScores, rerankCandidates, scoreRelevance } from "../src/scoring.js";
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
    stats: { views: 1000, likes: 50, favorites: 20, coins: null, replies: 5, danmaku: 10 },
    sources: [{ order: "totalrank", orderLabel: "综合", page: 1, position: 1 }],
    url: `https://www.bilibili.com/video/BV${index}`,
    coverUrl: "",
    durationText: "1:00",
    ...overrides,
  };
}

test("完整标题命中通过三种模式，无关高播放结果仍被过滤", () => {
  const relevant = video({ title: "费德勒 2017 澳网决赛 对阵纳达尔" });
  const unrelated = video({
    title: "德约科维奇 2026 训练集锦",
    stats: { views: 90_000_000, likes: 4_000_000, favorites: 500_000, coins: null, replies: 20_000, danmaku: 80_000 },
  });
  for (const mode of ["strict", "standard", "exploration"]) {
    const result = rerankCandidates([unrelated, relevant], "费德勒 2017 澳网 纳达尔", mode, { now: Date.UTC(2026, 8, 6) });
    assert.deepEqual(result.ranked.map((item) => item.video.bvid), [relevant.bvid]);
    assert.equal(result.rejected[0].video.bvid, unrelated.bvid);
  }
});

test("部分关键词命中不能被高质量挽救", () => {
  const partial = video({ title: "纳达尔红土十大击球", stats: { views: 50_000_000, likes: 2_000_000, favorites: 800_000, coins: null, replies: 40_000, danmaku: 90_000 } });
  const score = scoreRelevance(partial, "费德勒 2017 澳网 纳达尔", "exploration");
  assert.equal(score.passes, false);
  assert.ok(score.rejectionReasons.length > 0);
});

test("数字和型号必须精确命中核心字段", () => {
  const wrongModel = video({ title: "RTX 4090 显卡完整评测", tags: ["显卡"] });
  const rightModel = video({ title: "RTX 5090 显卡完整评测", tags: ["显卡"] });
  assert.equal(scoreRelevance(wrongModel, "RTX 5090", "standard").passes, false);
  assert.equal(scoreRelevance(rightModel, "RTX 5090", "standard").passes, true);
});

test("探索模式也不能用错误型号替代明确型号", () => {
  const wrongModel = video({ title: "2024 RTX 4090 显卡完整评测" });
  assert.equal(scoreRelevance(wrongModel, "2024 RTX 5090", "exploration").passes, false);
});

test("产品查询中的版本限定词不能遗漏", () => {
  const candidate = video({ title: "MacBook Pro M4 review" });
  assert.equal(scoreRelevance(candidate, "MacBook Pro M4 Max", "strict").passes, false);
  assert.equal(scoreRelevance(candidate, "MacBook Pro M4 Max", "standard").passes, false);
  assert.equal(scoreRelevance(video({ title: "MacBook Pro review" }), "MacBook Pro Max", "standard").passes, false);
  assert.equal(scoreRelevance(video({ title: "Galaxy review" }), "Galaxy Ultra", "exploration").passes, false);
});

test("复合型号忽略点号、空格和连字符差异", () => {
  assert.equal(scoreRelevance(video({ title: "NodeJS 教程" }), "Node.js", "standard").passes, true);
  assert.equal(scoreRelevance(video({ title: "GPT 4o 使用教程" }), "GPT-4o", "standard").passes, true);
  assert.equal(scoreRelevance(video({ title: "RTX-5090 显卡评测" }), '"RTX 5090"', "standard").passes, true);
  const racket = video({ title: "【24H评测】Wilson Pro Staff 97 V14 网球拍评测" });
  assert.equal(scoreRelevance(racket, "Wilson Pro Staff 97 v14", "strict").passes, true);
  assert.equal(scoreRelevance(racket, "Wilson Pro Staff 97 v14", "standard").passes, true);
});

test("引号内的英文多词短语允许正常空格分隔", () => {
  const candidate = video({ title: "Machine Learning tutorial" });
  for (const mode of ["strict", "standard", "exploration"]) {
    assert.equal(scoreRelevance(candidate, '"machine learning"', mode).passes, true);
  }
});

test("罗马数字版本不能被另一代替代", () => {
  const candidate = video({ title: "Sony A7 III review" });
  assert.equal(scoreRelevance(candidate, "Sony A7 IV", "standard").passes, false);
});

test("无空格中文长查询在标准模式可通过字组回退匹配", () => {
  const candidate = video({ title: "费德勒与纳达尔的澳网决赛" });
  assert.equal(scoreRelevance(candidate, "费德勒澳网纳达尔", "standard").passes, true);
});

test("排除词是硬门槛", () => {
  const candidate = video({ title: "费德勒 2017 澳网决赛", tags: ["德约科维奇"] });
  const score = scoreRelevance(candidate, "费德勒 2017 澳网 -德约科维奇", "exploration");
  assert.equal(score.passes, false);
  assert.match(score.rejectionReasons.join(" "), /排除词/);
});

test("英文和数字排除词使用边界，不误伤较长单词或年份", () => {
  const candidate = video({ title: "2014 Programming 教程" });
  assert.equal(scoreRelevance(candidate, "教程 -pro -14", "exploration").passes, true);
});

test("拼写近似只在探索模式启用", () => {
  const candidate = video({ title: "Transformer tutorial for beginners" });
  assert.equal(scoreRelevance(candidate, "transformr", "standard").passes, false);
  assert.equal(scoreRelevance(candidate, "transformr", "exploration").passes, true);
});

test("短英文词不会模糊命中更长单词", () => {
  assert.equal(scoreRelevance(video({ title: "Programming tutorial" }), "pro", "exploration").passes, false);
});

test("查询指定往年时禁用时效项", () => {
  const oldVideo = video({ title: "2017 澳网", publishedAt: Date.UTC(2017, 0, 1) });
  const newVideo = video({ title: "2017 澳网", publishedAt: Date.UTC(2026, 0, 1) });
  const parsed = parseQuery("2017 澳网");
  const items = [oldVideo, newVideo].map((item) => ({ video: item }));
  applyQualityScores(items, parsed, Date.UTC(2026, 8, 6));
  assert.equal(items[0].quality.components.some((component) => component.id === "freshness"), false);
  assert.equal(items[1].quality.components.some((component) => component.id === "freshness"), false);
  assert.ok(Number.isFinite(items[0].quality.value));
  assert.ok(Number.isFinite(items[1].quality.value));
});

test("质量不能跨越相关性档反超", () => {
  const strongest = video({
    title: "费德勒 2017 澳网 纳达尔 决赛完整回放",
    stats: { views: 20, likes: 1, favorites: 0, coins: null, replies: 0, danmaku: 0 },
  });
  const weaker = video({
    title: "费德勒与纳达尔经典比赛",
    tags: ["2017", "澳网"],
    stats: { views: 90_000_000, likes: 5_000_000, favorites: 900_000, coins: null, replies: 90_000, danmaku: 300_000 },
  });
  const result = rerankCandidates([weaker, strongest], "费德勒 2017 澳网 纳达尔", "standard", { now: Date.UTC(2026, 8, 6) });
  assert.equal(result.ranked.length, 2);
  assert.equal(result.ranked[0].video.bvid, strongest.bvid);
  assert.ok(result.ranked[0].rank.relevanceBand > result.ranked[1].rank.relevanceBand);
});

test("唯一候选的质量百分位保持中性", () => {
  const only = video({ title: "唯一候选" });
  const items = [{ video: only }];
  applyQualityScores(items, parseQuery("唯一候选"), Date.UTC(2026, 8, 6));
  assert.ok(Math.abs(items[0].quality.value - 0.5) < 0.08);
});
