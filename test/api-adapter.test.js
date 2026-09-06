import test from "node:test";
import assert from "node:assert/strict";

import {
  BilibiliApiError,
  BilibiliSearchApiAdapter,
  canonicalQuery,
  deduplicateVideos,
  extractWbiKeys,
  normalizeVideo,
  parseDuration,
  plainQuery,
  signWbiParams,
} from "../src/api-adapter.js";

const rawVideo = (overrides = {}) => ({
  type: "video",
  bvid: "BV1TEST12345",
  aid: 123,
  title: '<em class="keyword">费德勒</em> &amp; 纳达尔',
  description: "2017 澳网决赛",
  author: "网球档案",
  mid: 88,
  typename: "竞技体育",
  pic: "//i0.hdslb.com/test.jpg",
  duration: "13:7",
  play: 12000,
  like: 800,
  favorites: 400,
  review: 60,
  danmaku: 90,
  pubdate: 1_700_000_000,
  tag: "费德勒,纳达尔,澳网",
  ...overrides,
});

test("API 规范化过滤非视频卡并清理字段", () => {
  assert.equal(normalizeVideo({ ...rawVideo(), type: "ketang", bvid: "" }), null);
  const video = normalizeVideo(rawVideo(), { order: "click", page: 2, position: 4 });
  assert.equal(video.title, "费德勒 & 纳达尔");
  assert.equal(video.coverUrl, "https://i0.hdslb.com/test.jpg");
  assert.equal(video.durationSeconds, 13 * 60 + 7);
  assert.deepEqual(video.tags, ["费德勒", "纳达尔", "澳网"]);
  assert.equal(video.sources[0].orderLabel, "播放");
});

test("时长解析支持不补零和小时格式", () => {
  assert.equal(parseDuration("13:7"), 787);
  assert.equal(parseDuration("1:02:03"), 3723);
  assert.equal(parseDuration("bad"), null);
  assert.equal(parseDuration(""), null);
  assert.equal(parseDuration(undefined), null);
});

test("多路召回按 BV 号去重并合并统计与来源", () => {
  const first = normalizeVideo(rawVideo({ play: 100, description: "短" }), { order: "totalrank", page: 1, position: 1 });
  const second = normalizeVideo(rawVideo({ play: 200, description: "更完整的简介" }), { order: "pubdate", page: 1, position: 3 });
  const merged = deduplicateVideos([first, second]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].stats.views, 200);
  assert.equal(merged[0].description, "更完整的简介");
  assert.deepEqual(merged[0].sources.map((source) => source.order), ["totalrank", "pubdate"]);
});

test("WBI key 提取和签名查询保持确定性", () => {
  const payload = {
    code: -101,
    data: {
      wbi_img: {
        img_url: "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz123456.png",
        sub_url: "https://i0.hdslb.com/bfs/wbi/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456.png",
      },
    },
  };
  const keys = extractWbiKeys(payload);
  assert.equal(keys.mixinKey.length, 32);
  assert.equal(canonicalQuery({ z: "a!'()*b", a: "中文 空格" }), "a=%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC&z=ab");
  assert.match(plainQuery({ keyword: "C++ (入门)!", page: 1 }), /keyword=C%2B%2B/);
  const signed = signWbiParams({ keyword: "网球", page: 1 }, keys.mixinKey, 1_700_000_000);
  assert.match(signed, /^keyword=.*&page=1&wts=1700000000&w_rid=[0-9a-f]{32}$/);
});

test("适配器接受匿名 nav 的 -101，并过滤搜索混入的课程卡", async () => {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (url.includes("/nav")) {
      return {
        code: -101,
        data: {
          wbi_img: {
            img_url: "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz123456.png",
            sub_url: "https://i0.hdslb.com/bfs/wbi/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456.png",
          },
        },
      };
    }
    return {
      code: 0,
      data: {
        page: 1,
        numPages: 1,
        next: 0,
        result: [rawVideo(), { type: "ketang", bvid: "", title: "课程广告" }],
      },
    };
  };
  const adapter = new BilibiliSearchApiAdapter({ request, now: () => 1_700_000_000_000 });
  const result = await adapter.searchPage({ keyword: "费德勒", order: "totalrank", page: 1, pageSize: 50 });
  assert.equal(result.videos.length, 1);
  assert.equal(result.ignoredCount, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /w_rid=[0-9a-f]{32}/);
});

