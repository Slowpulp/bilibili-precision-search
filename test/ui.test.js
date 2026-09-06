import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { PrecisionSearchView } from "../src/ui.js";

function createDom() {
  return new JSDOM(`<!doctype html><html><body>
    <div id="app">
      <div class="search-tabs"><nav><ul>
        <li>综合</li><li>视频</li><li>番剧</li><li>影视</li><li>直播</li><li>专栏</li><li>用户</li>
      </ul></nav></div>
      <div class="search-content"><p id="native-result">原生结果</p></div>
    </div>
  </body></html>`, { url: "https://search.bilibili.com/all?keyword=test", pretendToBeVisual: true });
}

function resultItem(index = 1, overrides = {}) {
  const item = {
    video: {
      key: `BV${index}`,
      bvid: `BV${index}`,
      title: `视频 ${index}`,
      author: { name: "UP" },
      category: "科技",
      publishedAt: Date.UTC(2026, 0, 1),
      stats: { views: 10_000, likes: 500, favorites: 100, coins: 80, replies: 30 },
      sources: [{ orderLabel: "综合" }],
      url: `https://www.bilibili.com/video/BV${index}`,
      coverUrl: "",
      durationText: "1:00",
    },
    relevance: {
      value: 0.8,
      positiveReasons: ["标题命中核心关键词"],
      negativeReasons: [],
      matchedTerms: [],
    },
    quality: { value: 0.62, completeness: 0.9, positiveReasons: ["收藏长期沉淀较好"], negativeReasons: [] },
    growth: { value: 0.54, completeness: 0.7, status: "estimated", positiveReasons: [], negativeReasons: [] },
    timeliness: { value: 0.48, completeness: 0.6, onlineStatus: "unavailable", onlineCount: null, positiveReasons: [], negativeReasons: [] },
  };
  return { ...item, ...overrides };
}

test("独立 Shadow DOM 面板不会删除或改写原生搜索结果", () => {
  const dom = createDom();
  const nativeResult = dom.window.document.querySelector("#native-result");
  const nativeHtml = nativeResult.outerHTML;
  const view = new PrecisionSearchView({ documentRef: dom.window.document }).mount();
  view.showPanel({ focus: false });
  assert.ok(dom.window.document.querySelector("#bps-host"));
  assert.ok(view.shadow.querySelector(".panel"));
  assert.equal(nativeResult.outerHTML, nativeHtml);
  view.hidePanel({ restoreFocus: false });
  assert.equal(nativeResult.outerHTML, nativeHtml);
});

test("只呈现长期质量、增长趋势、最新热播三个排序标签并通知控制器", () => {
  const dom = createDom();
  const selections = [];
  const view = new PrecisionSearchView({
    documentRef: dom.window.document,
    handlers: { onSortChange: (sort) => selections.push(sort) },
  }).mount();
  const tabs = [...view.shadow.querySelectorAll(".sort-button")];
  assert.deepEqual(tabs.map((tab) => tab.textContent), ["长期质量", "增长趋势", "最新热播"]);
  assert.equal(view.shadow.querySelector(".mode-group"), null);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(tabs[0].tabIndex, 0);
  assert.equal(tabs[1].tabIndex, -1);
  tabs[1].click();
  assert.deepEqual(selections, ["growth"]);
  assert.equal(view.sort, "growth");
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.match(view.refs.sortNote.textContent, /真实增速/);
});

test("排序标签支持方向键切换和 roving tabindex", () => {
  const dom = createDom();
  const selections = [];
  const view = new PrecisionSearchView({
    documentRef: dom.window.document,
    handlers: { onSortChange: (sort) => selections.push(sort) },
  }).mount();
  const qualityTab = view.shadow.querySelector('[data-sort="quality"]');
  qualityTab.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(view.sort, "growth");
  assert.deepEqual(selections, ["growth"]);
  assert.equal(view.shadow.activeElement?.dataset.sort, "growth");
});

test("新查询加载期间切换排序不会重新渲染上一查询的结果", () => {
  const dom = createDom();
  const view = new PrecisionSearchView({ documentRef: dom.window.document }).mount();
  view.setResults({ view: "quality", ranked: [resultItem()], rejected: [] }, {
    rawCount: 1,
    validCount: 1,
    uniqueCount: 1,
    errors: [],
  });
  assert.equal(view.shadow.querySelectorAll(".card").length, 1);
  view.setLoading({ stage: "recall", completed: 0, total: 15 });
  view.shadow.querySelector('[data-sort="growth"]').click();
  assert.equal(view.result, null);
  assert.equal(view.shadow.querySelectorAll(".card").length, 0);
});

test("结果标题按纯文本渲染，不执行接口 HTML", () => {
  const dom = createDom();
  const view = new PrecisionSearchView({ documentRef: dom.window.document }).mount();
  view.setResults({
    ranked: [{
      video: {
        key: "BV1",
        bvid: "BV1",
        title: '<img src=x onerror="globalThis.pwned=1">安全标题',
        author: { name: "UP" },
        category: "科技",
        publishedAt: Date.UTC(2026, 0, 1),
        stats: { views: 1, likes: 1, favorites: 1, replies: 0 },
        sources: [{ orderLabel: "综合" }],
        url: "https://www.bilibili.com/video/BV1",
        coverUrl: "",
        durationText: "1:00",
      },
      relevance: {
        value: 0.9,
        positiveReasons: ["完整查询命中标题"],
        negativeReasons: [],
        matchedTerms: [{ term: "安全", fields: ["标题"], fuzzy: false }],
      },
      quality: { value: 0.6, completeness: 0.8, positiveReasons: [], negativeReasons: [] },
      growth: { value: 0.4, completeness: 0.5, status: "estimated", positiveReasons: [], negativeReasons: [] },
      timeliness: { value: 0.3, completeness: 0.4, onlineStatus: "unavailable", positiveReasons: [], negativeReasons: [] },
    }],
    rejected: [],
  }, {
    rawCount: 1,
    validCount: 1,
    uniqueCount: 1,
    errors: [],
  });
  assert.equal(view.shadow.querySelector(".card-title").textContent, '<img src=x onerror="globalThis.pwned=1">安全标题');
  assert.equal(view.shadow.querySelector(".card-title img"), null);
});

