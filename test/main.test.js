import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { PrecisionSearchApp, currentContext, installLocationWatcher } from "../src/main.js";

function createDom() {
  return new JSDOM(`<!doctype html><html><body>
    <button id="unrelated-user">用户</button>
    <div id="app">
      <input class="search-input-el" type="text" value="费德勒 2017 澳网 纳达尔">
      <div class="search-tabs"><nav><ul>
        <li>综合</li><li>视频</li><li>番剧</li><li>影视</li><li>直播</li><li>专栏</li><li>用户</li>
      </ul></nav></div>
      <div class="search-conditions"><button id="native-filter">综合排序</button></div>
      <div class="search-content"><div class="search-page-wrapper"><p id="native-result">原生结果</p></div></div>
    </div>
  </body></html>`, {
    url: "https://search.bilibili.com/all?keyword=%E8%B4%B9%E5%BE%B7%E5%8B%92",
    pretendToBeVisual: true,
  });
}

function canonicalVideo() {
  return {
    key: "BV1TEST",
    bvid: "BV1TEST",
    title: "费德勒 2017 澳网决赛 对阵纳达尔",
    description: "经典比赛",
    tags: ["费德勒", "纳达尔", "澳网"],
    category: "竞技体育",
    author: { name: "网球档案", mid: 1 },
    publishedAt: Date.UTC(2024, 0, 1),
    stats: { views: 1000, likes: 100, favorites: 50, coins: null, replies: 10, danmaku: 20 },
    sources: [{ order: "totalrank", orderLabel: "综合", page: 1, position: 1 }],
    url: "https://www.bilibili.com/video/BV1TEST",
    coverUrl: "",
    durationText: "2:00",
  };
}

test("应用打开精准面板、渲染结果并精确恢复原生可访问性状态", async () => {
  const dom = createDom();
  const nativeContent = dom.window.document.querySelector(".search-content");
  const nativeResult = dom.window.document.querySelector("#native-result");
  const nativeConditions = dom.window.document.querySelector(".search-conditions");
  const nativeFilter = dom.window.document.querySelector("#native-filter");
  const originalHtml = nativeResult.outerHTML;
  const adapter = {
    async collectCandidates(query, profile, { onProgress }) {
      onProgress({ completed: 1, total: 1, order: "综合", page: 1, candidateCount: 1 });
      return {
        videos: [canonicalVideo()],
        rawCount: 1,
        validCount: 1,
        uniqueCount: 1,
        ignoredCount: 0,
        duplicateCount: 0,
        errors: [],
      };
    },
  };
  const app = new PrecisionSearchApp({ documentRef: dom.window.document, windowRef: dom.window, adapter });
  app.start();
  app.toggle();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(app.view.isOpen(), true);
  assert.equal(nativeContent.inert, true);
  assert.equal(nativeContent.getAttribute("aria-hidden"), "true");
  assert.equal(nativeConditions.hasAttribute("inert"), true);
  assert.equal(nativeConditions.getAttribute("aria-hidden"), "true");
  assert.equal(nativeFilter.getAttribute("tabindex"), "-1");
  assert.equal(app.view.shadow.querySelectorAll(".card").length, 1);
  assert.equal(nativeResult.outerHTML, originalHtml);

  app.close({ restoreFocus: false });
  assert.equal(nativeContent.inert, false);
  assert.equal(nativeContent.hasAttribute("aria-hidden"), false);
  assert.equal(nativeConditions.hasAttribute("inert"), false);
  assert.equal(nativeConditions.hasAttribute("aria-hidden"), false);
  assert.equal(nativeFilter.hasAttribute("tabindex"), false);
  assert.equal(nativeResult.outerHTML, originalHtml);
});

test("位置签名忽略 vt 参数，只关注路径与关键词", () => {
  const first = currentContext({ href: "https://search.bilibili.com/all?keyword=test" });
  const second = currentContext({ href: "https://search.bilibili.com/all?keyword=test&vt=12345678" });
  const changed = currentContext({ href: "https://search.bilibili.com/all?keyword=changed&vt=12345678" });
  assert.equal(first.signature, second.signature);
  assert.notEqual(first.signature, changed.signature);
});

