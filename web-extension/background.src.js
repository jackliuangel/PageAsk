/* PageAsk background service worker.
 * Responsibilities:
 *  - Toolbar click -> toggle the in-page panel (inject on demand)
 *  - Own the LLM API key: every /chat/completions call happens HERE, never
 *    in content scripts (which cannot see the key, and would hit page CORS).
 *  - Stream deltas over long-lived ports; map provider errors to friendly text.
 *  - Handle one-shot messages: snapshot, open options, test connection.
 */
/* Dependency libs (lib/browser.js, providers.js, sse.js, prompts.js) are
 * inlined by scripts/bundle-background.js into the shipped background.js.
 * Safari runs the background as "background content" (a page, not a worker),
 * where importScripts() is unavailable — hence the single-file bundle. */

const PAL = globalThis.PageAskLib;
const api = PAL.browser.api;

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

async function loadState() {
  const got = await PAL.storage.get("state");
  return PAL.providers.normalizeState(got.state);
}

async function saveState(state) {
  await PAL.storage.set({ state });
}

async function currentSnapshot() {
  const state = await loadState();
  return { type: "snapshot", info: PAL.providers.describeActive(state) };
}

function pushSnapshotToPort(port) {
  currentSnapshot().then((msg) => {
    try {
      port.postMessage(msg);
    } catch {
      /* port gone */
    }
  });
}

/* ------------------------------------------------------------------ */
/* content script injection                                            */
/* ------------------------------------------------------------------ */

const INJECT_FILES = [
  "lib/md.js",
  "lib/extract.js",
  "content/panel-ui.js",
  "content/content.js",
];

function executeInTab(tabId, files) {
  return PAL.browser.promisify(api.scripting.executeScript, [
    { target: { tabId }, files },
  ]);
}

function tabsSend(tabId, msg) {
  return PAL.browser.promisify(api.tabs.sendMessage, [tabId, msg]);
}

async function togglePanelInTab(tabId) {
  try {
    await tabsSend(tabId, { type: "pageask:toggle" });
    return;
  } catch {
    /* content not injected yet — fall through to injection */
  }
  try {
    await executeInTab(tabId, INJECT_FILES);
    await tabsSend(tabId, { type: "pageask:toggle" });
  } catch {
    /* restricted page (e.g. apple.com / new-tab): ignore */
  }
}

const actionApi = api.action || api.browserAction;
if (actionApi && actionApi.onClicked) {
  actionApi.onClicked.addListener((tab) => {
    if (tab && Number.isInteger(tab.id)) togglePanelInTab(tab.id);
  });
}

/* ------------------------------------------------------------------ */
/* streaming chat over long-lived ports                               */
/* ------------------------------------------------------------------ */

const PORT_JOBS = new Map(); // port -> { aborter, firstTokenTimer, overallTimer }
const OPEN_PORTS = new Set(); // ports with a live panel (for snapshot broadcast)

function clearJob(port) {
  const job = PORT_JOBS.get(port);
  if (job) {
    clearTimeout(job.firstTokenTimer);
    clearTimeout(job.overallTimer);
    PORT_JOBS.delete(port);
  }
}

function post(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    /* ignore disconnected port */
  }
}

function friendlyError(err, providerName) {
  const code = err && err.code;
  const status = err && err.status;
  const detail = (err && (err.detail || err.message)) || "";
  const base = `（${providerName || "模型服务"}）`;
  if (code === "ABORTED") return null; // user stop: no error toast
  if (code === "HTTP") {
    if (status === 401) {
      return {
        code: "AUTH",
        message: `${base}API Key 无效或已被撤销（HTTP 401）。请到对应平台检查 Key。若使用智谱 GLM，请确认该 Key 属于所选站点——国际站 Z.ai 与国内站 open.bigmodel.cn 的 Key 不通用。`,
      };
    }
    if (status === 402 || status === 403) {
      return {
        code: "BILLING",
        message: `${base}账户余额不足或无权访问（HTTP ${status}）。请到对应平台充值或检查套餐。`,
      };
    }
    if (status === 429) {
      return {
        code: "RATE",
        message: `${base}请求过于频繁或触发限流（HTTP 429）。请稍后重试，或检查用量与并发上限。`,
      };
    }
    if (status >= 500) {
      return {
        code: "SERVER",
        message: `${base}服务端暂时不可用（HTTP ${status}），请稍后重试。`,
      };
    }
    return {
      code: "HTTP",
      message: `${base}请求被拒绝（HTTP ${status}）。${detail || "请检查模型名与请求参数是否与官方文档一致。"}`,
    };
  }
  if (code === "NETWORK") {
    return {
      code: "NETWORK",
      message: `${base}无法连接 API 服务器。请检查网络；中国大陆网络可能无法直接访问部分国际站，可改用国内站点或本地网关。`,
    };
  }
  if (code === "API") {
    return { code: "API", message: `${base}${detail || "模型服务返回错误。"}` };
  }
  return {
    code: "UNKNOWN",
    message: `${base}请求失败：${detail || "未知错误"}`,
  };
}

function beginFirstTokenTimer(port, seconds) {
  const job = PORT_JOBS.get(port);
  if (!job) return;
  job.firstTokenTimer = setTimeout(() => {
    if (job.aborter) job.aborter.abort();
    post(port, {
      type: "error",
      id: job.requestId,
      code: "TIMEOUT",
      message: `等待模型响应超过 ${seconds} 秒，已中止。请稍后重试或更换模型。`,
    });
    clearJob(port);
  }, seconds * 1000);
}

