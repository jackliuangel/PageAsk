/* PageAsk in-page floating panel: static HTML/CSS template.
 * Loaded into every page as a content script BEFORE content.js.
 * Exposes PAL.panelUI = { shell(), css(), icons } — all pure strings.
 * All DOM wiring & page logic lives in content.js.
 */
(function (global) {
  "use strict";

  const PAL = (global.PageAskLib = global.PageAskLib || {});

  /* Minimal inline SVG icon set (stroke = currentColor). */
  const icons = {
    close:
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    gear:
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 5.2A2.8 2.8 0 108 10.8 2.8 2.8 0 108 5.2z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M13.4 8a5.4 5.4 0 00-.1-.8l1.3-1a.5.5 0 00.1-.7l-1.2-2a.5.5 0 00-.7-.2l-1.6.9a5.6 5.6 0 00-1.4-.8L9.6 2a.5.5 0 00-.5-.4H6.9a.5.5 0 00-.5.4l-.3 1.6a5.6 5.6 0 00-1.4.8l-1.6-.9a.5.5 0 00-.7.2l-1.2 2a.5.5 0 00.1.7l1.3 1c0 .3-.1.5-.1.8s0 .5.1.8l-1.3 1a.5.5 0 00-.1.7l1.2 2a.5.5 0 00.7.2l1.6-.9c.4.3.9.6 1.4.8l.3 1.6c0 .2.3.4.5.4h2.2c.3 0 .5-.2.5-.4l.3-1.6c.5-.2 1-.5 1.4-.8l1.6.9c.3.1.6 0 .7-.2l1.2-2a.5.5 0 00-.1-.7l-1.3-1c.1-.3.1-.5.1-.8z" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
    send:
      '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2.5 2.8l11 5.2-11 5.2.9-4.9L9 8l-5.6-.3z" fill="currentColor"/></svg>',
    stop:
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="3.6" y="3.6" width="8.8" height="8.8" rx="1.4" fill="currentColor"/></svg>',
    copy:
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 10.6V3.7A1.7 1.7 0 014.7 2h6.9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    check:
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash:
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7v1.3M4.8 4.5l.5 8.3c0 .5.4.9.9.9h3.6c.5 0 .9-.4.9-.9l.5-8.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    page:
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 2.5h5l3 3v8H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2.5v3h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 9.5h4M6 11.8h2.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    text:
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 3.2h10M8 3.2v9.6M5.5 12.8h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    warn:
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 1.6L15 13.6H1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.4v3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.7" r="0.9" fill="currentColor"/></svg>',
  };

  const css = String.raw`
:host {
  all: initial;
  --pa-bg: #ffffff;
  --pa-bg-soft: #f5f6f8;
  --pa-border: #e4e6eb;
  --pa-text: #1c1e21;
  --pa-text-2: #65676b;
  --pa-accent: #3b6ef6;
  --pa-accent-soft: #eaf0ff;
  --pa-ok: #0a8f4f;
  --pa-warn: #b06000;
  --pa-error: #c62828;
  --pa-radius: 12px;
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, Helvetica,
    Arial, sans-serif;
}
* { box-sizing: border-box; }
button { font-family: inherit; }

.pa-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(400px, 96vw);
  background: var(--pa-bg);
  color: var(--pa-text);
  border-left: 1px solid var(--pa-border);
  box-shadow: -8px 0 28px rgba(0, 0, 0, 0.16);
  display: flex;
  flex-direction: column;
  font-size: 14px;
  line-height: 1.55;
  z-index: 2147483640;
  animation: pa-in 0.16s ease-out;
}
@keyframes pa-in {
  from { transform: translateX(24px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.pa-panel.pa-closing { animation: pa-out 0.12s ease-in forwards; }
@keyframes pa-out {
  to { transform: translateX(24px); opacity: 0; }
}

/* header */
.pa-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--pa-border);
  background: var(--pa-bg-soft);
  flex: 0 0 auto;
}
.pa-logo {
  width: 26px; height: 26px; flex: 0 0 auto; border-radius: 7px;
  background: linear-gradient(135deg, #4f7dff, #7a5cff);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13px;
}
.pa-title-col { min-width: 0; flex: 1 1 auto; }
.pa-title {
  font-weight: 700; font-size: 13px; letter-spacing: 0.2px;
  display: flex; align-items: center; gap: 6px;
}
.pa-title .pa-badge {
  font-size: 10px; font-weight: 600; color: #fff; background: #7a5cff;
  padding: 1px 6px; border-radius: 999px;
}
.pa-pagetitle {
  font-size: 11px; color: var(--pa-text-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pa-icobtn {
  border: 0; background: transparent; color: var(--pa-text-2);
  width: 28px; height: 28px; border-radius: 7px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; flex: 0 0 auto;
}
.pa-icobtn:hover { background: rgba(0,0,0,0.06); color: var(--pa-text); }

/* provider strip */
.pa-provider {
  display: flex; align-items: center; gap: 7px;
  padding: 7px 12px; background: var(--pa-bg);
  border-bottom: 1px solid var(--pa-border); flex: 0 0 auto;
}
.pa-provider .pa-pill {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid transparent; cursor: pointer;
  white-space: nowrap; overflow: hidden;
}
.pa-pill-ok { background: #e9f7f0; color: #0a6d44; border-color: #b5e3cd; }
.pa-pill-bad { background: #fdf3e2; color: #8a5a00; border-color: #f0d9ad; cursor: pointer; }
.pa-provider .pa-pill span:last-child {
  overflow: hidden; text-overflow: ellipsis; max-width: 190px;
}
.pa-provider .pa-plain { font-size: 11px; color: var(--pa-text-2); margin-left: auto; white-space: nowrap; }

/* mode & actions */
.pa-tools { padding: 8px 12px 6px; border-bottom: 1px solid var(--pa-border); flex: 0 0 auto; }
.pa-modes { display: flex; gap: 6px; margin-bottom: 8px; }
.pa-mode {
  border: 1px solid var(--pa-border); background: var(--pa-bg);
  color: var(--pa-text-2); font-size: 12px; padding: 3px 10px;
  border-radius: 999px; cursor: pointer; display: inline-flex;
  align-items: center; gap: 5px;
}
.pa-mode:hover { border-color: #c6ccd6; }
.pa-mode[aria-pressed="true"] {
  background: var(--pa-accent-soft); color: var(--pa-accent);
  border-color: #b7ccff; font-weight: 600;
}
.pa-mode:disabled { opacity: 0.45; cursor: not-allowed; }
.pa-mode .pa-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--pa-ok); }
.pa-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.pa-act {
  border: 1px solid var(--pa-border); background: var(--pa-bg);
  color: var(--pa-text); font-size: 12.5px; padding: 4px 11px;
  border-radius: 8px; cursor: pointer; display: inline-flex;
  align-items: center; gap: 6px;
}
.pa-act:hover { background: var(--pa-bg-soft); }
.pa-act.pa-primary { background: var(--pa-accent); color: #fff; border-color: var(--pa-accent); }
.pa-act.pa-primary:hover { background: #2f5de0; }
.pa-optrow { display: flex; align-items: center; gap: 8px; padding: 2px 0 4px; }
.pa-optrow label { font-size: 12px; color: var(--pa-text-2); }
.pa-optrow select {
  font-size: 12px; padding: 2px 6px; border: 1px solid var(--pa-border);
  border-radius: 7px; background: var(--pa-bg); color: var(--pa-text);
  max-width: 150px;
}
.pa-extrainfo {
  font-size: 11px; color: var(--pa-text-2); padding: 2px 0 4px;
  display: none; align-items: center; gap: 5px;
}
.pa-extrainfo.pa-show { display: flex; }

/* thread */
.pa-thread {
  flex: 1 1 auto; overflow-y: auto; padding: 12px;
  display: flex; flex-direction: column; gap: 12px;
  background: var(--pa-bg);
  scroll-behavior: smooth;
}
.pa-thread::-webkit-scrollbar { width: 8px; }
.pa-thread::-webkit-scrollbar-thumb { background: #d4d7dd; border-radius: 4px; }

.pa-msg-user {
  align-self: flex-end; max-width: 88%;
  background: var(--pa-accent); color: #fff;
  border-radius: 14px 14px 4px 14px; padding: 8px 12px;
  font-size: 13.5px; white-space: pre-wrap; word-break: break-word;
}
.pa-msg-ai {
  align-self: stretch; background: var(--pa-bg-soft);
  border: 1px solid var(--pa-border); border-radius: var(--pa-radius);
  padding: 9px 11px 7px; min-width: 0;
}
.pa-msg-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--pa-text-2); margin-bottom: 5px;
}
.pa-msg-head .pa-tag {
  font-weight: 700; color: var(--pa-accent);
}
.pa-msg-head .pa-spacer { flex: 1 1 auto; }
.pa-msg-head button {
  border: 0; background: transparent; color: var(--pa-text-2);
  cursor: pointer; padding: 2px 4px; border-radius: 5px;
  display: inline-flex; align-items: center; gap: 3px; font-size: 11px;
}
.pa-msg-head button:hover { background: rgba(0,0,0,0.06); color: var(--pa-text); }
.pa-msg-head button.pa-copied { color: var(--pa-ok); }

.pa-reasoning {
  border-left: 3px solid #c9a94a; background: #fbf6e6;
  border-radius: 4px 8px 8px 4px; margin: 0 0 8px; padding: 6px 9px;
  font-size: 12px; color: #6a5a22;
}
.pa-reasoning summary { cursor: pointer; font-weight: 600; user-select: none; }
.pa-reasoning .pa-rbody { margin-top: 6px; white-space: pre-wrap; word-break: break-word; }
.pa-reasoning[hidden] { display: none; }

.pa-md { font-size: 13.5px; word-break: break-word; min-width: 0; }
.pa-md p { margin: 0 0 8px; }
.pa-md p:last-child { margin-bottom: 0; }
.pa-md h1, .pa-md h2, .pa-md h3, .pa-md h4 {
  font-size: 14px; margin: 10px 0 6px; line-height: 1.4;
}
.pa-md ul, .pa-md ol { margin: 4px 0 8px; padding-left: 20px; }
.pa-md li { margin: 2px 0; }
.pa-md blockquote {
  margin: 6px 0; padding: 2px 10px; border-left: 3px solid #cfd4dd;
  color: var(--pa-text-2);
}
.pa-md code {
  background: rgba(0,0,0,0.07); border-radius: 4px; padding: 1px 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.pa-md pre {
  background: #23272f; color: #e8eaed; padding: 9px 11px; border-radius: 8px;
  overflow-x: auto; margin: 6px 0;
}
.pa-md pre code { background: transparent; padding: 0; font-size: 12px; color: inherit; }
.pa-md a { color: var(--pa-accent); text-decoration: none; }
.pa-md a:hover { text-decoration: underline; }
.pa-md hr { border: 0; border-top: 1px solid var(--pa-border); margin: 8px 0; }
.pa-md table { border-collapse: collapse; margin: 6px 0; max-width: 100%; }
.pa-md th, .pa-md td { border: 1px solid var(--pa-border); padding: 3px 7px; font-size: 12.5px; }

.pa-stream-caret {
  display: inline-block; width: 7px; height: 14px; margin-left: 2px;
  background: var(--pa-accent); vertical-align: text-bottom;
  animation: pa-blink 0.9s steps(1) infinite;
}
@keyframes pa-blink { 50% { opacity: 0; } }

.pa-msg-error {
  display: flex; gap: 8px; align-items: flex-start;
  background: #fdeeee; border: 1px solid #f3c4c4; color: var(--pa-error);
  border-radius: var(--pa-radius); padding: 9px 11px; font-size: 13px;
  align-self: stretch; min-width: 0;
}
.pa-msg-error > .pa-err { flex: 0 0 auto; display: flex; margin-top: 2px; }
.pa-err-title { font-weight: 700; font-size: 12.5px; }
.pa-err-msg { font-size: 12.5px; margin-top: 3px; opacity: 0.96; word-break: break-word; }
.pa-msg-error .pa-errbtn {
  border: 0; background: var(--pa-error); color: #fff; cursor: pointer;
  font-size: 12px; padding: 3px 10px; border-radius: 7px; margin-top: 7px;
}
.pa-errbtn:hover { filter: brightness(1.1); }
.pa-msg-note {
  align-self: center; font-size: 12px; color: var(--pa-text-2);
  background: var(--pa-bg-soft); border: 1px dashed #c9ced6;
  padding: 5px 12px; border-radius: 999px; text-align: center;
}
.pa-msg-note.pa-warn { color: var(--pa-warn); border-color: #e8cf9e; background: #fdf7ea; }

.pa-empty { margin: auto; text-align: center; color: var(--pa-text-2); padding: 18px 8px; max-width: 300px; }
.pa-empty .pa-big { font-size: 26px; margin-bottom: 8px; }
.pa-empty b { color: var(--pa-text); }

/* composer */
.pa-composer {
  flex: 0 0 auto; border-top: 1px solid var(--pa-border);
  padding: 8px 12px 10px; background: var(--pa-bg);
}
.pa-ctx {
  font-size: 11px; color: var(--pa-text-2); margin-bottom: 5px;
  display: flex; align-items: center; gap: 5px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.pa-composer-inner {
  display: flex; align-items: flex-end; gap: 6px;
  background: var(--pa-bg-soft); border: 1px solid var(--pa-border);
  border-radius: 14px; padding: 6px 6px 6px 12px;
}
.pa-composer-inner:focus-within { border-color: var(--pa-accent); }
.pa-ta {
  border: 0; background: transparent; resize: none; outline: none;
  font: inherit; font-size: 13.5px; color: var(--pa-text);
  flex: 1 1 auto; min-height: 22px; max-height: 130px; padding: 2px 0;
}
.pa-ta::placeholder { color: #9aa0a8; }
.pa-sendbtn {
  border: 0; border-radius: 10px; width: 34px; height: 34px; flex: 0 0 auto;
  background: var(--pa-accent); color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.pa-sendbtn:hover { background: #2f5de0; }
.pa-sendbtn:disabled { background: #b9c4de; cursor: default; }
.pa-sendbtn.pa-stop { background: var(--pa-text-2); }
.pa-sendbtn.pa-stop:hover { background: var(--pa-error); }
.pa-footnote {
  font-size: 10.5px; color: #a2a7af; margin-top: 5px; text-align: center;
}

/* Dark mode — follows the browser / OS prefers-color-scheme. */
@media (prefers-color-scheme: dark) {
  :host {
    --pa-bg: #1e1f24;
    --pa-bg-soft: #27282f;
    --pa-border: #34363e;
    --pa-text: #e8eaed;
    --pa-text-2: #9aa0a8;
    --pa-accent: #6f8dff;
    --pa-accent-soft: #2a3350;
    --pa-ok: #34c77f;
    --pa-warn: #e0a84c;
    --pa-error: #ff6b6b;
  }
  .pa-panel { box-shadow: -8px 0 28px rgba(0, 0, 0, 0.5); }
  .pa-icobtn:hover,
  .pa-msg-head button:hover { background: rgba(255, 255, 255, 0.08); }
  .pa-pill-ok { background: #123324; color: #57e0a0; border-color: #1f5b3c; }
  .pa-pill-bad { background: #33280f; color: #e0b55c; border-color: #5c4a1f; }
  .pa-mode:hover { border-color: #4a4d55; }
  .pa-mode[aria-pressed="true"] { border-color: #5a6bb8; }
  .pa-act.pa-primary:hover,
  .pa-sendbtn:hover { background: #5a7df0; }
  .pa-thread::-webkit-scrollbar-thumb { background: #4a4d55; }
  .pa-reasoning { border-left-color: #b08d2f; background: #2c2614; color: #e0c26a; }
  .pa-md blockquote { border-left-color: #4a4d55; }
  .pa-md code { background: rgba(255, 255, 255, 0.1); }
  .pa-md pre { background: #14161a; color: #e8eaed; }
  .pa-msg-error { background: #2e1b1b; border-color: #5c2b2b; }
  .pa-msg-note { border-color: #4a4d55; }
  .pa-msg-note.pa-warn { border-color: #5c4a1f; background: #33280f; }
  .pa-ta::placeholder { color: #6b7280; }
  .pa-sendbtn:disabled { background: #3a3d45; }
  .pa-footnote { color: #6b7280; }
}
`; // css

  const shell = String.raw`
<div class="pa-panel" id="pa-panel" role="dialog" aria-label="PageAsk 页问">
  <div class="pa-head">
    <div class="pa-logo">P</div>
    <div class="pa-title-col">
      <div class="pa-title">PageAsk <span class="pa-badge">页问</span></div>
      <div class="pa-pagetitle" id="pa-pagetitle">…</div>
    </div>
    <button class="pa-icobtn" id="pa-clear" title="清空对话">${icons.trash}</button>
    <button class="pa-icobtn" id="pa-settings" title="设置 API Key">${icons.gear}</button>
    <button class="pa-icobtn" id="pa-close" title="关闭 (Esc)">${icons.close}</button>
  </div>

  <div class="pa-provider">
    <span class="pa-pill pa-pill-bad" id="pa-pill" title="打开设置">
      ${icons.warn}<span>未配置 API Key</span>
    </span>
    <span class="pa-plain" id="pa-plain"></span>
  </div>

  <div class="pa-tools">
    <div class="pa-modes">
      <button class="pa-mode" id="pa-mode-page" aria-pressed="true">${icons.page} 整页</button>
      <button class="pa-mode" id="pa-mode-sel" aria-pressed="false" disabled>${icons.text} 当前选区</button>
      <span style="flex:1"></span>
      <button class="pa-act pa-primary" id="pa-act-translate">${icons.text}<span>翻译</span></button>
      <button class="pa-act" id="pa-act-summarize"><span>总结</span></button>
      <button class="pa-act" id="pa-act-explain" style="display:none"><span>解释选区</span></button>
    </div>
    <div class="pa-optrow">
      <label for="pa-lang">目标语言</label>
      <select id="pa-lang">
        <option value="简体中文">简体中文</option>
        <option value="繁體中文">繁體中文</option>
        <option value="English">English</option>
        <option value="日本語">日本語</option>
        <option value="한국어">한국어</option>
      </select>
      <label for="pa-lang" id="pa-ctxmeta"></label>
    </div>
  </div>

  <div class="pa-thread" id="pa-thread"></div>

  <div class="pa-composer">
    <div class="pa-ctx" id="pa-ctx">将使用当前整页内容进行问答</div>
    <div class="pa-composer-inner">
      <textarea class="pa-ta" id="pa-ta" rows="1"
        placeholder="就此页面提问，或直接问选中的文字…（Ctrl/⌘ + Enter 发送）"></textarea>
      <button class="pa-sendbtn" id="pa-send" title="发送">${icons.send}</button>
    </div>
    <div class="pa-footnote" id="pa-footnote"></div>
  </div>
</div>`;

  PAL.panelUI = { icons, css, shell, LANGS: ["简体中文", "繁體中文", "English", "日本語", "한국어"] };
})(typeof globalThis !== "undefined" ? globalThis : this);
