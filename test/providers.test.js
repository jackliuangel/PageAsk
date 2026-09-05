const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

function loadLib(rel) {
  const code = fs.readFileSync(path.join(__dirname, "..", "web-extension", "lib", rel), "utf8");
  const s = {};
  vm.createContext(s);
  vm.runInContext(code, s);
  return s.PageAskLib;
}

const PAL = loadLib("providers.js");
const P = PAL.providers;

// Values produced inside the vm context live in a different realm (different
// Object/Array prototypes), so normalize them before strict deep-compares.
const host = (v) => JSON.parse(JSON.stringify(v));

describe("PAL.providers registry", () => {
  it("exports the documented API surface", () => {
    for (const fn of [
      "PROVIDERS", "findProvider", "keyIdFor", "defaultState",
      "normalizeState", "resolveConfig", "endpointFor", "describeActive",
    ]) {
      assert.ok(fn in P, `missing export ${fn}`);
    }
  });

  it("PROVIDERS lists deepseek, zai, kimi, custom in order", () => {
    assert.deepStrictEqual(host(P.PROVIDERS.map((p) => p.id)), ["deepseek", "zai", "kimi", "custom"]);
  });

  it("zai has cn + intl sites, single-site providers have one site each", () => {
    const zai = P.findProvider("zai");
    assert.ok(zai);
    assert.deepStrictEqual(host(zai.sites.map((s) => s.id)), ["cn", "intl"]);
    assert.strictEqual(P.findProvider("deepseek").sites.length, 1);
    assert.strictEqual(P.findProvider("kimi").sites.length, 1);
    assert.strictEqual(P.findProvider("custom").sites.length, 1);
  });

  it("findProvider returns null for unknown ids", () => {
    assert.strictEqual(P.findProvider("nope"), null);
  });
});

describe("keyIdFor", () => {
  it("returns the bare provider id for single-site providers (deepseek, kimi, custom)", () => {
    assert.strictEqual(P.keyIdFor("deepseek"), "deepseek");
    assert.strictEqual(P.keyIdFor("deepseek", "default"), "deepseek");
    assert.strictEqual(P.keyIdFor("kimi", "default"), "kimi");
    assert.strictEqual(P.keyIdFor("custom", "default"), "custom");
  });

  it("returns provider:site for multi-site zai", () => {
    assert.strictEqual(P.keyIdFor("zai", "cn"), "zai:cn");
    assert.strictEqual(P.keyIdFor("zai", "intl"), "zai:intl");
    // missing site falls back to the first site
    assert.strictEqual(P.keyIdFor("zai"), "zai:cn");
  });

  it("passes through unknown provider ids", () => {
    assert.strictEqual(P.keyIdFor("mystery-provider"), "mystery-provider");
  });
});

describe("defaultState", () => {
  it("returns a fresh, fully-populated state", () => {
    const a = P.defaultState();
    const b = P.defaultState();
    assert.notStrictEqual(a, b);
    assert.deepStrictEqual(host(a), {
      activeProvider: "deepseek",
      activeSite: "default",
      keys: {},
      models: {},
      custom: { baseUrl: "", model: "" },
      prefs: { lang: "简体中文", maxChars: 16000, customPrompt: "" },
    });
  });
});

