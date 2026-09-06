import test from "node:test";
import assert from "node:assert/strict";

import {
  BilibiliApiError,
  BilibiliSearchApiAdapter,
  canonicalQuery,
  deduplicateVideos,
  extractWbiKeys,
  normalizeOnlineStats,
  normalizePageList,
  normalizeVideo,
  normalizeVideoDetail,
  parseOnlineCount,
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

test("搜索卡的互动零占位按缺失处理，等待详情接口给出权威零值", () => {
  const video = normalizeVideo(rawVideo({ like: 0, favorites: 0, coin: 0, share: 0 }));
  assert.equal(video.stats.likes, null);
  assert.equal(video.stats.favorites, null);
  assert.equal(video.stats.coins, null);
  assert.equal(video.stats.shares, null);
  assert.equal(video.stats.views, 12_000);
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

const rawDetail = (bvid = "BV1TEST00001", overrides = {}) => ({
  bvid,
  aid: 456,
  title: "完整标题",
  desc: "完整简介",
  pic: "//i0.hdslb.com/detail.jpg",
  duration: 605,
  pubdate: 1_710_000_000,
  videos: 2,
  owner: { name: "详情UP", mid: 99, face: "//i0.hdslb.com/up.jpg" },
  stat: {
    view: 50000,
    like: 5000,
    favorite: 2400,
    reply: 300,
    danmaku: 400,
    coin: 1800,
    share: 260,
  },
  pages: [
    { cid: 101, page: 1, part: "上集", duration: 300 },
    { cid: 102, page: 2, part: "下集", duration: 305 },
  ],
  ...overrides,
});

test("详情和分P规范化保留长期质量需要的权威统计", () => {
  const detail = normalizeVideoDetail(rawDetail());
  assert.equal(detail.stats.views, 50000);
  assert.equal(detail.stats.favorites, 2400);
  assert.equal(detail.stats.coins, 1800);
  assert.equal(detail.pages.length, 2);
  assert.equal(detail.pages[1].cid, 102);
  assert.deepEqual(normalizePageList([{ cid: 9, page: 1, part: "P1" }, { cid: null }]), [{
    cid: 9,
    page: 1,
    part: "P1",
    durationSeconds: null,
    dimension: null,
  }]);
});

test("在线数字支持万、亿和加号近似值，并尊重 show_switch", () => {
  assert.deepEqual(parseOnlineCount("1.7万+"), { value: 17000, approximate: true, raw: "1.7万+" });
  assert.deepEqual(parseOnlineCount("2.1亿"), { value: 210000000, approximate: true, raw: "2.1亿" });
  assert.deepEqual(parseOnlineCount("2,345+"), { value: 2345, approximate: true, raw: "2,345+" });
  assert.equal(parseOnlineCount("--").value, null);

  const online = normalizeOnlineStats({
    total: "1.7万+",
    count: "800",
    show_switch: { total: true, count: false },
  }, { bvid: "BV1TEST00001", cid: 101, page: 1, multiPart: true, selection: "first-page" });
  assert.equal(online.total, 17000);
  assert.equal(online.web, null);
  assert.equal(online.visible.web, false);
  assert.equal(online.scope, "page");
  assert.equal(online.multiPart, true);
});

test("视频详情使用 TTL 缓存，结构性失败时降级到统计接口", async () => {
  let now = 1000;
  let detailCalls = 0;
  let fallbackCalls = 0;
  const adapter = new BilibiliSearchApiAdapter({
    now: () => now,
    detailTtl: 100,
    enrichmentDelayMs: 0,
    request: async (url) => {
      if (url.includes("/archive/stat")) {
        fallbackCalls += 1;
        return { code: 0, data: { bvid: "BV1TEST00002", view: 12, like: 3, favorite: 2 } };
      }
      detailCalls += 1;
      if (url.includes("BV1TEST00002")) return { code: -404, message: "not found" };
      return { code: 0, data: rawDetail("BV1TEST00001") };
    },
  });
  const first = await adapter.getVideoDetail("BV1TEST00001");
  const cached = await adapter.getVideoDetail("BV1TEST00001");
  assert.equal(first, cached);
  assert.equal(detailCalls, 1);
  now += 101;
  await adapter.getVideoDetail("BV1TEST00001");
  assert.equal(detailCalls, 2);

  const partial = await adapter.getVideoDetail("BV1TEST00002");
  assert.equal(partial.partial, true);
  assert.equal(partial.source, "stat-fallback");
  assert.equal(partial.stats.views, 12);
  assert.equal(fallbackCalls, 1);
});

test("共享详情请求允许单个等待方取消，并在无人等待时取消底层请求", async () => {
  let underlyingAborted = false;
  const adapter = new BilibiliSearchApiAdapter({
    request: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        underlyingAborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }),
  });
  const controller = new AbortController();
  const pending = adapter.getVideoDetail("BV1TEST00001", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(underlyingAborted, true);
});

test("批量详情按 BV 去重、限制并发并对普通缺失降级", async () => {
  let active = 0;
  let peak = 0;
  const adapter = new BilibiliSearchApiAdapter({
    enrichmentDelayMs: 0,
    request: async (url) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      const bvid = new URL(url).searchParams.get("bvid");
      if (bvid === "BV1TEST00003") return { code: -500, message: "temporary" };
      return { code: 0, data: rawDetail(bvid) };
    },
  });
  const result = await adapter.getVideoCards([
    "BV1TEST00001",
    "BV1TEST00001",
    "BV1TEST00002",
    "BV1TEST00003",
  ], { concurrency: 2 });
  assert.equal(result.requestedCount, 3);
  assert.equal(result.enrichedCount, 2);
  assert.equal(result.errors.length, 1);
  assert.ok(peak <= 2);
});

test("批量补全遇到风控立即停止调度后续详情", async () => {
  let calls = 0;
  const adapter = new BilibiliSearchApiAdapter({
    enrichmentDelayMs: 0,
    request: async (url, { signal }) => {
      calls += 1;
      const bvid = new URL(url).searchParams.get("bvid");
      if (bvid === "BV1TEST00001") return { code: -352, message: "risk" };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ code: 0, data: rawDetail(bvid) }), 30);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    },
  });
  await assert.rejects(
    adapter.getVideoCards([
      "BV1TEST00001",
      "BV1TEST00002",
      "BV1TEST00003",
      "BV1TEST00004",
    ]),
    (error) => error.kind === "risk",
  );
  assert.ok(calls <= 2);
});

