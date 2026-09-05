/* GENERATED FILE — do not edit by hand.
 * Produced by scripts/bundle-background.js. It inlines lib/{browser,providers,sse,prompts}.js
 * because Safari's background content lacks importScripts().
 * Edit background.src.js and the lib files instead, then re-run the bundler.
 */

/* ==== lib/browser.js ==== */
/* PageAsk shared browser-API facade.
 * Works in Chrome, Edge and Safari Web Extensions (MV3).
 * Kept dependency-free; modules expose themselves on globalThis.PageAskLib (PAL).
 */
(function (global) {
  "use strict";

  const api = global.browser || global.chrome;
  const PAL = (global.PageAskLib = global.PageAskLib || {});

  PAL.browser = { api };

  /**
   * Call a browser API that may be callback-based (Chrome `chrome.*`) or
   * promise-based (Safari / Firefox `browser.*`). We pass a trailing callback
   * AND await a returned thenable if one is present — whichever settles first
   * wins, so the same call works on every host.
   */
  function promisify(fn, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (resp) => {
        if (settled) return;
        settled = true;
        const err = api && api.runtime && api.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(resp);
      };
      try {
        const ret = fn.apply(api, (args || []).concat([done]));
        if (ret && typeof ret.then === "function") {
          ret.then(
            (v) => { if (!settled) { settled = true; resolve(v); } },
            (e) => { if (!settled) { settled = true; reject(e); } }
          );
        }
      } catch (err) {
        if (!settled) { settled = true; reject(err); }
      }
    });
  }

  PAL.browser.promisify = promisify;

  /** Send a one-shot message (works across callback- and promise-based hosts). */
  function sendMessage(message) {
    if (!api || !api.runtime || !api.runtime.sendMessage) {
      return Promise.reject(new Error("runtime.sendMessage unavailable"));
    }
    return promisify(api.runtime.sendMessage, [message]);
  }

  /** Open the extension options/settings page (must be called from background). */
  function openOptions() {
    if (api.runtime && api.runtime.openOptionsPage) {
      return Promise.resolve(api.runtime.openOptionsPage());
    }
    return Promise.resolve();
  }

  /** chrome.storage.local promise wrapper. */
  const storage = {
    async get(keys) {
      if (api.storage && api.storage.local) {
        const area = api.storage.local;
        if (area.get.length >= 2) {
          return new Promise((resolve) => area.get(keys, resolve));
        }
        return area.get(keys);
      }
      return {};
    },
    async set(obj) {
      if (api.storage && api.storage.local) {
        if (api.storage.local.set.length >= 2) {
          return new Promise((resolve, reject) =>
            api.storage.local.set(obj, () => {
              const err = api.runtime.lastError;
              if (err) reject(new Error(err.message));
              else resolve();
            })
          );
        }
        return api.storage.local.set(obj);
      }
    },
    async remove(keys) {
      if (api.storage && api.storage.local) {
        if (api.storage.local.remove.length >= 2) {
          return new Promise((resolve) => api.storage.local.remove(keys, resolve));
        }
        return api.storage.local.remove(keys);
      }
    },
  };

  PAL.sendMessage = sendMessage;
  PAL.openOptions = openOptions;
  PAL.storage = storage;
})(typeof globalThis !== "undefined" ? globalThis : this);

/* ==== lib/providers.js ==== */
/* PageAsk provider registry + settings resolution. Pure data & functions,
 * no browser APIs — safe to unit-test under Node.
 *
 * Model names / pricing drift over time: defaults below are documented
 * suggestions only; users can always edit the model field.
 */