test("History 监听能捕获 SPA pushState 且不会伪造 popstate", async () => {
  const dom = createDom();
  let locationEvents = 0;
  let popstateEvents = 0;
  dom.window.addEventListener("bps:locationchange", () => { locationEvents += 1; });
  dom.window.addEventListener("popstate", () => { popstateEvents += 1; });
  const watcher = installLocationWatcher(dom.window);
  dom.window.history.pushState({}, "", "/video?keyword=changed");
  await new Promise((resolve) => dom.window.queueMicrotask(resolve));
  assert.equal(locationEvents, 1);
  assert.equal(popstateEvents, 0);
  watcher.stop();
  dom.window.history.pushState({}, "", "/all?keyword=after-stop");
  await new Promise((resolve) => dom.window.queueMicrotask(resolve));
  assert.equal(locationEvents, 1);
});

test("只点击真正的原生分类标签才关闭精准面板", () => {
  const dom = createDom();
  const app = new PrecisionSearchApp({ documentRef: dom.window.document, windowRef: dom.window, adapter: {} });
  app.start();
  app.view.showPanel({ focus: false });
  dom.window.document.querySelector("#unrelated-user").click();
  assert.equal(app.view.isOpen(), true);

  const nativeUserTab = [...dom.window.document.querySelectorAll(".search-tabs li")].at(-1);
  nativeUserTab.innerHTML = " 用户 <span>99+</span> ";
  nativeUserTab.querySelector("span").click();
  assert.equal(app.view.isOpen(), false);
});

test("整个 #app 被替换后会重新发现标签并保护新结果区", async () => {
  const dom = createDom();
  const app = new PrecisionSearchApp({ documentRef: dom.window.document, windowRef: dom.window, adapter: {} });
  app.start();
  app.view.showPanel({ focus: false });
  app.guard.activate();
  const replacement = dom.window.document.createElement("div");
  replacement.id = "app";
  replacement.innerHTML = `
    <div class="search-tabs"><nav><ul><li>综合</li><li>视频</li><li>番剧</li><li>影视</li><li>直播</li><li>专栏</li><li>用户</li></ul></nav></div>
    <div class="search-conditions"><button>最新发布</button></div>
    <div class="search-content" id="new-content">新结果</div>`;
  dom.window.document.querySelector("#app").replaceWith(replacement);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
  assert.equal(dom.window.document.querySelector("#new-content").getAttribute("aria-hidden"), "true");
  assert.equal(app.view.anchor, replacement.querySelector("nav"));
});

test("本地排除语法不会污染发给 B站的召回关键词", async () => {
  const dom = createDom();
  let receivedQuery = "";
  const adapter = {
    async collectCandidates(query) {
      receivedQuery = query;
      return {
        videos: [{ ...canonicalVideo(), title: "RTX 5090 桌面显卡评测", tags: ["RTX", "5090"] }],
        rawCount: 1,
        validCount: 1,
        uniqueCount: 1,
        ignoredCount: 0,
        duplicateCount: 0,
        errors: [],
      };
    },
  };
  const app = new PrecisionSearchApp({ documentRef: dom.window.document, windowRef: dom.window, adapter });
  app.start();
  await app.search("RTX 5090 -笔记本");
  assert.equal(receivedQuery, "rtx 5090");
  assert.equal(app.view.shadow.querySelectorAll(".card").length, 1);
});

test("提交空查询会取消旧请求，迟到结果不能覆盖错误状态", async () => {
  const dom = createDom();
  let resolveOld;
  let oldSignal;
  const adapter = {
    collectCandidates(query, profile, { signal }) {
      oldSignal = signal;
      return new Promise((resolve) => { resolveOld = resolve; });
    },
  };
  const app = new PrecisionSearchApp({ documentRef: dom.window.document, windowRef: dom.window, adapter });
  app.start();
  const oldSearch = app.search("费德勒");
  await app.search("");
  assert.equal(oldSignal.aborted, true);
  assert.equal(app.view.refs.statusTitle.textContent, "精准搜索未完成");
  resolveOld({
    videos: [canonicalVideo()],
    rawCount: 1,
    validCount: 1,
    uniqueCount: 1,
    ignoredCount: 0,
    duplicateCount: 0,
    errors: [],
  });
  await oldSearch;
  assert.equal(app.view.refs.statusTitle.textContent, "精准搜索未完成");
  assert.equal(app.view.shadow.querySelectorAll(".card").length, 0);
});