test("在线人数自动选第一分P、明确 page scope，并使用短 TTL 缓存", async () => {
  let calls = 0;
  const adapter = new BilibiliSearchApiAdapter({
    onlineTtl: 1000,
    request: async (url) => {
      calls += 1;
      if (url.includes("/pagelist")) {
        return { code: 0, data: rawDetail().pages };
      }
      assert.match(url, /cid=101/);
      return { code: 0, data: { total: "2.4万+", count: "900+", show_switch: { total: 1, count: 1 } } };
    },
  });
  const first = await adapter.getOnline("BV1TEST00001");
  const cached = await adapter.getOnline("BV1TEST00001");
  assert.deepEqual(first, cached);
  assert.equal(calls, 2);
  assert.equal(first.selection, "first-page");
  assert.equal(first.scope, "page");
  assert.equal(first.multiPart, true);
  assert.equal(first.total, 24000);
  assert.equal(first.web, 900);
  const explicit = await adapter.getOnline("BV1TEST00001", { cid: 101, page: 2, part: "复用同一统计" });
  assert.equal(calls, 2);
  assert.equal(explicit.selection, "explicit");
  assert.equal(explicit.page, 2);
});

test("在线 shortlist 按 BV 去重并返回便于降级的 Map", async () => {
  const adapter = new BilibiliSearchApiAdapter({
    enrichmentDelayMs: 0,
    request: async () => ({ code: 0, data: { total: "321", count: "123" } }),
  });
  const video = {
    bvid: "BV1TEST00001",
    pages: [{ cid: 101, page: 1, part: "P1" }, { cid: 102, page: 2, part: "P2" }],
  };
  const result = await adapter.getOnlineForVideos([video, video]);
  assert.equal(result.requestedCount, 1);
  assert.equal(result.enrichedCount, 1);
  assert.equal(result.onlineByBvid.get(video.bvid).total, 321);
  assert.equal(result.onlineByBvid.get(video.bvid).multiPart, true);
  assert.deepEqual(result.errors, []);
});

test("enrichStats 用详情零值覆盖搜索占位值，缺失项保留原始数据", async () => {
  const adapter = new BilibiliSearchApiAdapter({
    enrichmentDelayMs: 0,
    request: async (url) => {
      const bvid = new URL(url).searchParams.get("bvid");
      if (bvid === "BV1TEST00002") return { code: -500, message: "temporary" };
      return { code: 0, data: rawDetail(bvid, { stat: { ...rawDetail().stat, like: 0 } }) };
    },
  });
  const source = [
    normalizeVideo(rawVideo({ bvid: "BV1TEST00001", like: 999 })),
    normalizeVideo(rawVideo({ bvid: "BV1TEST00002", like: 88 })),
  ];
  const result = await adapter.enrichStats(source);
  assert.equal(result.enrichedVideos, result.videos);
  assert.equal(result.videos[0].stats.likes, 0);
  assert.equal(result.videos[0].enrichment.detail, "complete");
  assert.equal(result.videos[1].stats.likes, 88);
  assert.equal(result.videos[1].enrichment.detail, "unavailable");
  assert.equal(result.errors.length, 1);
  assert.equal(source[0].stats.likes, 999);
});