(function (global) {
  "use strict";

  const PAL = (global.PageAskLib = global.PageAskLib || {});

  const PROVIDERS = [
    {
      id: "deepseek",
      name: "DeepSeek",
      fullName: "DeepSeek 深度求索",
      tag: "DS",
      note: "DeepSeek 官方 API（国际/国内通用）。模型与价格以 platform.deepseek.com 控制台为准。",
      sites: [
        {
          id: "default",
          label: "DeepSeek 开放平台",
          baseUrl: "https://api.deepseek.com",
          keyUrl: "https://platform.deepseek.com/api_keys",
          models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
          defaultModel: "deepseek-v4-pro",
        },
      ],
    },
    {
      id: "zai",
      name: "GLM（智谱）",
      fullName: "Z.ai / 智谱 GLM",
      tag: "GLM",
      note: "注意：国际站与国内站的 API Key 不通用，请按你申请 Key 的平台选择站点。模型名以官方控制台为准。",
      sites: [
        {
          id: "cn",
          label: "国内站 · 智谱开放平台",
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
          models: ["glm-4.7", "glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4-flash"],
          defaultModel: "glm-4.6",
        },
        {
          id: "intl",
          label: "国际站 · Z.ai",
          baseUrl: "https://api.z.ai/api/paas/v4",
          keyUrl: "https://z.ai/model-api",
          models: ["glm-5.3", "glm-5.3-flash", "glm-4.7"],
          defaultModel: "glm-5.3",
        },
      ],
    },
    {
      id: "kimi",
      name: "Kimi",
      fullName: "Kimi · 月之暗面",
      tag: "K",
      note: "Moonshot Kimi API，长上下文（K3 支持 1M）。模型名以 platform.kimi.ai 控制台为准。",
      sites: [
        {
          id: "default",
          label: "Kimi 开放平台",
          baseUrl: "https://api.moonshot.ai/v1",
          keyUrl: "https://platform.kimi.ai/console/api-keys",
          models: ["kimi-k3", "kimi-k2.7-code-highspeed", "kimi-k2.6"],
          defaultModel: "kimi-k3",
        },
      ],
    },
    {
      id: "custom",
      name: "自定义",
      fullName: "自定义 · OpenAI 兼容",
      tag: "⚙",
      note: "任何 OpenAI 兼容 /chat/completions 端点（one-api / new-api / vLLM 等）。默认仅放行 localhost；其他域名需在 manifest 的 host_permissions 中追加。",
      sites: [
        {
          id: "default",
          label: "自定义端点",
          baseUrl: "",
          keyUrl: "",
          models: [],
          defaultModel: "",
        },
      ],
    },
  ];

  function findProvider(id) {
    return PROVIDERS.find((p) => p.id === id) || null;
  }

  /** Storage key under which an API key / model is saved for a provider+site. */
  function keyIdFor(providerId, siteId) {
    const p = findProvider(providerId);
    if (!p) return providerId;
    if (p.sites.length === 1) return providerId;
    return `${providerId}:${siteId || p.sites[0].id}`;
  }

  function defaultState() {
    return {
      activeProvider: "deepseek",
      activeSite: "default",
      keys: {},       // keyIdFor(...) -> api key
      models: {},     // keyIdFor(...) -> chosen model
      custom: { baseUrl: "", model: "" },
      prefs: { lang: "简体中文", maxChars: 16000, customPrompt: "" },
    };
  }

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    const s = {
      activeProvider:
        findProvider(raw.activeProvider) ? raw.activeProvider : base.activeProvider,
      activeSite: typeof raw.activeSite === "string" ? raw.activeSite : base.activeSite,
      keys: raw.keys && typeof raw.keys === "object" ? { ...raw.keys } : {},
      models: raw.models && typeof raw.models === "object" ? { ...raw.models } : {},
      custom: {
        baseUrl:
          raw.custom && typeof raw.custom.baseUrl === "string" ? raw.custom.baseUrl : "",
        model:
          raw.custom && typeof raw.custom.model === "string" ? raw.custom.model : "",
      },
      prefs: {
        lang:
          raw.prefs && typeof raw.prefs.lang === "string"
            ? raw.prefs.lang
            : base.prefs.lang,
        maxChars:
          raw.prefs && Number.isFinite(raw.prefs.maxChars)
            ? Math.max(2000, Math.min(200000, Math.round(raw.prefs.maxChars)))
            : base.prefs.maxChars,
        customPrompt:
          raw.prefs && typeof raw.prefs.customPrompt === "string"
            ? raw.prefs.customPrompt
            : base.prefs.customPrompt,
      },
    };
    return s;
  }

  /**
   * Resolve the effective runtime configuration from a (normalized) state.
   * Returns { provider, site, keyId, baseUrl, model, apiKey, endpoint }.
   * apiKey === "" when none configured.
   */
  function resolveConfig(state) {
    const provider = findProvider(state.activeProvider) || findProvider("deepseek");
    const site =
      provider.sites.find((s) => s.id === state.activeSite) || provider.sites[0];
    const keyId = keyIdFor(provider.id, site.id);
    const isCustom = provider.id === "custom";
    const baseUrl = isCustom ? state.custom.baseUrl.trim() : site.baseUrl;
    const model = isCustom
      ? state.custom.model.trim()
      : (state.models[keyId] || site.defaultModel || site.models[0] || "");
    const apiKey = (state.keys[keyId] || "").trim();
    return {
      provider,
      site,
      keyId,
      baseUrl,
      model,
      apiKey,
      endpoint: endpointFor(baseUrl),
      isCustom,
      configured: Boolean(isCustom ? baseUrl && model && apiKey : apiKey && model),
    };
  }

  /** Turn a base URL (with or without /v1, /api/paas/v4 …) into a chat endpoint. */
  function endpointFor(baseUrl) {
    let b = (baseUrl || "").trim().replace(/\/+$/, "");
    if (!b) return "";
    if (/\/chat\/completions$/i.test(b)) return b;
    return `${b}/chat/completions`;
  }

  /** Public (key-free) description of the active config, safe to send to content. */
  function describeActive(state) {
    const cfg = resolveConfig(state);
    return {
      configured: cfg.configured,
      providerId: cfg.provider.id,
      providerName: cfg.provider.name,
      fullName: cfg.provider.fullName,
      siteLabel: cfg.site.label,
      model: cfg.model,
      hasKey: Boolean(cfg.apiKey),
      lang: state.prefs.lang,
      maxChars: state.prefs.maxChars,
      needsCustomUrl: cfg.isCustom && !cfg.baseUrl,
      needsCustomModel: cfg.isCustom && !cfg.model,
    };
  }

  PAL.providers = {
    PROVIDERS,
    findProvider,
    keyIdFor,
    defaultState,
    normalizeState,
    resolveConfig,
    endpointFor,
    describeActive,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

/* ==== lib/sse.js ==== */
/* PageAsk streaming chat client for OpenAI-compatible /chat/completions.
 * Pure-ish module: no browser globals used at runtime except fetch/AbortController,
 * so it can be unit-tested under Node with injected fetch.
 */
(function (global) {
  "use strict";

  const PAL = (global.PageAskLib = global.PageAskLib || {});

  /** Incremental SSE parser: feed raw chunks, get back arrays of `data:` payloads. */
  function createSSEParser() {
    let buffer = "";
    return {
      push(chunk) {
        buffer += chunk;
        buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const events = [];
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = block.split("\n").filter((l) => l.startsWith("data:"));
          if (dataLines.length) {
            events.push(dataLines.map((l) => l.slice(5).replace(/^ /, "")).join("\n"));
          }
        }
        return events;
      },
    };
  }

  /**
   * Extract streamed delta fields from one parsed `data:` JSON payload.
   * Returns { content, reasoning, done, finishReason, error } (strings/booleans).
   * Tolerates: string content, array-of-parts content, reasoning_content,
   * choices empty (usage-only), and [DONE].
   */
  function parseStreamEvent(dataText) {
    const out = { content: "", reasoning: "", done: false, finishReason: "", error: null };
    if (dataText === "[DONE]") {
      out.done = true;
      return out;
    }
    let obj;
    try {
      obj = JSON.parse(dataText);
    } catch {
      return out; // ignore non-JSON noise
    }
    if (obj.error) {
      out.error = obj.error;
      return out;
    }
    const choice = obj.choices && obj.choices[0];
    if (!choice) {
      if (obj.choices && obj.choices.length === 0) out.done = true;
      return out;
    }
    const delta = choice.delta || choice.message || {};
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      out.reasoning = delta.reasoning_content;
    }
    if (typeof delta.content === "string") {
      out.content = delta.content;
    } else if (Array.isArray(delta.content)) {
      out.content = delta.content
        .filter((p) => p && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
    }
    if (choice.finish_reason) out.finishReason = choice.finish_reason;
    return out;
  }

  /** Parse a non-streaming JSON response body. */
  function parseNonStreamBody(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return { content: "", error: { message: "无法解析 API 响应" } };
    }
    if (obj.error) return { content: "", error: obj.error };
    const choice = obj.choices && obj.choices[0];
    const msg = (choice && (choice.message || choice.delta)) || {};
    let content = "";
    if (typeof msg.content === "string") content = msg.content;
    else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((p) => p && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
    }
    return { content, error: null };
  }

  /**
   * Run a chat completion request, streaming deltas to onEvent.
   *
   * opts: {
   *   endpoint, apiKey, model, messages,
   *   maxTokens?,   // optional
   *   signal?,      // external AbortSignal (user stop)
   *   fetchImpl?,   // injectable fetch for tests
   *   onEvent({type:'delta'|'reasoning'|'done'|'error', ...})
   * }
   * Returns a promise resolving with { ok } or rejecting with ApiError.
   */
  async function chatStream(opts) {
    const {
      endpoint,
      apiKey,
      model,
      messages,
      maxTokens,
      signal,
      fetchImpl,
      onEvent,
    } = opts;
    const fetchFn = fetchImpl || global.fetch;
    if (!fetchFn) {
      const e = new Error("当前环境不支持 fetch");
      e.code = "NETWORK";
      throw e;
    }

    const body = {
      model,
      messages,
      stream: true,
    };
    if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;

    let resp;
    try {
      resp = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      const e = new Error(err && err.message ? err.message : "网络请求失败");
      e.code = err && err.name === "AbortError" ? "ABORTED" : "NETWORK";
      if (e.code === "NETWORK" && err && err.cause) e.cause = err.cause;
      throw e;
    }

    const ctype = (resp.headers.get("content-type") || "").toLowerCase();
    if (!resp.ok) {
      let detail = "";
      try {
        const text = await resp.text();
        try {
          const j = JSON.parse(text);
          detail = (j.error && (j.error.message || j.error.code)) || text;
        } catch {
          detail = text.slice(0, 500);
        }
      } catch {
        /* ignore */
      }
      const e = new Error(detail || `HTTP ${resp.status}`);
      e.code = "HTTP";
      e.status = resp.status;
      e.detail = detail;
      throw e;
    }

    const isStream =
      ctype.includes("text/event-stream") ||
      ctype.includes("application/x-ndjson");

    if (!isStream) {
      // Some gateways ignore `stream: true`; fall back to a plain JSON reply.
      const text = await resp.text();
      const { content, error } = parseNonStreamBody(text);
      if (error) {
        const e = new Error(error.message || "API 返回错误");
        e.code = "API";
        throw e;
      }
      if (content) onEvent({ type: "delta", content });
      onEvent({ type: "done" });
      return { ok: true };
    }

    if (!resp.body || !resp.body.getReader) {
      const e = new Error("浏览器不支持流式读取响应");
      e.code = "NETWORK";
      throw e;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const parser = createSSEParser();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const events = parser.push(decoder.decode(value, { stream: true }));
        for (const ev of events) {
          const parsed = parseStreamEvent(ev);
          if (parsed.error) {
            const e = new Error(parsed.error.message || "API 返回错误");
            e.code = "API";
            throw e;
          }
          if (parsed.reasoning) onEvent({ type: "reasoning", text: parsed.reasoning });
          if (parsed.content) onEvent({ type: "delta", text: parsed.content });
          if (parsed.done || parsed.finishReason) {
            finished = true;
          }
        }
        if (finished) break;
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    onEvent({ type: "done" });
    return { ok: true };
  }

  /** Build a short "ping" request to validate key/endpoint/model. */
  async function testConnection(opts) {
    const { endpoint, apiKey, model, signal, fetchImpl } = opts;
    const fetchFn = fetchImpl || global.fetch;
    const resp = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal,
    });
    const text = await resp.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: resp.status, ok: resp.ok, body: parsed, raw: text.slice(0, 400) };
  }

  PAL.sse = {
    createSSEParser,
    parseStreamEvent,
    parseNonStreamBody,
    chatStream,
    testConnection,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

/* ==== lib/prompts.js ==== */
/* PageAsk prompt builders. Pure functions — unit-test friendly.
 *
 * payload shapes handled by buildMessages:
 *   { task: 'translate'|'selection-translate'|'summarize'|'ask',
 *     userText,            // free-form question (ask) or "" 
 *     pageText,            // extracted page text (may be "")
 *     pageTitle, pageUrl,  // context of the page
 *     truncated,           // bool: pageText was cut
 *     charCount,           // original text length before truncation
 *     lang }               // target/answer language label e.g. "简体中文"
 */
(function (global) {
  "use strict";

  const PAL = (global.PageAskLib = global.PageAskLib || {});

  const LANGS = ["简体中文", "繁體中文", "English", "日本語", "한국어"];

  function defaultLang() {
    return LANGS[0];
  }

  function pageHeader(title, url) {
    if (title && url) return `《${title}》 ${url}`;
    if (title) return `《${title}》`;
    if (url) return url;
    return "当前网页";
  }

  function truncateNotice(truncated, charCount) {
    if (!truncated) return "";
    return `\n（注：正文过长，仅截取前 ${charCount} 字左右。）`;
  }

  function buildTranslateSystem(lang) {
    return `你是一名专业翻译。把给定内容翻译成${lang}。
要求：
1. 逐段对应翻译，不遗漏、不合并、不自行增删内容。
2. 保留原文的标题层级与列表结构，用 Markdown 标题（最多三级）表示。
3. 专有名词、人名、机构名保留原文；首次出现时可附中文译名。
4. 只输出译文本身，不要输出任何解释、前言或后记。`;
  }

  function buildSummarizeSystem(lang) {
    return `你是一名网页阅读助理。用${lang}总结给定网页内容。
要求：
1. 先给一句话摘要（TL;DR）。
2. 再用“### 要点”分条列出核心信息与结论。
3. 如原文含关键数字、人物、时间、地点，尽量保留。
4. 只输出总结，不要输出与内容无关的评论。`;
  }

  function buildAskSystem(lang) {
    return `你是一名网页阅读助理，会基于用户给出的网页正文回答问题。
要求：
1. 优先依据正文回答；引用原文时用「」括起原文并随后用${lang}解释。
2. 如果正文中没有相关信息，明确说明“正文中没有提到”，再以常识简要补充并标注为推测。
3. 回答使用${lang}。回答需简洁、有条理。`;
  }

  function withCustomPrompt(systemPrompt, customPrompt) {
    const extra = typeof customPrompt === "string" ? customPrompt.trim() : "";
    return extra ? `${systemPrompt}\n\n用户自定义指令：\n${extra}` : systemPrompt;
  }

  function buildMessages(payload) {
    const lang = LANGS.includes(payload.lang) ? payload.lang : defaultLang();
    const title = payload.pageTitle || "";
    const url = payload.pageUrl || "";
    const header = pageHeader(title, url);
    const notice = truncateNotice(payload.truncated, payload.charCount);
    const hasPage = Boolean(payload.pageText && payload.pageText.trim());

    const task = payload.task || "ask";
    const userText = (payload.userText || "").trim();

    const messages = [];

    if (task === "translate") {
      messages.push({ role: "system", content: withCustomPrompt(buildTranslateSystem(lang), payload.customPrompt) });
      const body = payload.pageText || "";
      const user =
        `请把网页 ${header} 的正文完整翻译成${lang}。` +
        notice +
        `\n\n【正文开始】\n${body}\n【正文结束】`;
      messages.push({ role: "user", content: user });
    } else if (task === "selection-translate") {
      messages.push({ role: "system", content: withCustomPrompt(buildTranslateSystem(lang), payload.customPrompt) });
      const body = payload.pageText || payload.userText || "";
      messages.push({
        role: "user",
        content: `请把以下选中内容翻译成${lang}：\n\n"""\n${body}\n"""`,
      });
    } else if (task === "summarize") {
      messages.push({ role: "system", content: withCustomPrompt(buildSummarizeSystem(lang), payload.customPrompt) });
      const user =
        `请总结网页 ${header} 的正文。` +
        notice +
        `\n\n【正文开始】\n${payload.pageText || ""}\n【正文结束】`;
      messages.push({ role: "user", content: user });
    } else {
      // ask — grounded Q&A
      messages.push({ role: "system", content: withCustomPrompt(buildAskSystem(lang), payload.customPrompt) });
      const parts = [];
      if (payload.usedSelection) {
        parts.push(
          `用户选中了当前网页（${header}）的以下内容：\n\n"""\n${payload.pageText || payload.userText}\n"""`
        );
      } else if (hasPage) {
        parts.push(
          `网页 ${header} 的正文如下` + notice + `：\n\n【正文开始】\n${payload.pageText}\n【正文结束】`
        );
      }
      parts.push(userText || "请介绍一下这个网页的主要内容。");
      messages.push({ role: "user", content: parts.join("\n\n") });
    }

    return messages;
  }

  PAL.prompts = { LANGS, defaultLang, buildMessages };
})(typeof globalThis !== "undefined" ? globalThis : this);

/* ==== background.src.js ==== */
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
