/* PageAsk content script — in-page side panel.
 *
 * Responsibilities:
 *  - Extract readable text of the current page (整页) or the user selection (选区)
 *  - Render a floating side panel in a Shadow DOM (does NOT touch the page DOM)
 *  - Stream LLM answers over a long-lived port to the background worker, which
 *    owns the API key and performs every /chat/completions call.
 *
 * Runs at document_idle in the top frame. libs (md, extract, panel-ui) are
 * injected before this file by the manifest, exposing window.PageAskLib (PAL).
 */
(function () {
  "use strict";
  if (window.top !== window) return; // top frame only
  if (window.__pageask) return; // already injected (guard against double injection)
  const PAL = window.PageAskLib;
  if (!PAL || !PAL.panelUI || !PAL.md) return;
  const api = window.browser || window.chrome;
  if (!api || !api.runtime) return;

  const MAX_SEL = 12000; // cap on selection characters sent to the model

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */

  const S = {
    port: null,
    built: false,
    open: false,
    busy: false,
    mode: "page", // 'page' | 'sel'
    lang: "简体中文",
    snapshot: null, // from background describeActive()
    pageCache: null,
    thread: null,
    lastId: null,
    activeBubble: null,
    nextId: 1,
    els: null,
    emptyNode: null,
  };

  /* ------------------------------------------------------------------ */
  /* page text extraction                                                */
  /* ------------------------------------------------------------------ */

  const BLOCK_SEL =
    "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,dt,dd,figcaption";
  const NOISE_SEL =
    "script,style,noscript,template,svg,canvas,iframe,video,audio,select," +
    "textarea,button,input,nav,aside,footer,form";

  function contentRoot() {
    const art = document.querySelector("article");
    if (art) return art;
    const main = document.querySelector("main");
    if (main) return main;
    return document.body;
  }

  function skipNoise(el) {
    return !!(el.closest && el.closest(NOISE_SEL));
  }

  function hidden(el) {
    try {
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
    } catch { /* ignore */ }
    return el.getAttribute && el.getAttribute("aria-hidden") === "true";
  }

  const NOISE_RE =
    /^(?:cookie|cookies|登录|登入|注册|订阅|menu|navigation|广告|赞助|分享|评论|回复|©|copyright|跳转|阅读原文|相关文章|你可能喜欢)/i;

  /** Walk text blocks under root, respecting a maxChars budget. */
  function collectBlocks(maxChars) {
    const root = contentRoot();
    const nodes = Array.from(root.querySelectorAll(BLOCK_SEL));
    const kept = [];
    for (const el of nodes) {
      if (skipNoise(el) || hidden(el)) continue;
      let p = el.parentElement;
      let nested = false;
      while (p && p !== root) {
        if (p.matches && p.matches(BLOCK_SEL)) {
          nested = true; // parent block also collected -> parent is enough
          break;
        }
        p = p.parentElement;
      }
      if (nested) continue;
      kept.push(el);
    }
    const lines = [];
    let budget = Math.max(maxChars, 3000) * 1.4;
    let seen = 0;
    for (const el of kept) {
      const raw = el.textContent || "";
      const text = PAL.extract.tidyLine(raw);
      if (!text || text.length < 2) continue;
      if (NOISE_RE.test(text)) continue;
      lines.push(text);
      seen += text.length;
      if (seen >= budget) break;
    }
    return lines;
  }

  function pageText(maxChars) {
    if (S.pageCache) return S.pageCache; // text of a document doesn't change
    const lines = collectBlocks(maxChars || 16000);
    let joined = PAL.extract.joinLines(lines);
    joined = PAL.extract.normalizeWhitespace(joined);
    const t = PAL.extract.truncate(joined, maxChars || 16000);
    S.pageCache = {
      text: t.text,
      truncated: t.truncated,
      charCount: t.originalLength,
      title: document.title,
      url: location.href,
    };
    return S.pageCache;
  }

  function clearPageCache() {
    S.pageCache = null;
  }

  function selectionText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return "";
    const t = sel.toString();
    if (!t) return "";
    return PAL.extract.tidyLine(t).slice(0, MAX_SEL);
  }

  /* ------------------------------------------------------------------ */
  /* panel construction                                                  */
  /* ------------------------------------------------------------------ */

  function buildPanel() {
    const host = document.createElement("div");
    host.id = "pageask-root";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PAL.panelUI.css;
    shadow.appendChild(style);

    const panel = document.createElement("div");
    panel.innerHTML = PAL.panelUI.shell;
    shadow.appendChild(panel);

    const byId = {};
    const ids = [
      "pa-panel", "pa-pagetitle", "pa-pill", "pa-plain", "pa-mode-page",
      "pa-mode-sel", "pa-act-translate", "pa-act-summarize", "pa-act-explain",
      "pa-lang", "pa-thread", "pa-ctx", "pa-ta", "pa-send", "pa-clear",
      "pa-close", "pa-settings", "pa-footnote",
    ];
    for (const id of ids) {
      const el = panel.querySelector("#" + id);
      if (el) byId[id] = el;
    }
    S.els = byId;
    S.thread = byId["pa-thread"];
    S.built = true;

    host.style.cssText =
      "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;";
    (document.body || document.documentElement).appendChild(host);

    // current page title (may be absent on some pages)
    const t = S.els["pa-pagetitle"];
    if (t && document.title) t.textContent = document.title.slice(0, 90);

    bindEvents();
    addEmptyState();
  }

  function bindEvents() {
    const e = S.els;
    e["pa-close"].addEventListener("click", closePanel);
    e["pa-settings"].addEventListener("click", openSettings);
    e["pa-pill"].addEventListener("click", openSettings);
    e["pa-clear"].addEventListener("click", clearThread);

    e["pa-mode-page"].addEventListener("click", () => chooseMode("page"));
    e["pa-mode-sel"].addEventListener("click", () => chooseMode("sel"));
    e["pa-act-translate"].addEventListener("click", () => runQuick("translate"));
    e["pa-act-summarize"].addEventListener("click", () => runQuick("summarize"));
    e["pa-act-explain"].addEventListener("click", () => runQuick("explain"));

    e["pa-ta"].addEventListener("input", autoGrow);
    e["pa-ta"].addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        sendUserAsk();
      }
    });
    e["pa-send"].addEventListener("click", () => {
      if (S.busy) stopStream();
      else sendUserAsk();
    });
    e["pa-lang"].addEventListener("change", () => {
      S.lang = e["pa-lang"].value;
      refreshMetaLine();
    });

    document.addEventListener("selectionchange", onSelectionDebounced);
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && S.open && !S.busy) closePanel();
    });
  }

  function addEmptyState() {
    if (S.emptyNode || (S.thread && S.thread.children.length)) return;
    const div = document.createElement("div");
    div.className = "pa-empty";
    div.innerHTML =
      '<div class="pa-big">💬</div>' +
      "<div><b>对当前网页提问</b></div>" +
      "<div>输入问题即可基于整页回答；用「翻译」「总结」把整页变中文；先选中一段文字再翻译 / 解释选区。</div>";
    S.thread.appendChild(div);
    S.emptyNode = div;
  }

  function removeEmptyState() {
    if (S.emptyNode) {
      S.emptyNode.remove();
      S.emptyNode = null;
    }
  }

  function setVisible(show) {
    if (S.open === show) return;
    S.open = show;
    const p = S.els["pa-panel"];
    if (show) {
      clearPageCache();
      p.classList.remove("pa-closing");
      p.style.display = "";
      refreshSnapshot();
      updateSelectionUI();
      refreshMetaLine();
      autoGrow();
      S.els["pa-ta"].focus();
    } else {
      p.classList.add("pa-closing");
      setTimeout(() => {
        p.style.display = "none";
        p.classList.remove("pa-closing");
      }, 120);
    }
  }

  function togglePanel() {
    if (!S.built) buildPanel();
    setVisible(!S.open);
  }
  function closePanel() { setVisible(false); }

  /* ------------------------------------------------------------------ */
  /* messaging: content <-> background                                   */
  /* ------------------------------------------------------------------ */

  function portConnect() {
    let port;
    try {
      port = api.runtime.connect({ name: "pageask" });
    } catch { return null; }
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => {
      S.port = null;
      if (S.busy) {
        // service worker died mid-stream
        endAsk();
        pushError("连接中断", "与扩展后台的连接意外中断，请重试。", false);
      }
    });
    S.port = port;
    try { port.postMessage({ type: "hello" }); } catch { /* ignore */ }
    return port;
  }

  function portGet() {
    if (!S.port) portConnect();
    return S.port;
  }

  function onPortMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "snapshot") {
      applySnapshot(msg.info);
      return;
    }
    if (!S.activeBubble || msg.id !== S.lastId) return;
    if (msg.type === "delta") {
      S.activeBubble.append(msg.text || "");
    } else if (msg.type === "reasoning") {
      S.activeBubble.appendReasoning(msg.text || "");
    } else if (msg.type === "done") {
      S.activeBubble.finish();
      endAsk();
    } else if (msg.type === "error") {
      S.activeBubble.finish();
      endAsk();
      const needSettings =
        msg.code === "NO_CONFIG" || msg.code === "AUTH" || msg.code === "STORAGE";
      pushError(msg.code || "错误", msg.message || "模型服务返回错误。", needSettings);
    }
  }

  function applySnapshot(info) {
    if (!info) return;
    S.snapshot = info;
    if (info.lang) S.lang = info.lang;
    if (S.els) {
      const sel = S.els["pa-lang"];
      if (sel && sel.value !== info.lang) sel.value = info.lang;
      updateProviderPill();
      refreshMetaLine();
    }
  }

  function updateProviderPill() {
    const pill = S.els["pa-pill"];
    const plain = S.els["pa-plain"];
    if (!pill || !plain) return;
    const info = S.snapshot;
    pill.textContent = "";
    if (info && info.configured) {
      pill.className = "pa-pill pa-pill-ok";
      const name = document.createElement("span");
      name.textContent =
        `${info.fullName || info.providerName || "模型"} · ${info.model || ""}`;
      pill.appendChild(name);
      plain.textContent = info.siteLabel || "";
      pill.title = "已配置，点击修改";
    } else {
      pill.className = "pa-pill pa-pill-bad";
      const name = document.createElement("span");
      name.textContent =
        info && info.needsCustomUrl
          ? "自定义端点未填全 · 点击设置"
          : "未配置 API Key · 点击设置";
      pill.appendChild(name);
      plain.textContent = "";
      pill.title = "打开设置页";
    }
  }

  function openSettings() {
    try {
      api.runtime.sendMessage({ type: "open-options" });
    } catch { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* small UI updates                                                    */
  /* ------------------------------------------------------------------ */

  function refreshMetaLine() {
    if (!S.els) return;
    const lang = S.lang || "简体中文";
    const sel = S.mode === "sel";
    const setLabel = (btn, txt) => {
      const span = btn && btn.querySelector("span");
      if (span) span.textContent = txt;
    };
    const btnTranslate = S.els["pa-act-translate"];
    const btnSum = S.els["pa-act-summarize"];
    const btnExp = S.els["pa-act-explain"];
    if (sel) {
      setLabel(btnTranslate, "翻译选区");
      setLabel(btnExp, "解释选区");
      btnSum.style.display = "none";
      btnExp.style.display = "";
    } else {
      setLabel(btnTranslate, "翻译");
      setLabel(btnSum, "总结");
      btnSum.style.display = "";
      btnExp.style.display = "none";
    }
    S.els["pa-ctx"].textContent = sel
      ? "将基于当前选中文字进行问答"
      : "将基于当前整页内容进行问答";
    S.els["pa-footnote"].textContent =
      `目标语言 ${lang} · 页面文本会发送给你配置的模型服务，仅用于本次问答 · API Key 只存本机`;
  }

  function updateSelectionUI() {
    const has = !!selectionText();
    const selBtn = S.els["pa-mode-sel"];
    const pageBtn = S.els["pa-mode-page"];
    if (!has && S.mode === "sel") S.mode = "page"; // selection vanished
    selBtn.disabled = !has;
    selBtn.setAttribute("aria-pressed", String(S.mode === "sel"));
    pageBtn.setAttribute("aria-pressed", String(S.mode === "page"));
    refreshMetaLine();
  }

  function chooseMode(mode) {
    if (mode === "sel" && !selectionText()) {
      pushNote("请先在网页中选中一段文字，再切到「当前选区」。", true);
      return;
    }
    S.mode = mode;
    updateSelectionUI();
  }

  let debounce = null;
  function onSelectionDebounced() {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      if (S.open) updateSelectionUI();
    }, 160);
  }

  function autoGrow() {
    const ta = S.els["pa-ta"];
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }

  function scrollToBottom() {
    const t = S.thread;
    if (t) t.scrollTop = t.scrollHeight;
  }

  function clearThread() {
    if (S.busy) stopStream();
    while (S.thread.firstChild) S.thread.removeChild(S.thread.firstChild);
    addEmptyState();
    scrollToBottom();
  }

  /* ------------------------------------------------------------------ */
  /* chat bubbles                                                        */
  /* ------------------------------------------------------------------ */

  function pushUser(text) {
    removeEmptyState();
    const div = document.createElement("div");
    div.className = "pa-msg-user";
    div.textContent = text;
    S.thread.appendChild(div);
    scrollToBottom();
  }

  function pushError(label, message, needSettings) {
    removeEmptyState();
    const div = document.createElement("div");
    div.className = "pa-msg-error";
    div.innerHTML = `<div class="pa-err">${PAL.panelUI.icons.warn}</div>`;
    const body = document.createElement("div");
    body.style.minWidth = "0";
    const title = document.createElement("div");
    title.className = "pa-err-title";
    title.textContent = label;
    const msg = document.createElement("div");
    msg.className = "pa-err-msg";
    msg.textContent = message;
    body.appendChild(title);
    body.appendChild(msg);
    if (needSettings) {
      const btn = document.createElement("button");
      btn.className = "pa-errbtn";
      btn.textContent = "打开设置";
      btn.addEventListener("click", openSettings);
      body.appendChild(btn);
    }
    div.appendChild(body);
    S.thread.appendChild(div);
    scrollToBottom();
  }

  function pushNote(text, warn) {
    removeEmptyState();
    const div = document.createElement("div");
    div.className = "pa-msg-note" + (warn ? " pa-warn" : "");
    div.textContent = text;
    S.thread.appendChild(div);
    scrollToBottom();
  }

  function caretHtml() {
    return '<span class="pa-stream-caret"></span>';
  }

  /** Create an assistant bubble; returns a writer handle. */
  function createBubble(tagLine) {
    removeEmptyState();
    const div = document.createElement("div");
    div.className = "pa-msg-ai";

    const head = document.createElement("div");
    head.className = "pa-msg-head";
    const tag = document.createElement("span");
    tag.className = "pa-tag";
    tag.textContent = tagLine || "AI";
    head.appendChild(tag);
    const spacer = document.createElement("span");
    spacer.className = "pa-spacer";
    head.appendChild(spacer);
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.title = "复制回答";
    copyBtn.innerHTML = PAL.panelUI.icons.copy;
    copyBtn.addEventListener("click", () => {
      const text = mdBody.textContent || "";
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = PAL.panelUI.icons.check;
        setTimeout(() => { copyBtn.innerHTML = PAL.panelUI.icons.copy; }, 900);
      }).catch(() => pushNote("复制失败：当前页面不允许访问剪贴板。", true));
    });
    head.appendChild(copyBtn);
    div.appendChild(head);

    const reas = document.createElement("details");
    reas.className = "pa-reasoning";
    reas.style.display = "none";
    const reasSum = document.createElement("summary");
    reasSum.textContent = "思考过程";
    const reasBody = document.createElement("div");
    reasBody.className = "pa-rbody";
    reas.appendChild(reasSum);
    reas.appendChild(reasBody);
    div.appendChild(reas);

    const mdBody = document.createElement("div");
    mdBody.className = "pa-md";
    div.appendChild(mdBody);

    S.thread.appendChild(div);
    scrollToBottom();

    let raw = "";
    let reasoning = "";
    let rafId = null;

    const render = () => {
      rafId = null;
      mdBody.innerHTML = PAL.md.render(raw) + (finished ? "" : caretHtml());
    };
    const scheduleRender = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(render);
    };

    let finished = false;
    const handle = {
      append(text) {
        if (finished) return;
        raw += text;
        scheduleRender();
        scrollToBottom();
      },
      appendReasoning(text) {
        if (finished) return;
        reasoning += text;
        reas.style.display = "";
        reasBody.textContent = reasoning;
      },
      finish() {
        if (finished) return;
        finished = true;
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        mdBody.innerHTML = PAL.md.render(raw);
        scrollToBottom();
      },
      get rawText() { return raw; },
      get reasoningText() { return reasoning; },
      get done() { return finished; },
    };
    return handle;
  }

  /* ------------------------------------------------------------------ */
  /* ask pipeline                                                        */
  /* ------------------------------------------------------------------ */

  function lang() { return S.lang || (S.snapshot && S.snapshot.lang) || "简体中文"; }
  function maxChars() { return (S.snapshot && S.snapshot.maxChars) || 16000; }

  function sendToBackground(payload) {
    const port = portGet();
    if (!port) {
      pushError("无法连接", "与扩展后台通信失败，请刷新页面重试。", false);
      return false;
    }
    try {
      port.postMessage({ type: "ask", ...payload });
    } catch (err) {
      pushError("发送失败", String((err && err.message) || err), false);
      return false;
    }
    return true;
  }

  function startAsk(payload, userLabel) {
    if (S.busy) return;
    const snap = S.snapshot;
    if (!(snap && snap.configured)) {
      pushError("未配置 API", "请先打开扩展设置页，选择模型并填入你的 API Key。", true);
      return;
    }
    const id = "r" + S.nextId++;
    S.lastId = id;
    S.busy = true;
    updateBusyUI();

    pushUser(userLabel);
    const bubble = createBubble(
      `${snap.fullName || snap.providerName || "模型"} · ${snap.model || ""}`
    );
    S.activeBubble = bubble;

    if (!sendToBackground({ ...payload, id })) {
      bubble.finish();
      S.activeBubble = null;
      S.busy = false;
      updateBusyUI();
    }
  }

  function endAsk() {
    S.busy = false;
    S.activeBubble = null;
    S.lastId = null;
    updateBusyUI();
  }

  function stopStream() {
    if (!S.busy) return;
    if (S.port) {
      try { S.port.postMessage({ type: "stop" }); } catch { /* ignore */ }
    }
    if (S.activeBubble) {
      S.activeBubble.finish();
      pushNote("已停止生成。", false);
    }
    endAsk();
  }

  function updateBusyUI() {
    if (!S.els) return;
    const send = S.els["pa-send"];
    for (const id of ["pa-act-translate", "pa-act-summarize", "pa-act-explain"]) {
      const b = S.els[id];
      if (b) b.disabled = S.busy;
    }
    send.classList.toggle("pa-stop", S.busy);
    send.innerHTML = S.busy ? PAL.panelUI.icons.stop : PAL.panelUI.icons.send;
    send.title = S.busy ? "停止生成" : "发送";
  }

  function runQuick(kind) {
    if (S.busy) return;
    const l = lang();
    if (kind === "translate") {
      if (S.mode === "sel") {
        const sel = selectionText();
        if (!sel) { chooseMode("sel"); return; }
        startAsk({
          task: "selection-translate",
          pageText: sel,
          truncated: false,
          charCount: sel.length,
          lang: l,
          pageTitle: document.title,
          pageUrl: location.href,
        }, `翻译选区 → ${l}`);
      } else {
        const pg = pageText(maxChars());
        startAsk({
          task: "translate",
          pageText: pg.text,
          truncated: pg.truncated,
          charCount: pg.charCount,
          lang: l,
          pageTitle: pg.title,
          pageUrl: pg.url,
        }, `翻译整页 → ${l}`);
      }
    } else if (kind === "summarize") {
      const pg = pageText(maxChars());
      startAsk({
        task: "summarize",
        pageText: pg.text,
        truncated: pg.truncated,
        charCount: pg.charCount,
        lang: l,
        pageTitle: pg.title,
        pageUrl: pg.url,
      }, `总结整页 · 正文 ${pg.charCount.toLocaleString()} 字${pg.truncated ? "（过长已截断）" : ""}`);
    } else if (kind === "explain") {
      const sel = selectionText();
      if (!sel) { chooseMode("sel"); return; }
      startAsk({
        task: "ask",
        userText: "请解释这段文字：讲的是什么？背景与上下文是什么？有哪些关键细节值得留意？",
        pageText: sel,
        usedSelection: true,
        truncated: false,
        charCount: sel.length,
        lang: l,
        pageTitle: document.title,
        pageUrl: location.href,
      }, `解释选区（${sel.length} 字）`);
    }
  }

  function sendUserAsk() {
    if (S.busy) return;
    const ta = S.els["pa-ta"];
    const text = ta.value.trim();
    if (!text) return;
    ta.value = "";
    autoGrow();

    if (S.mode === "sel") {
      const sel = selectionText();
      if (sel) {
        startAsk({
          task: "ask",
          userText: text,
          pageText: sel,
          usedSelection: true,
          truncated: false,
          charCount: sel.length,
          lang: lang(),
          pageTitle: document.title,
          pageUrl: location.href,
        }, text);
        return;
      }
      // selection vanished -> fall through to whole page
    }
    const pg = pageText(maxChars());
    startAsk({
      task: "ask",
      userText: text,
      pageText: pg.text,
      truncated: pg.truncated,
      charCount: pg.charCount,
      lang: lang(),
      pageTitle: pg.title,
      pageUrl: pg.url,
    }, text);
  }

  /* ------------------------------------------------------------------ */
  /* init                                                                */
  /* ------------------------------------------------------------------ */

  function refreshSnapshot() {
    if (S.port) {
      try { S.port.postMessage({ type: "hello" }); } catch { /* ignore */ }
      return;
    }
    portConnect(); // posts hello on connect (reconnects after SW restarts)
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "pageask:toggle") {
      togglePanel();
      try { sendResponse({ ok: true }); } catch { /* ignore */ }
      return false;
    }
    return false;
  });

  // Keyboard shortcut ⌘K toggles the panel directly in-page. Safari has limited
  // support for the manifest `commands` API, so a content-script listener is the
  // reliable path there; it also works in Chrome alongside `_execute_action`.
  window.addEventListener(
    "keydown",
    (ev) => {
      if (!ev.metaKey || ev.altKey || ev.ctrlKey || ev.shiftKey) return;
      const key = ev.key && ev.key.toLowerCase();
      if (key !== "k") return;
      // Don't hijack ⌘K while the user is typing in a *page* field. The panel's
      // own input/textarea are exempt so ⌘K still toggles (hides) the panel even
      // when its prompt box has focus.
      const panel = S.els && S.els["pa-panel"];
      const inPageField = ev.composedPath().some((n) => {
        if (!n || !n.tagName) return false;
        if (panel && panel.contains(n)) return false;
        const t = n.tagName;
        return t === "INPUT" || t === "TEXTAREA" || n.isContentEditable;
      });
      if (inPageField) return;
      ev.preventDefault();
      ev.stopPropagation();
      togglePanel();
    },
    true
  );

  // public hook for tests/debug
  window.__pageask = {
    togglePanel,
    collectBlocks,
    state: S,
  };
})();
