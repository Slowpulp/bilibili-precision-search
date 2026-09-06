import test from "node:test";
import assert from "node:assert/strict";

import { md5 } from "../src/md5.js";
import {
  bestSubstringSimilarity,
  normalizeText,
  parseQuery,
  stripHtml,
} from "../src/text.js";

test("清理 B站高亮 HTML、实体和全角空格", () => {
  assert.equal(normalizeText("<em class=\"keyword\">RTX</em>　5090 &amp; 测试"), "rtx 5090 测试");
  assert.equal(stripHtml("A<em>B</em>&nbsp;C"), "A B C");
});

test("查询解析支持型号、精确短语和排除词", () => {
  const parsed = parseQuery('Wilson Pro Staff 97 v14 "澳网 决赛" -德约');
  assert.deepEqual(parsed.terms.map((term) => term.text), ["wilson", "pro", "staff", "97", "v14", "澳网 决赛"]);
  assert.deepEqual(parsed.exactPhrases, ["澳网 决赛"]);
  assert.deepEqual(parsed.negativeTerms.map((term) => term.text), ["德约"]);
});

test("C++ 与 C# 保留语言名称后缀", () => {
  assert.deepEqual(parseQuery("C++ tutorial").terms.map((term) => term.text), ["c++", "tutorial"]);
  assert.deepEqual(parseQuery("C# tutorial").terms.map((term) => term.text), ["c#", "tutorial"]);
});

test("近似子串只把小编辑距离视为接近", () => {
  assert.ok(bestSubstringSimilarity("transformr", "Transformer tutorial") > 0.85);
  assert.ok(bestSubstringSimilarity("transformr", "tennis highlights") < 0.5);
});

test("内置 MD5 符合已知向量", () => {
  assert.equal(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(md5("中文"), "a7bac2239fcdcb3a067903d8077c4a07");
});
