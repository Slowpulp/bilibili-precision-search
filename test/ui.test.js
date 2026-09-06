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
      quality: { value: 0.6, positiveReasons: [], negativeReasons: [] },
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

test("分页只创建当前页的 24 张卡片", () => {
  const dom = createDom();
  const view = new PrecisionSearchView({ documentRef: dom.window.document }).mount();
  const ranked = Array.from({ length: 25 }, (_, itemIndex) => ({
    video: {
      key: `BV${itemIndex}`,
      bvid: `BV${itemIndex}`,
      title: `视频 ${itemIndex}`,
      author: { name: "UP" },
      category: "科技",
      publishedAt: Date.UTC(2026, 0, 1),
      stats: { views: 1, likes: 1, favorites: 1, replies: 0 },
      sources: [{ orderLabel: "综合" }],
      url: `https://www.bilibili.com/video/BV${itemIndex}`,
      coverUrl: "",
      durationText: "1:00",
    },
    relevance: { value: 0.8, positiveReasons: [], negativeReasons: [], matchedTerms: [] },
    quality: { value: 0.5, positiveReasons: [], negativeReasons: [] },
  }));
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