describe("normalizeState", () => {
  it("returns the full default state for null / non-object input", () => {
    assert.deepStrictEqual(P.normalizeState(null), P.defaultState());
    assert.deepStrictEqual(P.normalizeState(undefined), P.defaultState());
    assert.deepStrictEqual(P.normalizeState("nope"), P.defaultState());
    assert.deepStrictEqual(P.normalizeState(42), P.defaultState());
  });

  it("defaults an unknown activeProvider to deepseek but keeps known ones", () => {
    assert.strictEqual(P.normalizeState({ activeProvider: "alien" }).activeProvider, "deepseek");
    assert.strictEqual(P.normalizeState({ activeProvider: "zai" }).activeProvider, "zai");
  });

  it("defaults missing fields", () => {
    const s = P.normalizeState({});
    assert.deepStrictEqual(s, P.defaultState());
    const partial = P.normalizeState({ activeProvider: "kimi", activeSite: "default", prefs: { lang: "English" } });
    assert.strictEqual(partial.prefs.maxChars, 16000);
    assert.strictEqual(partial.custom.baseUrl, "");
    assert.deepStrictEqual(host(partial.keys), {});
  });

  it("keeps non-string activeSite only as the default", () => {
    assert.strictEqual(P.normalizeState({ activeSite: 5 }).activeSite, "default");
    assert.strictEqual(P.normalizeState({ activeSite: "intl" }).activeSite, "intl");
  });

  it("clamps prefs.maxChars into [2000, 200000] and rounds", () => {
    assert.strictEqual(P.normalizeState({ prefs: { maxChars: 1000 } }).prefs.maxChars, 2000);
    assert.strictEqual(P.normalizeState({ prefs: { maxChars: 500000 } }).prefs.maxChars, 200000);
    assert.strictEqual(P.normalizeState({ prefs: { maxChars: 12345.6 } }).prefs.maxChars, 12346);
    assert.strictEqual(P.normalizeState({ prefs: { maxChars: 25000 } }).prefs.maxChars, 25000);
  });

  it("falls back to the default when maxChars is not finite", () => {
    assert.strictEqual(P.normalizeState({ prefs: { maxChars: "3000" } }).prefs.maxChars, 16000);
    assert.strictEqual(P.normalizeState({ prefs: { maxChars: NaN } }).prefs.maxChars, 16000);
  });

  it("keeps a string custom prompt and defaults invalid values", () => {
    assert.strictEqual(P.normalizeState({ prefs: { customPrompt: " concise answers " } }).prefs.customPrompt, " concise answers ");
    assert.strictEqual(P.normalizeState({ prefs: { customPrompt: 42 } }).prefs.customPrompt, "");
  });

  it("copies keys/models and only keeps string custom fields", () => {
    const s = P.normalizeState({
      activeProvider: "zai",
      activeSite: "cn",
      keys: { "zai:cn": "sk-1" },
      models: { "zai:cn": "glm-4-flash" },
      custom: { baseUrl: "http://x", model: "m", junk: "ignored" },
    });
    assert.deepStrictEqual(host(s.keys), { "zai:cn": "sk-1" });
    assert.deepStrictEqual(host(s.models), { "zai:cn": "glm-4-flash" });
    assert.deepStrictEqual(host(s.custom), { baseUrl: "http://x", model: "m" });

    const nonStr = P.normalizeState({ custom: { baseUrl: 123, model: null } });
    assert.deepStrictEqual(host(nonStr.custom), { baseUrl: "", model: "" });
  });
});

