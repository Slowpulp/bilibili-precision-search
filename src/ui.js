import { DEFAULT_MODE, MODE_PROFILES, RESULTS_PER_PAGE } from "./constants.js";
import { APP_STYLES } from "./style.js";

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
    this.mode = DEFAULT_MODE;
    this.page = 1;
    this.result = null;
    this.pool = null;
    this.lastError = null;
    this.available = true;
    this.resizeObserver = null;
    this.repositionFrame = null;
    this.lastProgressBucket = -1;
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
              <div class="mode-row"><div class="mode-group" role="group" aria-label="精准搜索模式"></div><p class="mode-note"></p></div>
            </div>
          </header>
          <main class="content">
            <div class="status-box">
              <div class="status-main"><p class="status-title">点击“精准搜索”开始</p><p class="status-detail">将从多个排序入口收集候选，再执行相关性硬过滤。</p><div class="progress-track" hidden><div class="progress-bar"></div></div></div>
              <button class="secondary cancel-button" type="button" hidden>取消</button>
              <span class="sr-only live-status" role="status" aria-live="polite" aria-atomic="true"></span>
            </div>
            <div class="warning" hidden></div>
            <div class="results-grid"></div>
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
      modeGroup: this.shadow.querySelector(".mode-group"),
      modeNote: this.shadow.querySelector(".mode-note"),
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
    this.renderModeButtons();
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

  renderModeButtons() {
    this.refs.modeGroup.replaceChildren();
    for (const profile of Object.values(MODE_PROFILES)) {
      const button = element(this.document, "button", "mode-button", profile.label);
      button.type = "button";
      button.dataset.mode = profile.id;
      button.title = profile.shortDescription;
      button.setAttribute("aria-pressed", String(profile.id === this.mode));
      button.addEventListener("click", () => this.handlers.onModeChange?.(profile.id));
      this.refs.modeGroup.append(button);
    }
    this.setMode(this.mode);
  }

  setMode(mode) {
    this.mode = MODE_PROFILES[mode] ? mode : DEFAULT_MODE;
    this.shadow?.querySelectorAll(".mode-button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.mode === this.mode));
    });
    if (this.refs) this.refs.modeNote.textContent = MODE_PROFILES[this.mode].shortDescription;
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

  setLoading({ completed = 0, total = 1, candidateCount = 0, order = "", page = 1 } = {}) {
    if (completed === 0 && candidateCount === 0 && !order) this.lastProgressBucket = -1;
    this.refs.panel.setAttribute("aria-busy", "true");
    this.refs.statusTitle.textContent = `正在扩展候选池… ${completed}/${total}`;
    this.refs.statusDetail.textContent = order
      ? `正在读取 ${order} 排序第 ${page} 页，已取得 ${candidateCount} 条有效候选`
      : "正在连接 B站搜索接口";
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
      this.refs.liveStatus.textContent = `精准搜索进度 ${Math.round(bucket * 25)}%`;
    }
  }

  setResults(result, pool) {
    this.result = result;
    this.pool = pool;
    this.page = 1;
    this.lastError = null;
    this.lastProgressBucket = -1;
    this.refs.panel.setAttribute("aria-busy", "false");
    this.refs.cancel.hidden = true;
    this.refs.progressTrack.hidden = true;
    this.refs.statusTitle.textContent = `保留 ${result.ranked.length} 条精准结果`;
    this.refs.statusDetail.textContent = `接口返回 ${pool.rawCount} 条 · 有效 ${pool.validCount} 条 · 去重 ${pool.uniqueCount} 条 · 门槛过滤 ${result.rejected.length} 条`;
    this.refs.liveStatus.textContent = `精准搜索完成，保留 ${result.ranked.length} 条结果`;
    if (pool.errors.length) {
      this.refs.warning.hidden = false;
      this.refs.warning.textContent = `${pool.errors.length} 路候选请求未完成；已用其余成功结果排序。`;
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
      const profile = MODE_PROFILES[this.mode];
      this.refs.stateView.append(this.buildState(
        "empty",
        "没有结果通过相关性硬门槛",
        `当前为${profile.label}模式（相关性至少 ${Math.round(profile.threshold * 100)} 分、覆盖至少 ${Math.round(profile.minCoverage * 100)}%）。可核对关键词，或切换到探索模式。`,
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
    const { video, relevance, quality } = item;
    const card = element(this.document, "article", "card");
    const coverLink = externalLink(this.document, "cover-link", "", video.url);
    const image = element(this.document, "img", "cover");
    setSafeImage(image, video.coverUrl, video.title);
    coverLink.append(image);
    if (video.durationText) coverLink.append(element(this.document, "span", "duration", video.durationText));
    const sourceLabels = [...new Set(video.sources.map((source) => source.orderLabel))];
    coverLink.append(element(this.document, "span", "source-badge", `${sourceLabels.length} 路召回`));

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
    scores.append(
      element(this.document, "span", "score score-relevance", `相关 ${Math.round(relevance.value * 100)}`),
      element(this.document, "span", "score score-quality", `质量 ${Math.round(quality.value * 100)}`),
    );
    body.append(scores);
    const primaryReason = relevance.positiveReasons[0] ?? quality.positiveReasons[0] ?? "通过相关性硬门槛";
    body.append(element(this.document, "p", "reason-primary", primaryReason));

    const chips = element(this.document, "div", "match-list");
    for (const match of relevance.matchedTerms.slice(0, 6)) {
      const suffix = match.fuzzy ? "≈" : "→";
      chips.append(element(this.document, "span", "match-chip", `${match.term}${suffix}${match.fields.join("/")}`));
    }
    if (chips.childElementCount) body.append(chips);

    const details = element(this.document, "details", "explanations");
    details.append(element(this.document, "summary", "", "查看匹配与质量说明"));
    const list = element(this.document, "ul");
    const reasons = [
      ...relevance.positiveReasons,
      ...relevance.negativeReasons,
      ...quality.positiveReasons,
      ...quality.negativeReasons,
      `候选来源：${sourceLabels.join("、")}`,
    ];
    for (const reason of [...new Set(reasons)].slice(0, 8)) list.append(element(this.document, "li", "", reason));
    details.append(list);
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
