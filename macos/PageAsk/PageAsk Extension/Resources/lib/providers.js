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