describe("resolveConfig", () => {
  it("zai/cn: resolves baseUrl + site defaultModel when models empty", () => {
    const cfg = P.resolveConfig(P.normalizeState({ activeProvider: "zai", activeSite: "cn" }));
    assert.strictEqual(cfg.provider.id, "zai");
    assert.strictEqual(cfg.site.id, "cn");
    assert.strictEqual(cfg.keyId, "zai:cn");
    assert.strictEqual(cfg.baseUrl, "https://open.bigmodel.cn/api/paas/v4");
    assert.strictEqual(cfg.model, "glm-4.6"); // site defaultModel, no key/model configured
    assert.strictEqual(cfg.apiKey, "");
    assert.strictEqual(cfg.configured, false);
    assert.strictEqual(cfg.endpoint, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  });

  it("zai/intl uses the intl site default model", () => {
    const cfg = P.resolveConfig(P.normalizeState({ activeProvider: "zai", activeSite: "intl" }));
    assert.strictEqual(cfg.baseUrl, "https://api.z.ai/api/paas/v4");
    assert.strictEqual(cfg.model, "glm-5.3");
  });

  it("uses state.models override per keyId and requires a key to be configured", () => {
    const st = P.normalizeState({ activeProvider: "zai", activeSite: "cn" });
    st.models["zai:cn"] = "glm-4-flash";
    st.keys["zai:cn"] = "  sk-abc  ";
    const cfg = P.resolveConfig(st);
    assert.strictEqual(cfg.model, "glm-4-flash");
    assert.strictEqual(cfg.apiKey, "sk-abc");
    assert.strictEqual(cfg.configured, true);
  });

  it("custom is unconfigured without baseUrl/model/key and empty endpoint", () => {
    const cfg = P.resolveConfig(P.normalizeState({ activeProvider: "custom" }));
    assert.strictEqual(cfg.isCustom, true);
    assert.strictEqual(cfg.baseUrl, "");
    assert.strictEqual(cfg.model, "");
    assert.strictEqual(cfg.configured, false);
    assert.strictEqual(cfg.endpoint, "");
  });

  it("custom is configured from state.custom + key stored at keys.custom", () => {
    const st = P.normalizeState({ activeProvider: "custom", activeSite: "default" });
    st.custom.baseUrl = "  http://localhost:8000/v1  ";
    st.custom.model = "  my-model  ";
    st.keys.custom = " sk-custom ";
    const cfg = P.resolveConfig(st);
    assert.strictEqual(cfg.keyId, "custom");
    assert.strictEqual(cfg.baseUrl, "http://localhost:8000/v1");
    assert.strictEqual(cfg.model, "my-model");
    assert.strictEqual(cfg.apiKey, "sk-custom");
    assert.strictEqual(cfg.configured, true);
    assert.strictEqual(cfg.endpoint, "http://localhost:8000/v1/chat/completions");
  });

  it("falls back to the deepseek provider when activeProvider is unknown", () => {
    const cfg = P.resolveConfig(P.normalizeState({ activeProvider: "bogus" }));
    assert.strictEqual(cfg.provider.id, "deepseek");
    assert.strictEqual(cfg.baseUrl, "https://api.deepseek.com");
  });
});

describe("endpointFor", () => {
  it("appends /chat/completions to a bare base URL", () => {
    assert.strictEqual(P.endpointFor("https://api.deepseek.com"), "https://api.deepseek.com/chat/completions");
  });

  it("does not duplicate a trailing slash", () => {
    assert.strictEqual(P.endpointFor("https://api.deepseek.com/"), "https://api.deepseek.com/chat/completions");
  });

  it("keeps an existing /chat/completions suffix untouched", () => {
    assert.strictEqual(
      P.endpointFor("https://x.example/v1/chat/completions"),
      "https://x.example/v1/chat/completions"
    );
    assert.strictEqual(
      P.endpointFor("https://x.example/v1/chat/completions/"),
      "https://x.example/v1/chat/completions"
    );
  });

  it("handles empty / whitespace input", () => {
    assert.strictEqual(P.endpointFor(""), "");
    assert.strictEqual(P.endpointFor("   "), "");
    assert.strictEqual(P.endpointFor(undefined), "");
    assert.strictEqual(P.endpointFor(null), "");
  });

  it("is case-insensitive about the existing suffix", () => {
    assert.strictEqual(P.endpointFor("https://x.example/CHAT/Completions"), "https://x.example/CHAT/Completions");
  });
});

describe("describeActive", () => {
  it("reports unconfigured custom provider needs", () => {
    const st = P.normalizeState({ activeProvider: "custom" });
    const d = P.describeActive(st);
    assert.strictEqual(d.configured, false);
    assert.strictEqual(d.providerId, "custom");
    assert.strictEqual(d.providerName, "自定义");
    assert.strictEqual(d.hasKey, false);
    assert.strictEqual(d.needsCustomUrl, true);
    assert.strictEqual(d.needsCustomModel, true);
    assert.strictEqual(d.lang, "简体中文");
    assert.strictEqual(d.maxChars, 16000);
  });

  it("reports a configured deepseek account without leaking the key", () => {
    const st = P.normalizeState({ activeProvider: "deepseek" });
    st.keys.deepseek = "sk-secret";
    st.models.deepseek = "deepseek-v4-pro";
    const d = P.describeActive(st);
    assert.strictEqual(d.configured, true);
    assert.strictEqual(d.providerId, "deepseek");
    assert.strictEqual(d.providerName, "DeepSeek");
    assert.strictEqual(d.model, "deepseek-v4-pro");
    assert.strictEqual(d.hasKey, true);
    assert.strictEqual(JSON.stringify(d).includes("sk-secret"), false);
  });
});
