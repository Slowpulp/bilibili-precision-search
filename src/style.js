export const APP_STYLES = String.raw`
:host {
  --bps-bg: var(--bg1, #ffffff);
  --bps-bg-soft: var(--bg2, #f6f7f8);
  --bps-bg-muted: var(--bg3, #eef0f2);
  --bps-text: var(--text1, #18191c);
  --bps-text-soft: var(--text2, #61666d);
  --bps-text-faint: var(--text3, #9499a0);
  --bps-line: var(--line_regular, #e3e5e7);
  --bps-brand: var(--brand_blue, #00aeec);
  --bps-brand-dark: #008ac5;
  --bps-pink: #fb7299;
  --bps-good: #2f9b72;
  --bps-warn: #d7862f;
  --bps-growth: #d57425;
  --bps-time: #a45bd4;
  --bps-shadow: 0 12px 38px rgba(0, 0, 0, .14);
  color: var(--bps-text);
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  pointer-events: none;
  position: fixed;
  inset: 0;
  z-index: 1000;
}

* { box-sizing: border-box; }
button, input { font: inherit; }
button { color: inherit; }
[hidden] { display: none !important; }

.launcher {
  align-items: center;
  background: var(--bps-bg);
  border: 1px solid color-mix(in srgb, var(--bps-brand) 42%, var(--bps-line));
  border-radius: 999px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .1);
  cursor: pointer;
  display: inline-flex;
  gap: 7px;
  height: 40px;
  justify-content: center;
  min-width: 120px;
  padding: 0 16px;
  pointer-events: auto;
  position: fixed;
  transition: border-color .16s ease, color .16s ease, transform .16s ease;
  white-space: nowrap;
  z-index: 6;
}
.launcher:hover { border-color: var(--bps-brand); color: var(--bps-brand-dark); transform: translateY(-1px); }
.launcher[aria-pressed="true"] { background: var(--bps-brand); border-color: var(--bps-brand); color: white; }
.launcher:focus-visible, button:focus-visible, input:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--bps-brand) 35%, transparent);
  outline-offset: 2px;
}
.launcher-icon { font-size: 17px; }
.launcher[data-floating="true"] {
  bottom: calc(18px + env(safe-area-inset-bottom, 0px)) !important;
  height: 48px;
  left: auto !important;
  min-width: 48px;
  padding: 0;
  right: 16px !important;
  top: auto !important;
  width: 48px;
}
.launcher[data-floating="true"] .launcher-label { display: none; }

.panel {
  background: var(--bps-bg);
  border-top: 1px solid var(--bps-line);
  bottom: 0;
  box-shadow: 0 -8px 28px rgba(0, 0, 0, .08);
  left: 0;
  overflow: hidden;
  pointer-events: auto;
  position: fixed;
  right: 0;
}
.panel-shell { height: 100%; overflow: auto; overscroll-behavior: contain; }
.toolbar {
  background: var(--bps-bg);
  background: color-mix(in srgb, var(--bps-bg) 94%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--bps-line);
  position: sticky;
  top: 0;
  z-index: 4;
}
.toolbar-inner, .content {
  margin: 0 auto;
  max-width: 1900px;
  padding-left: clamp(16px, 4vw, 72px);
  padding-right: clamp(16px, 4vw, 72px);
}
.toolbar-inner { padding-bottom: 14px; padding-top: 14px; }
.toolbar-top { align-items: center; display: flex; gap: 12px; }
.heading-wrap { min-width: 170px; }
.heading { font-size: 20px; font-weight: 700; line-height: 1.25; margin: 0; }
.privacy-note { color: var(--bps-text-faint); font-size: 12px; margin: 3px 0 0; }
.search-form { display: flex; flex: 1; gap: 8px; min-width: 220px; }
.query-input {
  background: var(--bps-bg-soft);
  border: 1px solid var(--bps-line);
  border-radius: 9px;
  color: var(--bps-text);
  height: 42px;
  min-width: 0;
  padding: 0 13px;
  width: 100%;
}
.query-input:focus { background: var(--bps-bg); border-color: var(--bps-brand); }
.primary, .secondary, .sort-button, .page-button, .retry-button {
  border: 1px solid var(--bps-line);
  border-radius: 9px;
  cursor: pointer;
  min-height: 40px;
  padding: 0 14px;
}
.primary { background: var(--bps-brand); border-color: var(--bps-brand); color: #fff; font-weight: 650; }
.primary:hover { background: var(--bps-brand-dark); }
.secondary, .retry-button, .page-button { background: var(--bps-bg); }
.secondary:hover, .retry-button:hover, .page-button:hover { border-color: var(--bps-brand); color: var(--bps-brand-dark); }
.sort-row { align-items: center; display: flex; gap: 12px; margin-top: 12px; }
.sort-group { background: var(--bps-bg-soft); border-radius: 10px; display: inline-flex; gap: 3px; padding: 3px; }
.sort-button { background: transparent; border-color: transparent; min-height: 36px; padding: 0 15px; }
.sort-button[aria-selected="true"] { background: var(--bps-bg); border-color: var(--bps-line); box-shadow: 0 1px 5px rgba(0, 0, 0, .07); color: var(--bps-brand-dark); font-weight: 650; }
.sort-note { color: var(--bps-text-soft); font-size: 13px; margin: 0; }
.sr-only { height: 1px; margin: -1px; overflow: hidden; padding: 0; position: absolute; width: 1px; clip: rect(0, 0, 0, 0); white-space: nowrap; }

.content { min-height: 100%; padding-bottom: 54px; padding-top: 18px; }
.status-box {
  align-items: center;
  background: var(--bps-bg-soft);
  border: 1px solid var(--bps-line);
  border-radius: 12px;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-height: 54px;
  padding: 10px 14px;
}
.status-main { min-width: 0; }
.status-title { font-size: 14px; font-weight: 650; margin: 0; }
.status-detail { color: var(--bps-text-soft); font-size: 12px; margin: 3px 0 0; }
.progress-track { background: var(--bps-bg-muted); border-radius: 99px; height: 5px; margin-top: 8px; overflow: hidden; }
.progress-bar { background: linear-gradient(90deg, var(--bps-brand), var(--bps-pink)); height: 100%; transition: width .18s ease; width: 0; }
.warning { background: color-mix(in srgb, var(--bps-warn) 10%, var(--bps-bg)); border: 1px solid color-mix(in srgb, var(--bps-warn) 35%, var(--bps-line)); border-radius: 10px; color: var(--bps-text-soft); font-size: 13px; margin-top: 12px; padding: 10px 13px; }

.results-grid {
  display: grid;
  gap: 22px 16px;
  grid-template-columns: repeat(auto-fill, minmax(min(285px, 100%), 1fr));
  margin-top: 18px;
}
.card { background: var(--bps-bg); border: 1px solid var(--bps-line); border-radius: 13px; min-width: 0; overflow: hidden; transition: box-shadow .16s ease, transform .16s ease; }
.card:hover { box-shadow: 0 8px 24px rgba(0, 0, 0, .1); transform: translateY(-2px); }
.cover-link { aspect-ratio: 16 / 9; background: var(--bps-bg-muted); display: block; overflow: hidden; position: relative; }
.cover { display: block; height: 100%; object-fit: cover; transition: transform .2s ease; width: 100%; }
.card:hover .cover { transform: scale(1.02); }
.duration { background: rgba(0, 0, 0, .72); border-radius: 5px; bottom: 7px; color: white; font-size: 11px; padding: 2px 5px; position: absolute; right: 7px; }
.source-badge { background: rgba(0, 0, 0, .66); border-radius: 5px; color: white; font-size: 11px; left: 7px; padding: 2px 5px; position: absolute; top: 7px; }
.card-body { padding: 12px; }
.card-title { color: var(--bps-text); display: -webkit-box; font-size: 15px; font-weight: 650; line-height: 1.45; margin: 0; min-height: 43px; overflow: hidden; text-decoration: none; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.card-title:hover { color: var(--bps-brand-dark); }
.meta, .metrics { color: var(--bps-text-soft); display: flex; flex-wrap: wrap; font-size: 12px; gap: 5px 10px; margin-top: 8px; }
.scores { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
.score { border: 1px solid transparent; border-radius: 999px; font-size: 12px; font-weight: 650; padding: 4px 8px; }
.score-relevance { background: color-mix(in srgb, var(--bps-brand) 13%, var(--bps-bg)); color: var(--bps-brand-dark); }
.score-quality { background: color-mix(in srgb, var(--bps-good) 12%, var(--bps-bg)); color: var(--bps-good); }
.score-growth { background: color-mix(in srgb, var(--bps-growth) 12%, var(--bps-bg)); color: var(--bps-growth); }
.score-timeliness { background: color-mix(in srgb, var(--bps-time) 12%, var(--bps-bg)); color: var(--bps-time); }
.score.is-selected { border-color: currentColor; box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 16%, transparent); }
.data-signals { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.data-signal { background: var(--bps-bg-soft); border: 1px solid var(--bps-line); border-radius: 6px; color: var(--bps-text-soft); font-size: 11px; line-height: 1.3; padding: 3px 6px; }
.growth-status.status-observed, .growth-status.status-real, .online-status.status-available, .online-status.status-sampled { color: var(--bps-good); }
.growth-status.status-estimated, .growth-status.status-estimate, .growth-status.status-average { color: var(--bps-warn); }
.growth-status.status-collecting, .growth-status.status-unavailable, .online-status.status-unavailable, .online-status.status-missing { color: var(--bps-text-faint); }
.reason-primary { color: var(--bps-text-soft); font-size: 12px; line-height: 1.45; margin: 9px 0 0; }
.explanations { border-top: 1px solid var(--bps-line); margin-top: 10px; padding-top: 8px; }
.explanations summary { color: var(--bps-text-soft); cursor: pointer; font-size: 12px; }
.explanation-groups { display: grid; gap: 8px; margin-top: 9px; }
.explanation-group { background: var(--bps-bg-soft); border-radius: 7px; padding: 7px 9px; }
.explanation-group h4 { font-size: 12px; margin: 0; }
.explanation-group ul { color: var(--bps-text-soft); font-size: 12px; line-height: 1.5; margin: 4px 0 0; padding-left: 18px; }
.match-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.match-chip { background: var(--bps-bg-soft); border-radius: 5px; color: var(--bps-text-soft); font-size: 11px; padding: 3px 6px; }

.empty, .error {
  align-items: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 280px;
  padding: 30px;
  text-align: center;
}
.empty-icon { font-size: 40px; }
.empty h3, .error h3 { font-size: 18px; margin: 12px 0 6px; }
.empty p, .error p { color: var(--bps-text-soft); margin: 0 0 16px; max-width: 620px; }
.pagination { align-items: center; display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; margin-top: 28px; }
.page-button { min-height: 36px; min-width: 38px; padding: 0 10px; }
.page-button[aria-current="page"] { background: var(--bps-brand); border-color: var(--bps-brand); color: white; }
.page-button:disabled { cursor: default; opacity: .45; }

@media (max-width: 860px) {
  .toolbar-top { align-items: stretch; flex-wrap: wrap; }
  .heading-wrap { flex: 1; }
  .search-form { flex-basis: 100%; order: 3; }
  .sort-row { align-items: flex-start; flex-direction: column; gap: 7px; }
  .results-grid { grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); }
}
@media (max-width: 520px) {
  .launcher { bottom: calc(18px + env(safe-area-inset-bottom, 0px)) !important; height: 48px; left: auto !important; min-width: 48px; padding: 0; right: 16px !important; top: auto !important; width: 48px; }
  .launcher-label { display: none; }
  .panel { top: 62px !important; }
  .toolbar-inner, .content { padding-left: 12px; padding-right: 12px; }
  .secondary { padding: 0 10px; }
  .sort-group { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
  .sort-button { padding: 0 8px; }
  .status-box { align-items: flex-start; }
  .results-grid { grid-template-columns: 1fr; }
  .card { display: grid; grid-template-columns: minmax(130px, 42%) 1fr; }
  .cover-link { align-self: start; margin: 10px 0 10px 10px; }
  .card-body { padding: 10px; }
  .metrics span:nth-child(n+3) { display: none; }
}
@media (max-width: 380px) {
  .card { display: block; }
  .cover-link { margin: 0; }
  .data-signal { font-size: 10px; }
}
@media (prefers-color-scheme: dark) {
  :host {
    --bps-bg: var(--bg1, #18191c);
    --bps-bg-soft: var(--bg2, #23252a);
    --bps-bg-muted: var(--bg3, #2f3137);
    --bps-text: var(--text1, #f1f2f3);
    --bps-text-soft: var(--text2, #c9ccd0);
    --bps-text-faint: var(--text3, #9499a0);
    --bps-line: var(--line_regular, #3b3d43);
  }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
}
`;
