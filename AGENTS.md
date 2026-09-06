<!-- project-file-manager:rules:start -->
## 项目文件生命周期

- 本项目采用 `00_Inbox`、`01_Source`、`02_Working`、`03_Versions`、`04_Deliverables`、`05_References` 管理非代码文件。
- 新收到且尚未判断的文件先放入 `00_Inbox`；低置信度项目继续保留在 Inbox。
- `01_Source` 是原始输入，原则上不直接修改；先复制到 `02_Working` 再编辑。
- 代码和文本配置的版本历史交给 Git，不为它们创建 `v2`、`final` 等副本，也不放入 `03_Versions`。
- `03_Versions` 仅用于需要人工保留阶段快照的二进制工程文件。
- 整理前先运行 dry-run 计划并向用户展示；只有明确确认后才能应用移动或建议重命名。
- 不自动删除重复文件。操作记录与撤销信息位于 `.project-files`；项目说明见 `PROJECT_FILES.md`。
<!-- project-file-manager:rules:end -->

## 发布与版本管理

- 每个完成并验证通过的用户需求都必须进入 Git 历史，并创建 annotated tag。
- 初始版本及后续版本遵循语义化版本；标签格式为 `v<major>.<minor>.<patch>`。
- 发布前同步 `package.json`、`package-lock.json`、`src/userscript.meta.txt`、`src/constants.js` 与 `CHANGELOG.md` 中的版本号。
- 发布验证命令统一为 `npm run verify`，构建产物为 `dist/BilibiliPrecisionSearch.user.js`。
- 提交前检查状态与差异，只纳入本需求相关文件；不得提交 `node_modules`、账号数据、Cookie、密钥或临时文件。
