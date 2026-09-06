import test from "node:test";
import assert from "node:assert/strict";

import { MetricHistoryStore } from "../src/metric-history.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("增长快照按 BV 号持久化，并避免在过短间隔内重复采样", () => {
  const storage = memoryStorage();
  let now = Date.UTC(2026, 8, 7, 0, 0, 0);
  const store = new MetricHistoryStore({ storage, now: () => now, minIntervalMs: 60 * 60 * 1000 });
  const first = { bvid: "BV1TEST", stats: { views: 100, likes: 10 } };
  store.record([first]);
  now += 30 * 60 * 1000;
  store.record([{ ...first, stats: { views: 120, likes: 12 } }]);
  assert.equal(store.snapshotsFor([first]).get("BV1TEST").length, 1);

  now += 31 * 60 * 1000;
  store.record([{ ...first, stats: { views: 160, likes: 17 } }]);
  const snapshots = store.snapshotsFor([first]).get("BV1TEST");
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].stats.views, 100);
  assert.equal(snapshots[1].stats.likes, 17);
});

test("增长快照丢弃过期视频并限制保留的视频数量", () => {
  const storage = memoryStorage();
  let now = 10_000;
  const store = new MetricHistoryStore({
    storage,
    now: () => now,
    maxVideos: 2,
    maxAgeMs: 5_000,
    minIntervalMs: 0,
  });
  store.record([{ bvid: "BV1OLD", stats: { views: 1 } }]);
  now += 6_000;
  store.record([
    { bvid: "BV1A", stats: { views: 2 } },
    { bvid: "BV1B", stats: { views: 3 } },
    { bvid: "BV1C", stats: { views: 4 } },
  ]);
  const snapshots = store.snapshotsFor([
    { bvid: "BV1OLD" }, { bvid: "BV1A" }, { bvid: "BV1B" }, { bvid: "BV1C" },
  ]);
  assert.equal(snapshots.get("BV1OLD").length, 0);
  assert.equal([...snapshots.values()].filter((items) => items.length > 0).length, 2);
});
