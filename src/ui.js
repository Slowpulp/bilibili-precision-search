import { DEFAULT_SORT_VIEW, RESULTS_PER_PAGE, SORT_VIEW_PROFILES } from "./constants.js";
import { APP_STYLES } from "./style.js";

const SORT_DESCRIPTIONS = Object.freeze({
  quality: "优先累计收藏、投币、分享等长期沉淀，不给新视频额外加分",
  growth: "优先近期真实增速；样本不足时明确标注平均增速估算或积累中",
  timeliness: "优先发布时间与当前观看热度，长期质量仅作小幅辅助",
});

export const SORT_TABS = Object.freeze(Object.values(SORT_VIEW_PROFILES).map((profile) => Object.freeze({
  id: profile.id,
  label: profile.label,
  description: SORT_DESCRIPTIONS[profile.id] ?? profile.shortDescription,
})));

export const DEFAULT_SORT = DEFAULT_SORT_VIEW;

const SORT_TAB_MAP = new Map(SORT_TABS.map((tab) => [tab.id, tab]));

const GROWTH_STATUS_LABELS = Object.freeze({
  observed: "真实增速",
  real: "真实增速",
  measured: "真实增速",
  actual: "真实增速",
  estimated: "平均估算",
  estimate: "平均估算",
  average: "平均估算",
  collecting: "积累中",
  pending: "积累中",
  unavailable: "积累中",
  missing: "积累中",
});

const ONLINE_STATUS_LABELS = Object.freeze({
  sampled: "在线已采样",
  available: "在线已采样",
  measured: "在线已采样",
  missing: "在线采样缺失",
  unavailable: "在线采样缺失",
  skipped: "未采样在线人数",
  pending: "在线采样中",
});

export const NATIVE_TAB_LABELS = new Set(["综合", "视频", "番剧", "影视", "直播", "专栏", "用户"]);

export function normalizeNativeTabLabel(value) {
  return String(value ?? "").trim().replace(/\s*(?:\d+\+?)\s*$/g, "").trim();
}

export function scoreNativeTabAnchor(nav) {
  if (!nav) return 0;
  const labels = [...nav.querySelectorAll("li, button, a, [role='tab']")]
    .map((node) => normalizeNativeTabLabel(node.textContent));
  return [...new Set(labels.filter((label) => NATIVE_TAB_LABELS.has(label)))].length;
}

function element(documentRef, tag, className = "", text = "") {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

export function formatCount(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number >= 100_000_000) return `${(number / 100_000_000).toFixed(number >= 1_000_000_000 ? 0 : 1)}亿`;
  if (number >= 10_000) return `${(number / 10_000).toFixed(number >= 100_000 ? 0 : 1)}万`;
  return new Intl.NumberFormat("zh-CN").format(number);
}