test("风控 voucher 会立即作为 risk 错误停止", async () => {
  const request = async (url) => url.includes("/nav")
    ? { code: -101, data: {} }
    : { code: 0, data: { v_voucher: "challenge" } };
  const adapter = new BilibiliSearchApiAdapter({ request });
  await assert.rejects(
    adapter.searchPage({ keyword: "test", order: "totalrank", page: 1 }),
    (error) => error.kind === "risk",
  );
});

test("nav 的正数风控码不会降级成未签名搜索", async () => {
  let calls = 0;
  const adapter = new BilibiliSearchApiAdapter({
    request: async () => {
      calls += 1;
      return { code: 412, message: "request blocked" };
    },
  });
  await assert.rejects(
    adapter.searchPage({ keyword: "test", order: "totalrank", page: 1 }),
    (error) => error.kind === "risk",
  );
  assert.equal(calls, 1);
});

test("并发首批搜索共享一个 nav key 请求", async () => {
  let navCalls = 0;
  const request = async (url) => {
    if (url.includes("/nav")) {
      navCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        code: -101,
        data: { wbi_img: {
          img_url: "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz123456.png",
          sub_url: "https://i0.hdslb.com/bfs/wbi/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456.png",
        } },
      };
    }
    return { code: 0, data: { page: 1, numPages: 1, next: 0, result: [rawVideo()] } };
  };
  const adapter = new BilibiliSearchApiAdapter({ request });
  await Promise.all([
    adapter.searchPage({ keyword: "a", order: "totalrank", page: 1 }),
    adapter.searchPage({ keyword: "a", order: "click", page: 1 }),
  ]);
  assert.equal(navCalls, 1);
});

test("等待共享 nav 时可立即响应单个调用方取消", async () => {
  let resolveNav;
  const adapter = new BilibiliSearchApiAdapter({
    request: async (url) => {
      if (url.includes("/nav")) return new Promise((resolve) => { resolveNav = resolve; });
      return { code: 0, data: { result: [] } };
    },
  });
  const controller = new AbortController();
  const pending = adapter.getWbiKeys(controller.signal);
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  resolveNav({ code: -101, data: { wbi_img: {
    img_url: "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz123456.png",
    sub_url: "https://i0.hdslb.com/bfs/wbi/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456.png",
  } } });
});

test("WBI -403 只刷新 key 并重放一次", async () => {
  let navCalls = 0;
  let searchCalls = 0;
  const request = async (url) => {
    if (url.includes("/nav")) {
      navCalls += 1;
      const suffix = navCalls === 1 ? "abcdefghijklmnopqrstuvwx12345678" : "87654321xwvutsrqponmlkjihgfedcba";
      return { code: -101, data: { wbi_img: {
        img_url: `https://i0.hdslb.com/bfs/wbi/${suffix}.png`,
        sub_url: "https://i0.hdslb.com/bfs/wbi/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456.png",
      } } };
    }
    searchCalls += 1;
    return searchCalls === 1
      ? { code: -403, message: "signature expired" }
      : { code: 0, data: { page: 1, numPages: 1, next: 0, result: [rawVideo()] } };
  };
  const adapter = new BilibiliSearchApiAdapter({ request });
  const result = await adapter.searchPage({ keyword: "test", order: "totalrank", page: 1 });
  assert.equal(result.videos.length, 1);
  assert.equal(navCalls, 2);
  assert.equal(searchCalls, 2);
});

test("任一路触发风控会取消另一 worker 并停止后续页", async () => {
  const adapter = new BilibiliSearchApiAdapter({ random: () => 0 });
  const calls = [];
  adapter.searchPage = async ({ order, page, signal }) => {
    calls.push(`${order}:${page}`);
    if (order === "totalrank") {
      throw new BilibiliApiError("blocked", { code: 412, kind: "risk" });
    }
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  await assert.rejects(
    adapter.collectCandidates("test", {
      orders: ["totalrank", "click", "pubdate"],
      pagesPerOrder: 3,
      pageSize: 50,
    }),
    (error) => error.kind === "risk",
  );
  assert.ok(calls.length <= 2);
});