test("结果卡同时显示相关性、Q/G/T、完整度、增长状态与在线采样说明", () => {
  const dom = createDom();
  const view = new PrecisionSearchView({ documentRef: dom.window.document }).mount();
  view.setSort("growth", { render: false });
  const item = resultItem(9, {
    dataCompleteness: 0.82,
    growth: {
      value: 0.73,
      completeness: 0.75,
      status: "observed",
      observationHours: 6,
      positiveReasons: ["近 6 小时收藏增长领先"],
      negativeReasons: [],
    },
    timeliness: {
      value: 0.68,
      completeness: 0.8,
      onlineStatus: "available",
      onlineCount: 321,
      positiveReasons: ["发布时间较近"],
      negativeReasons: [],
    },
  });
  view.setResults({ view: "growth", ranked: [item], rejected: [] }, {
    rawCount: 1,
    validCount: 1,
    uniqueCount: 1,
    errors: [],
  });
  const scores = view.shadow.querySelector(".scores").textContent;
  assert.match(scores, /相关 80/);
  assert.match(scores, /Q 62/);
  assert.match(scores, /G 73/);
  assert.match(scores, /T 68/);
  assert.ok(view.shadow.querySelector(".score-growth.is-selected"));
  assert.match(view.shadow.querySelector(".data-signals").textContent, /数据 82%/);
  assert.match(view.shadow.querySelector(".data-signals").textContent, /真实增速/);
  assert.match(view.shadow.querySelector(".data-signals").textContent, /在线已采样 321/);
  assert.match(view.shadow.querySelector(".reason-primary").textContent, /增长趋势：近 6 小时收藏增长领先/);
  const explanationText = view.shadow.querySelector(".explanations").textContent;
  assert.match(explanationText, /长期质量 Q 62/);
  assert.match(explanationText, /增长趋势 G 73/);
  assert.match(explanationText, /最新热播 T 68/);
  assert.match(explanationText, /在线采样：321 人正在观看/);
});

test("快照或在线人数缺失时明确显示积累中和在线采样缺失", () => {
  const dom = createDom();
  const view = new PrecisionSearchView({ documentRef: dom.window.document }).mount();
  const item = resultItem(10, {
    growth: { value: null, completeness: 0, status: "unavailable", positiveReasons: [], negativeReasons: [] },
    timeliness: { value: 0.2, completeness: 0.3, onlineStatus: "unavailable", onlineCount: null, positiveReasons: [], negativeReasons: [] },
  });
  view.setResults({ view: "quality", ranked: [item], rejected: [] }, {
    rawCount: 1,
    validCount: 1,
    uniqueCount: 1,
    errors: [],
  });
  assert.match(view.shadow.querySelector(".data-signals").textContent, /积累中/);
  assert.match(view.shadow.querySelector(".data-signals").textContent, /在线采样缺失/);
  assert.match(view.shadow.querySelector(".score-growth").textContent, /G —/);
  assert.match(view.shadow.querySelector(".explanations").textContent, /历史快照不足/);
});

test("数据补全失败单独提示降级，不误称为候选召回失败", () => {
  const dom = createDom();
  const view = new PrecisionSearchView({ documentRef: dom.window.document }).mount();
  view.setResults({ view: "quality", ranked: [resultItem(11)], rejected: [] }, {
    rawCount: 1,
    validCount: 1,
    uniqueCount: 1,
    errors: [],
    enrichmentErrors: [{ stage: "online", bvid: "BV11" }],
  });
  assert.equal(view.refs.warning.hidden, false);
  assert.match(view.refs.warning.textContent, /1 项详情或在线数据补全失败/);
  assert.doesNotMatch(view.refs.warning.textContent, /候选请求未完成/);
});

test("分页只创建当前页的 24 张卡片", () => {
  const dom = createDom();
  const view = new PrecisionSearchView({ documentRef: dom.window.document }).mount();
  const ranked = Array.from({ length: 25 }, (_, itemIndex) => resultItem(itemIndex));
  view.setResults({ ranked, rejected: [] }, { rawCount: 25, validCount: 25, uniqueCount: 25, errors: [] });
  assert.equal(view.shadow.querySelectorAll(".card").length, 24);
  view.goToPage(2);
  assert.equal(view.shadow.querySelectorAll(".card").length, 1);
});

test("标签右侧空间不足时入口自动切换为右下浮钮", () => {
  const dom = createDom();
  Object.defineProperty(dom.window, "innerWidth", { value: 700, configurable: true });
  const nav = dom.window.document.querySelector("nav");
  nav.getBoundingClientRect = () => ({ left: 20, right: 680, top: 80, bottom: 120, width: 660, height: 40 });
  for (const item of nav.querySelectorAll("li")) {
    item.getBoundingClientRect = () => ({ left: 600, right: 680, top: 80, bottom: 120, width: 80, height: 40 });
  }
  const view = new PrecisionSearchView({ documentRef: dom.window.document }).mount();
  view.refs.launcher.getBoundingClientRect = () => ({ width: 120, height: 40 });
  view.positionToNativeTabs();
  assert.equal(view.refs.launcher.dataset.floating, "true");
  assert.equal(view.refs.panel.style.top, "128px");
});
