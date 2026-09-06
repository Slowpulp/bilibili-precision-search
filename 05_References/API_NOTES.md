# B站搜索接口核验记录

核验日期：2026-09-06

- 当前网页端视频分类搜索主路径：`https://api.bilibili.com/x/web-interface/wbi/search/type`。
- 已核验排序值：`totalrank`、`click`、`pubdate`、`dm`、`stow`。
- `page_size=50` 可用；大于 50 返回参数错误。
- 来自 `https://search.bilibili.com` 的原生跨域请求当前允许 CORS；userscript 仍优先使用 `GM_xmlhttpRequest`，原生 `fetch` 作为传输兜底。
- 服务端当前接受未签名请求，但官方前端使用 WBI 签名；本项目实现签名，并在 nav key 暂时失败时退回未签名的同一路径。
- `search_type=video` 仍可能混入 `type=ketang` 且没有 BV 号的课程卡；适配器只接受 `type=video && bvid`。
- 旧的非 WBI 路径仅在主路径明确 404/405 时尝试，不能用于绕过风控。
- HTTP 412/429、JSON `-352/412/429` 或 `data.v_voucher` 会立即停止本轮候选抓取。

参考入口：

- https://search.bilibili.com/all
- https://api.bilibili.com/x/web-interface/nav
- https://api.bilibili.com/x/web-interface/wbi/search/type
