import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("userscript 元数据覆盖搜索页、匿名跨域请求与版本号", async () => {
  const metadata = await readFile(new URL("../src/userscript.meta.txt", import.meta.url), "utf8");
  assert.match(metadata, /@name\s+B站精准搜索/);
  assert.match(metadata, /@version\s+1\.2\.0/);
  assert.match(metadata, /@match\s+https:\/\/search\.bilibili\.com\/\*/);
  assert.match(metadata, /@grant\s+GM_xmlhttpRequest/);
  assert.match(metadata, /@connect\s+api\.bilibili\.com/);
  assert.match(metadata, /@run-at\s+document-start/);
});