export function formatDate(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatScore(value) {
  const number = numericValue(value);
  return number === null ? "—" : String(Math.round(Math.min(1, Math.max(0, number)) * 100));
}

function itemCompleteness(item) {
  const explicit = numericValue(item.dataCompleteness?.value ?? item.dataCompleteness ?? item.completeness);
  if (explicit !== null) return Math.min(1, Math.max(0, explicit));
  const available = [item.quality, item.growth, item.timeliness]
    .map((score) => numericValue(score?.completeness))
    .filter((value) => value !== null);
  if (!available.length) return 0;
  return available.reduce((sum, value) => sum + value, 0) / available.length;
}

function growthStatus(growth = {}) {
  const raw = String(growth.status ?? growth.kind ?? "").toLocaleLowerCase();
  if (GROWTH_STATUS_LABELS[raw]) return { key: raw, label: GROWTH_STATUS_LABELS[raw] };
  if (growth.isReal === true || Number(growth.snapshotCount) >= 2) return { key: "real", label: "真实增速" };
  if (growth.isEstimated === true) return { key: "estimated", label: "平均估算" };
  if (Number(growth.snapshotCount) === 1) return { key: "collecting", label: "积累中" };
  if (numericValue(growth.value) !== null) return { key: "estimated", label: "平均估算" };
  return { key: "collecting", label: "积累中" };
}

function onlineSample(item) {
  const timeliness = item.timeliness ?? {};
  const count = numericValue(
    timeliness.onlineCount ?? timeliness.online?.count ?? item.video?.stats?.online,
  );
  const raw = String(timeliness.onlineStatus ?? timeliness.online?.status ?? "").toLocaleLowerCase();
  const key = count === null
    ? raw === "pending" || raw === "skipped" ? raw : "missing"
    : ONLINE_STATUS_LABELS[raw] ? raw : "sampled";
  return {
    count,
    key,
    label: count !== null ? `${ONLINE_STATUS_LABELS[key] ?? "在线已采样"} ${formatCount(count)}` : ONLINE_STATUS_LABELS[key],
  };
}

function scoreReasons(score) {
  if (!score) return [];
  return [
    ...(score.positiveReasons ?? []),
    ...(score.negativeReasons ?? []),
    ...(score.reasons ?? []),
    ...(score.explanations ?? []),
  ].filter(Boolean);
}

function setSafeImage(image, url, title) {
  image.alt = title ? `${title} 封面` : "视频封面";
  image.loading = "lazy";
  image.decoding = "async";
  if (url) image.src = url;
  image.addEventListener("error", () => {
    image.removeAttribute("src");
    image.alt = "封面加载失败";
  }, { once: true });
}

function externalLink(documentRef, className, text, href) {
  const link = element(documentRef, "a", className, text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

export class PrecisionSearchView {
  constructor({ documentRef = document, handlers = {} } = {}) {
    this.document = documentRef;
    this.window = documentRef.defaultView ?? globalThis;
    this.handlers = handlers;
    this.host = null;
    this.shadow = null;
    this.anchor = null;
    this.sort = DEFAULT_SORT;
    this.page = 1;
    this.result = null;
    this.pool = null;
    this.lastError = null;
    this.available = true;
    this.resizeObserver = null;
    this.repositionFrame = null;
    this.lastProgressBucket = -1;
    this.lastProgressStage = "";
  }

  mount() {
    if (this.host?.isConnected) return this;
    this.host = this.document.createElement("div");
    this.host.id = "bps-host";
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `
      <style>${APP_STYLES}</style>
      <button class="launcher" type="button" aria-pressed="false" aria-controls="bps-panel">
        <span class="launcher-icon" aria-hidden="true">🎯</span><span class="launcher-label">精准搜索</span>
      </button>
      <section class="panel" id="bps-panel" role="region" aria-label="精准搜索结果" aria-busy="false" hidden>
        <div class="panel-shell">
          <header class="toolbar">
            <div class="toolbar-inner">
              <div class="toolbar-top">
                <div class="heading-wrap"><h2 class="heading" tabindex="-1">精准搜索</h2><p class="privacy-note">匿名请求，不带观看记录；原生结果保留在面板下方</p></div>
                <form class="search-form" role="search">
                  <input class="query-input" type="search" aria-label="精准搜索关键词" autocomplete="off" placeholder="输入关键词，可用“短语”或 -排除词">
                  <button class="primary" type="submit">重新搜索</button>
                </form>
                <button class="secondary close-button" type="button">返回原生</button>
              </div>
              <div class="sort-row"><div class="sort-group" role="tablist" aria-label="精准搜索排序方式"></div><p class="sort-note"></p></div>
            </div>
          </header>
          <main class="content">
            <div class="status-box">
              <div class="status-main"><p class="status-title">点击“精准搜索”开始</p><p class="status-detail">将从多个排序入口收集候选，再执行相关性硬过滤。</p><div class="progress-track" hidden><div class="progress-bar"></div></div></div>
              <button class="secondary cancel-button" type="button" hidden>取消</button>
              <span class="sr-only live-status" role="status" aria-live="polite" aria-atomic="true"></span>
            </div>
            <div class="warning" hidden></div>
            <div class="results-grid" id="bps-results" role="tabpanel" aria-label="精准搜索结果列表"></div>
            <div class="state-view"></div>
            <nav class="pagination" aria-label="精准搜索结果分页" hidden></nav>
          </main>
        </div>
      </section>`;
    this.document.body.append(this.host);
    this.refs = {
      launcher: this.shadow.querySelector(".launcher"),
      panel: this.shadow.querySelector(".panel"),
      panelShell: this.shadow.querySelector(".panel-shell"),
      heading: this.shadow.querySelector(".heading"),
      form: this.shadow.querySelector(".search-form"),
      input: this.shadow.querySelector(".query-input"),
      close: this.shadow.querySelector(".close-button"),
      sortGroup: this.shadow.querySelector(".sort-group"),
      sortNote: this.shadow.querySelector(".sort-note"),
      statusBox: this.shadow.querySelector(".status-box"),
      statusTitle: this.shadow.querySelector(".status-title"),
      statusDetail: this.shadow.querySelector(".status-detail"),
      progressTrack: this.shadow.querySelector(".progress-track"),
      progressBar: this.shadow.querySelector(".progress-bar"),
      cancel: this.shadow.querySelector(".cancel-button"),
      warning: this.shadow.querySelector(".warning"),
      grid: this.shadow.querySelector(".results-grid"),
      stateView: this.shadow.querySelector(".state-view"),
      pagination: this.shadow.querySelector(".pagination"),
      liveStatus: this.shadow.querySelector(".live-status"),
    };
    this.renderSortTabs();
    this.bindEvents();
    this.positionToNativeTabs();
    return this;
  }

  bindEvents() {
    this.refs.launcher.addEventListener("click", () => this.handlers.onToggle?.());
    this.refs.close.addEventListener("click", () => this.handlers.onClose?.());
    this.refs.cancel.addEventListener("click", () => this.handlers.onCancel?.());
    this.refs.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.handlers.onSearch?.(this.refs.input.value.trim());
    });
    this.shadow.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isOpen()) {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onClose?.();
      }
    }, true);
    this.window.addEventListener?.("resize", () => this.schedulePosition());
    this.window.addEventListener?.("scroll", () => this.schedulePosition(), { passive: true });
  }

  renderSortTabs() {
    this.refs.sortGroup.replaceChildren();
    for (const tab of SORT_TABS) {
      const button = element(this.document, "button", "sort-button", tab.label);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.dataset.sort = tab.id;
      button.title = tab.description;
      button.setAttribute("aria-controls", "bps-results");
      button.addEventListener("click", () => this.requestSort(tab.id));
      button.addEventListener("keydown", (event) => this.handleSortKeydown(event, tab.id));
      this.refs.sortGroup.append(button);
    }
    this.setSort(this.sort, { render: false });
  }

  requestSort(sort) {
    if (!SORT_TAB_MAP.has(sort) || sort === this.sort) return;
    this.setSort(sort);
    this.refs.liveStatus.textContent = `已切换为${SORT_TAB_MAP.get(sort).label}排序`;
    if (typeof this.handlers.onSortChange === "function") this.handlers.onSortChange(sort);
    else this.handlers.onModeChange?.(sort);
  }

  handleSortKeydown(event, currentSort) {
    const currentIndex = SORT_TABS.findIndex((tab) => tab.id === currentSort);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % SORT_TABS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + SORT_TABS.length) % SORT_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = SORT_TABS.length - 1;
    else return;
    event.preventDefault();
    const next = SORT_TABS[nextIndex];
    this.refs.sortGroup.querySelector(`[data-sort="${next.id}"]`)?.focus();
    this.requestSort(next.id);
  }

  setSort(sort, { render = true } = {}) {
    this.sort = SORT_TAB_MAP.has(sort) ? sort : DEFAULT_SORT;
    this.shadow?.querySelectorAll(".sort-button").forEach((button) => {
      const active = button.dataset.sort === this.sort;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    if (this.refs) this.refs.sortNote.textContent = SORT_TAB_MAP.get(this.sort).description;
    if (render && this.result) this.renderCurrentPage();
  }

  // v1.0.x 主控制器的过渡入口；界面已不再呈现“模式”。
  setMode(sort) {
    this.setSort(sort);
  }

  setQuery(query) {
    if (this.refs && this.refs.input.value !== query) this.refs.input.value = query;
  }

  setAvailable(available) {
    this.available = Boolean(available);
    if (this.refs) this.refs.launcher.hidden = !this.available;
  }

  showPanel({ focus = true } = {}) {
    if (!this.available) return;
    this.refs.panel.hidden = false;
    this.refs.launcher.setAttribute("aria-pressed", "true");
    this.schedulePosition();
    if (focus) queueMicrotask(() => this.refs.heading.focus({ preventScroll: true }));
  }

  hidePanel({ restoreFocus = true } = {}) {
    this.refs.panel.hidden = true;
    this.refs.launcher.setAttribute("aria-pressed", "false");
    this.refs.panel.setAttribute("aria-busy", "false");
    if (restoreFocus && !this.refs.launcher.hidden) this.refs.launcher.focus({ preventScroll: true });
  }

  isOpen() {
    return Boolean(this.refs && !this.refs.panel.hidden);
  }

  setLoading({ stage = "recall", completed = 0, total = 1, candidateCount = 0, order = "", page = 1, message = "" } = {}) {
    if (stage === "recall" && completed === 0) {
      // Prevent a sort-tab click during the next request from rendering the
      // previous query's retained result object back into the cleared grid.
      this.result = null;
      this.pool = null;
      this.page = 1;
    }
    if (stage !== this.lastProgressStage || (completed === 0 && candidateCount === 0 && !order)) this.lastProgressBucket = -1;
    this.lastProgressStage = stage;
    this.refs.panel.setAttribute("aria-busy", "true");
    const stageLabels = {
      recall: "正在扩展候选池",
      details: "正在补齐长期质量数据",
      history: "正在读取增长快照",
      online: "正在采样当前观看热度",
      ranking: "正在计算三维评分",
    };
    const stageLabel = stageLabels[stage] ?? "正在处理搜索结果";
    this.refs.statusTitle.textContent = `${stageLabel}… ${completed}/${total}`;
    this.refs.statusDetail.textContent = message || (order
      ? `正在读取 ${order} 排序第 ${page} 页，已取得 ${candidateCount} 条有效候选`
      : stage === "recall" ? "正在连接 B站搜索接口" : `已处理 ${completed}/${total} 条候选`);
    this.refs.progressTrack.hidden = false;
    this.refs.progressBar.style.width = `${Math.round(Math.min(1, completed / Math.max(1, total)) * 100)}%`;
    this.refs.cancel.hidden = false;
    this.refs.warning.hidden = true;
    this.refs.grid.replaceChildren();
    this.refs.stateView.replaceChildren();
    this.refs.pagination.hidden = true;
    const bucket = Math.floor(Math.min(1, completed / Math.max(1, total)) * 4);
    if (bucket > this.lastProgressBucket) {
      this.lastProgressBucket = bucket;
      this.refs.liveStatus.textContent = `${stageLabel} ${Math.round(bucket * 25)}%`;
    }
  }

  setResults(result, pool) {
    this.result = result;
    this.pool = pool;
    const resultSort = result?.sort ?? result?.view ?? result?.profile?.id ?? result?.ranked?.[0]?.rank?.view;
    if (SORT_TAB_MAP.has(resultSort)) this.setSort(resultSort, { render: false });
    this.page = 1;
    this.lastError = null;
    this.lastProgressBucket = -1;
    this.lastProgressStage = "";
    this.refs.panel.setAttribute("aria-busy", "false");
    this.refs.cancel.hidden = true;
    this.refs.progressTrack.hidden = true;
    this.refs.statusTitle.textContent = `保留 ${result.ranked.length} 条精准结果 · ${SORT_TAB_MAP.get(this.sort).label}`;
    this.refs.statusDetail.textContent = `接口返回 ${pool.rawCount} 条 · 有效 ${pool.validCount} 条 · 去重 ${pool.uniqueCount} 条 · 门槛过滤 ${result.rejected.length} 条`;
    this.refs.liveStatus.textContent = `精准搜索完成，保留 ${result.ranked.length} 条结果`;
    const candidateErrorCount = pool.errors?.length ?? 0;
    const enrichmentErrorCount = pool.enrichmentErrors?.length ?? 0;
    if (candidateErrorCount || enrichmentErrorCount) {
      this.refs.warning.hidden = false;
      const warnings = [];
      if (candidateErrorCount) warnings.push(`${candidateErrorCount} 路候选请求未完成`);
      if (enrichmentErrorCount) warnings.push(`有 ${enrichmentErrorCount} 项详情或在线数据补全失败，已按可用数据降级`);
      this.refs.warning.textContent = `${warnings.join("；")}。`;
    } else {
      this.refs.warning.hidden = true;
    }
    this.renderCurrentPage();
  }

  setError(error) {
    this.result = null;
    this.pool = null;
    this.lastError = error;
    this.lastProgressBucket = -1;
    this.lastProgressStage = "";
    this.refs.panel.setAttribute("aria-busy", "false");
    this.refs.cancel.hidden = true;
    this.refs.progressTrack.hidden = true;
    this.refs.statusTitle.textContent = "精准搜索未完成";
    this.refs.statusDetail.textContent = error?.kind === "risk" ? "已停止继续请求，避免加重访问验证。" : "可以稍后重试，原生搜索不受影响。";
    this.refs.liveStatus.textContent = `精准搜索失败：${error?.message || "未知错误"}`;
    this.refs.warning.hidden = true;
    this.refs.grid.replaceChildren();
    this.refs.pagination.hidden = true;
    this.refs.stateView.replaceChildren(this.buildState("error", "搜索失败", error?.message || "发生未知错误", true));
  }

  setCancelled() {
    this.lastProgressBucket = -1;
    this.lastProgressStage = "";
    this.refs.panel.setAttribute("aria-busy", "false");
    this.refs.cancel.hidden = true;
    this.refs.progressTrack.hidden = true;
    this.refs.statusTitle.textContent = "已取消本次精准搜索";
    this.refs.statusDetail.textContent = "原生页面仍保持原样，可修改关键词后重试。";
    this.refs.liveStatus.textContent = "已取消精准搜索";
  }

  buildState(kind, title, message, retry = false) {
    const wrapper = element(this.document, "div", kind);
    const icon = element(this.document, "div", "empty-icon", kind === "error" ? "⚠️" : "🎯");
    icon.setAttribute("aria-hidden", "true");
    wrapper.append(icon, element(this.document, "h3", "", title), element(this.document, "p", "", message));
    if (retry) {
      const button = element(this.document, "button", "retry-button", "重试");
      button.type = "button";
      button.addEventListener("click", () => this.handlers.onRetry?.());
      wrapper.append(button);
    }
    return wrapper;
  }

  renderCurrentPage() {
    this.refs.grid.replaceChildren();
    this.refs.stateView.replaceChildren();
    if (!this.result?.ranked.length) {
      const threshold = numericValue(this.result?.stats?.threshold);
      const minCoverage = numericValue(this.result?.stats?.minCoverage);
      const limits = threshold === null || minCoverage === null
        ? "当前查询没有内容达到统一相关性准入规则。"
        : `当前相关性至少 ${Math.round(threshold * 100)} 分、覆盖至少 ${Math.round(minCoverage * 100)}%。`;
      this.refs.stateView.append(this.buildState(
        "empty",
        "没有结果通过相关性硬门槛",
        `${limits} 可核对关键词、引号短语、型号或排除词后重试。`,
      ));
      this.refs.pagination.hidden = true;
      return;
    }
    const totalPages = Math.ceil(this.result.ranked.length / RESULTS_PER_PAGE);
    this.page = Math.min(totalPages, Math.max(1, this.page));
    const start = (this.page - 1) * RESULTS_PER_PAGE;
    for (const item of this.result.ranked.slice(start, start + RESULTS_PER_PAGE)) {
      this.refs.grid.append(this.buildCard(item));
    }
    this.renderPagination(totalPages);
  }

  buildCard(item) {
    const { video, relevance } = item;
    const quality = item.quality ?? {};
    const growth = item.growth ?? {};
    const timeliness = item.timeliness ?? {};
    const selectedScore = item[this.sort] ?? quality;
    const selectedTab = SORT_TAB_MAP.get(this.sort);
    const completeness = itemCompleteness(item);
    const growthState = growthStatus(growth);
    const online = onlineSample(item);
    const card = element(this.document, "article", "card");
    const coverLink = externalLink(this.document, "cover-link", "", video.url);
    const image = element(this.document, "img", "cover");
    setSafeImage(image, video.coverUrl, video.title);
    coverLink.append(image);
    if (video.durationText) coverLink.append(element(this.document, "span", "duration", video.durationText));
    const sourceLabels = [...new Set((video.sources ?? []).map((source) => source.orderLabel).filter(Boolean))];
    coverLink.append(element(this.document, "span", "source-badge", sourceLabels.length ? `${sourceLabels.length} 路召回` : "候选来源未知"));

    const body = element(this.document, "div", "card-body");
    body.append(externalLink(this.document, "card-title", video.title || video.bvid, video.url));
    const meta = element(this.document, "div", "meta");
    meta.append(
      element(this.document, "span", "", `UP：${video.author.name || "未知"}`),
      element(this.document, "span", "", video.category || "未分区"),
      element(this.document, "span", "", formatDate(video.publishedAt)),
    );
    body.append(meta);
    const metrics = element(this.document, "div", "metrics");
    metrics.append(
      element(this.document, "span", "", `播放 ${formatCount(video.stats.views)}`),
      element(this.document, "span", "", `点赞 ${formatCount(video.stats.likes)}`),
      element(this.document, "span", "", `收藏 ${formatCount(video.stats.favorites)}`),
      element(this.document, "span", "", `评论 ${formatCount(video.stats.replies)}`),
    );
    body.append(metrics);
    const scores = element(this.document, "div", "scores");
    const scoreDefinitions = [
      { key: "relevance", label: "相关", longLabel: "相关性", value: relevance?.value },
      { key: "quality", label: "Q", longLabel: "长期质量", value: quality.value },
      { key: "growth", label: "G", longLabel: "增长趋势", value: growth.value },
      { key: "timeliness", label: "T", longLabel: "最新热播", value: timeliness.value },
    ];
    for (const score of scoreDefinitions) {
      const badge = element(
        this.document,
        "span",
        `score score-${score.key}${score.key === this.sort ? " is-selected" : ""}`,
        `${score.label} ${formatScore(score.value)}`,
      );
      badge.title = `${score.longLabel}评分：${formatScore(score.value)}`;
      scores.append(badge);
    }
    body.append(scores);

    const dataSignals = element(this.document, "div", "data-signals");
    const completenessBadge = element(this.document, "span", "data-signal completeness", `数据 ${Math.round(completeness * 100)}%`);
    completenessBadge.title = "质量、增长、时效三项评分的数据完整度";
    const growthBadge = element(this.document, "span", `data-signal growth-status status-${growthState.key}`, growthState.label);
    const observationHours = numericValue(growth.observationHours);
    growthBadge.title = growthState.label === "真实增速" && observationHours !== null
      ? `根据约 ${observationHours.toFixed(observationHours >= 10 ? 0 : 1)} 小时采样窗口计算`
      : growthState.label === "平均估算"
        ? "尚无足够历史快照，按发布以来平均增速估算"
        : "需要后续采样才能计算真实增速";
    const onlineBadge = element(this.document, "span", `data-signal online-status status-${online.key}`, online.label ?? "在线采样缺失");
    onlineBadge.title = online.count === null
      ? "当前未取得正在观看人数；时效分已对缺失数据作中性处理"
      : "当前页面周期内采样到的正在观看人数，数值可能随时间波动";
    dataSignals.append(completenessBadge, growthBadge, onlineBadge);
    body.append(dataSignals);

    const primaryReason = scoreReasons(selectedScore)[0] ?? relevance?.positiveReasons?.[0] ?? "通过相关性硬门槛";
    body.append(element(this.document, "p", "reason-primary", `${selectedTab.label}：${primaryReason}`));

    const chips = element(this.document, "div", "match-list");
    for (const match of (relevance?.matchedTerms ?? []).slice(0, 6)) {
      const suffix = match.fuzzy ? "≈" : "→";
      chips.append(element(this.document, "span", "match-chip", `${match.term}${suffix}${match.fields.join("/")}`));
    }
    if (chips.childElementCount) body.append(chips);

    const details = element(this.document, "details", "explanations");
    details.append(element(this.document, "summary", "", "查看相关性与三维评分说明"));
    const explanationGroups = element(this.document, "div", "explanation-groups");
    const appendGroup = (label, reasons, fallback) => {
      const group = element(this.document, "section", "explanation-group");
      group.append(element(this.document, "h4", "", label));
      const list = element(this.document, "ul");
      const uniqueReasons = [...new Set(reasons.filter(Boolean))].slice(0, 4);
      for (const reason of uniqueReasons.length ? uniqueReasons : [fallback]) {
        list.append(element(this.document, "li", "", reason));
      }
      group.append(list);
      explanationGroups.append(group);
    };
    appendGroup(
      `相关性 ${formatScore(relevance?.value)}`,
      [...(relevance?.positiveReasons ?? []), ...(relevance?.negativeReasons ?? [])],
      "已通过统一相关性硬门槛",
    );
    appendGroup(`长期质量 Q ${formatScore(quality.value)}`, scoreReasons(quality), "长期质量数据不足，评分已向中性收缩");
    appendGroup(
      `增长趋势 G ${formatScore(growth.value)}`,
      [
        ...scoreReasons(growth),
        growthState.label === "真实增速" && observationHours !== null ? `采用约 ${observationHours.toFixed(1)} 小时的真实采样增量` : "",
        growthState.label === "平均估算" ? "当前按发布以来平均增速估算，尚不代表近期真实增长" : "",
        growthState.label === "积累中" ? "历史快照不足，增长数据仍在积累中" : "",
      ],
      "增长数据仍在积累中",
    );
    appendGroup(
      `最新热播 T ${formatScore(timeliness.value)}`,
      [
        ...scoreReasons(timeliness),
        online.count === null ? "正在观看人数未取得，在线信号按缺失处理" : `在线采样：${formatCount(online.count)} 人正在观看`,
      ],
      "按发布时间评估；当前没有可用的在线采样",
    );
    appendGroup(
      "候选来源",
      sourceLabels.length ? [`来自${sourceLabels.length}路召回：${sourceLabels.join("、")}`] : [],
      "候选来源未记录",
    );
    details.append(explanationGroups);
    body.append(details);
    card.append(coverLink, body);
    return card;
  }

  renderPagination(totalPages) {
    this.refs.pagination.replaceChildren();
    if (totalPages <= 1) {
      this.refs.pagination.hidden = true;
      return;
    }
    this.refs.pagination.hidden = false;
    const addButton = (label, page, { current = false, disabled = false } = {}) => {
      const button = element(this.document, "button", "page-button", label);
      button.type = "button";
      button.disabled = disabled;
      if (current) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => this.goToPage(page));
      this.refs.pagination.append(button);
    };
    addButton("上一页", this.page - 1, { disabled: this.page <= 1 });
    const candidates = new Set([1, totalPages, this.page - 2, this.page - 1, this.page, this.page + 1, this.page + 2]);
    const pages = [...candidates].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
    let previous = 0;
    for (const page of pages) {
      if (previous && page - previous > 1) this.refs.pagination.append(element(this.document, "span", "", "…"));
      addButton(String(page), page, { current: page === this.page });
      previous = page;
    }
    addButton("下一页", this.page + 1, { disabled: this.page >= totalPages });
  }

  goToPage(page) {
    this.page = page;
    this.renderCurrentPage();
    if (typeof this.refs.panelShell.scrollTo === "function") {
      this.refs.panelShell.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      this.refs.panelShell.scrollTop = 0;
    }
  }

  findNativeTabAnchor() {
    let winner = null;
    let winnerScore = 0;
    for (const nav of this.document.querySelectorAll("nav")) {
      const semanticScore = scoreNativeTabAnchor(nav);
      const visibleBonus = nav.getBoundingClientRect().width > 0 ? 0.2 : 0;
      const quickBonus = nav.closest(".search-tabs") ? 0.1 : 0;
      const score = semanticScore + visibleBonus + quickBonus;
      if (semanticScore >= 4 && score > winnerScore) {
        winner = nav;
        winnerScore = score;
      }
    }
    return winner;
  }

  positionToNativeTabs() {
    if (!this.refs) return;
    const nextAnchor = this.findNativeTabAnchor();
    if (nextAnchor !== this.anchor) {
      this.resizeObserver?.disconnect();
      this.anchor = nextAnchor;
      if (this.anchor && typeof this.window.ResizeObserver !== "undefined") {
        this.resizeObserver = new this.window.ResizeObserver(() => this.schedulePosition());
        this.resizeObserver.observe(this.anchor);
      }
    }
    const viewportWidth = this.window.innerWidth || this.document.documentElement.clientWidth || 1280;
    if (!this.anchor) {
      this.refs.launcher.dataset.floating = "true";
      this.refs.panel.style.top = "132px";
      return;
    }
    const anchorRect = this.anchor.getBoundingClientRect();
    const tabNodes = [...this.anchor.querySelectorAll("li, button, a, [role='tab']")]
      .filter((node) => node.getBoundingClientRect().width > 0);
    const lastRect = tabNodes.at(-1)?.getBoundingClientRect() ?? anchorRect;
    const launcherWidth = this.refs.launcher.getBoundingClientRect().width || 120;
    let left = lastRect.right + 12;
    let top = Math.max(6, lastRect.top + (lastRect.height - 40) / 2);
    const floating = left + launcherWidth > viewportWidth - 12;
    this.refs.launcher.dataset.floating = String(floating);
    if (floating) {
      this.refs.launcher.style.left = "auto";
      this.refs.launcher.style.right = "16px";
      this.refs.launcher.style.top = "auto";
    } else {
      this.refs.launcher.style.left = `${Math.round(left)}px`;
      this.refs.launcher.style.right = "auto";
      this.refs.launcher.style.top = `${Math.round(top)}px`;
    }
    this.refs.panel.style.top = `${Math.max(62, Math.round(anchorRect.bottom + 8))}px`;
  }

  schedulePosition() {
    if (this.repositionFrame !== null) return;
    const requestFrame = this.window.requestAnimationFrame?.bind(this.window) ?? ((callback) => this.window.setTimeout(callback, 0));
    this.repositionFrame = requestFrame(() => {
      this.repositionFrame = null;
      this.positionToNativeTabs();
    });
  }
}