async function handleAsk(port, msg) {
  clearJob(port);
  const job = { requestId: msg.id, aborter: new AbortController(), firstTokenTimer: null, overallTimer: null };
  PORT_JOBS.set(port, job);

  let state;
  try {
    state = await loadState();
  } catch (err) {
    post(port, { type: "error", id: msg.id, code: "STORAGE", message: "读取设置失败：" + err.message });
    clearJob(port);
    return;
  }
  const cfg = PAL.providers.resolveConfig(state);
  if (!cfg.configured) {
    post(port, {
      type: "error",
      id: msg.id,
      code: "NO_CONFIG",
      message:
        cfg.isCustom
          ? "尚未完成自定义端点设置：请在设置页填写 Base URL、模型名与 API Key。"
          : "尚未配置 API Key：请打开扩展设置页，选择一个模型并填入你的 API Key。",
    });
    clearJob(port);
    return;
  }

  const messages = PAL.prompts.buildMessages({
    task: msg.task,
    userText: msg.userText || "",
    pageText: msg.pageText || "",
    pageTitle: msg.pageTitle || "",
    pageUrl: msg.pageUrl || "",
    truncated: Boolean(msg.truncated),
    charCount: msg.charCount || (msg.pageText || "").length,
    lang: msg.lang || (state.prefs && state.prefs.lang) || "简体中文",
    customPrompt: (state.prefs && state.prefs.customPrompt) || "",
    usedSelection: Boolean(msg.usedSelection),
  });

  beginFirstTokenTimer(port, 60);
  job.overallTimer = setTimeout(() => {
    if (job.aborter) job.aborter.abort();
    post(port, { type: "error", id: msg.id, code: "TIMEOUT", message: "请求超时（整体上限 180 秒），已中止。" });
    clearJob(port);
  }, 180 * 1000);

  post(port, { type: "stream-start", id: msg.id, model: cfg.model, provider: cfg.provider.name });

  try {
    await PAL.sse.chatStream({
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
      maxTokens: 4096,
      signal: job.aborter.signal,
      onEvent: (ev) => {
        if (ev.type === "delta") {
          if (job.firstTokenTimer) {
            clearTimeout(job.firstTokenTimer);
            job.firstTokenTimer = null;
          }
          post(port, { type: "delta", id: msg.id, text: ev.text });
        } else if (ev.type === "reasoning") {
          post(port, { type: "reasoning", id: msg.id, text: ev.text });
        } else if (ev.type === "done") {
          clearJob(port);
          post(port, { type: "done", id: msg.id });
        }
      },
    });
  } catch (err) {
    clearJob(port);
    const friendly = friendlyError(err, cfg.provider.name);
    if (friendly) post(port, { type: "error", id: msg.id, ...friendly });
  }
}

if (api.runtime && api.runtime.onConnect) {
  api.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== "pageask") return;
    OPEN_PORTS.add(port);
    pushSnapshotToPort(port);
    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "hello") {
        pushSnapshotToPort(port);
      } else if (msg.type === "ask") {
        handleAsk(port, msg);
      } else if (msg.type === "stop") {
        const job = PORT_JOBS.get(port);
        if (job && job.aborter) job.aborter.abort();
        clearJob(port);
      }
    });
    port.onDisconnect.addListener(() => {
      OPEN_PORTS.delete(port);
      clearJob(port);
    });
  });
}

/* ------------------------------------------------------------------ */
/* one-shot messages (content <-> background)                          */
/* ------------------------------------------------------------------ */

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "get-snapshot") {
    currentSnapshot().then(sendResponse);
    return true; // async
  }
  if (msg.type === "open-options") {
    PAL.openOptions().then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
    );
    return true;
  }
  if (msg.type === "test-connection") {
    (async () => {
      const state = await loadState();
      const cfg = PAL.providers.resolveConfig(state);
      if (!cfg.configured || !cfg.endpoint) {
        return sendResponse({ ok: false, step: "config", message: "请先完整填写并保存设置（Base URL / 模型 / API Key）。" });
      }
      const ctrl = new AbortController();
      const guard = setTimeout(() => ctrl.abort(), 20000);
      try {
        const res = await PAL.sse.testConnection({
          endpoint: cfg.endpoint,
          apiKey: cfg.apiKey,
          model: cfg.model,
          signal: ctrl.signal,
        });
        clearTimeout(guard);
        if (res.ok) {
          sendResponse({
            ok: true,
            status: res.status,
            model: cfg.model,
            endpoint: cfg.endpoint,
            note: res.body && res.body.model ? res.body.model : undefined,
          });
        } else {
          let reason = "";
          try {
            reason =
              (res.body && res.body.error && (res.body.error.message || res.body.error.code)) || "";
          } catch {
            /* ignore */
          }
          sendResponse({ ok: false, step: "http", status: res.status, message: reason || res.raw });
        }
      } catch (err) {
        clearTimeout(guard);
        if (err && err.name === "AbortError") {
          sendResponse({ ok: false, step: "timeout", message: "连接超时（20 秒）。请检查 Base URL 与网络。" });
        } else {
          const friendly = friendlyError(err, cfg.provider.name);
          sendResponse({
            ok: false,
            step: "network",
            message: (friendly && friendly.message) || String(err && err.message || err),
          });
        }
      }
    })();
    return true; // async
  }
  return undefined;
});

/* Broadcast a fresh snapshot to every open panel when settings change. */
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.state) return;
  for (const port of OPEN_PORTS.keys()) pushSnapshotToPort(port);
});
