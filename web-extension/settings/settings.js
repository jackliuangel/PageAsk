/* PageAsk 设置页逻辑
 * 依赖已加载：lib/browser.js (PAL.browser/PAL.storage/PAL.sendMessage)
 *            lib/providers.js (PAL.providers)
 * 存储结构：storage.local 下 { state } —— 与 background 完全一致。
 */
(function () {
  "use strict";

  const PAL = globalThis.PageAskLib;
  const P = PAL.providers;

  /* ---------- tiny dom helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    form: $("pa-form"),
    provNote: $("pa-prov-note"),
    providers: $("pa-s-providers"),
    siteSec: $("pa-s-site-sec"),
    siteWarn: $("pa-site-warn"),
    sites: $("pa-s-sites"),
    secApiNo: $("pa-sec-api-no"),
    secPrefNo: $("pa-sec-pref-no"),
    baseurlRow: $("pa-baseurl-row"),
    baseurl: $("pa-baseurl"),
    endpointHint: $("pa-endpoint-hint"),
    hostNote: $("pa-host-note"),
    key: $("pa-key"),
    keyeye: $("pa-keyeye"),
    keylink: $("pa-keylink"),
    model: $("pa-model"),
    modelTag: $("pa-model-tag"),
    modelHint: $("pa-model-hint"),
    modelsug: $("pa-modelsug"),
    lang: $("pa-lang"),
    maxchars: $("pa-maxchars"),
    customPrompt: $("pa-custom-prompt"),
    save: $("pa-save"),
    test: $("pa-test"),
    clear: $("pa-clear"),
    status: $("pa-status"),
  };

  /* ---------- state ---------- */
  let state = P.normalizeState(null); // replaced after storage read

  function currentProvider() {
    return P.findProvider(state.activeProvider) || P.PROVIDERS[0];
  }
  function currentSite() {
    const p = currentProvider();
    return p.sites.find((s) => s.id === state.activeSite) || p.sites[0];
  }
  function currentKeyId() {
    return P.keyIdFor(currentProvider().id, currentSite().id);
  }

  /* ---------- status ---------- */
  function setStatus(cls, title, body) {
    els.status.hidden = false;
    els.status.className = "pa-s-status" + (cls ? " " + cls : "");
    els.status.innerHTML =
      (title ? `<span class="pa-ss-t">${title}</span>` : "") +
      (body ? `<div>${body}</div>` : "");
  }
  function hideStatus() {
    els.status.hidden = true;
  }

  /* ---------- read / write form into `state` ---------- */
  function commitForm() {
    const p = currentProvider();
    const site = currentSite();
    const keyId = currentKeyId();
    if (p.id === "custom") {
      state.custom.baseUrl = els.baseurl.value.trim();
      state.custom.model = els.model.value.trim();
      state.keys[keyId] = els.key.value;
    } else {
      const mv = els.model.value.trim();
      if (mv && mv !== site.defaultModel) state.models[keyId] = mv;
      else delete state.models[keyId];
      state.keys[keyId] = els.key.value;
    }
    state.prefs.lang = els.lang.value;
    state.prefs.maxChars = Math.round(Number(els.maxchars.value) || 16000);
    state.prefs.customPrompt = els.customPrompt.value;
  }

  function refreshApi() {
    const p = currentProvider();
    const site = currentSite();
    const keyId = currentKeyId();
    const isCustom = p.id === "custom";

    els.key.value = state.keys[keyId] || "";
    if (site.keyUrl) {
      els.keylink.href = site.keyUrl;
      els.keylink.hidden = false;
    } else {
      els.keylink.hidden = true;
    }

    els.baseurlRow.hidden = !isCustom;
    els.hostNote.hidden = true;
    if (isCustom) {
      els.baseurl.value = state.custom.baseUrl;
      const m = state.custom.model;
      els.model.value = m;
      els.modelsug.textContent = "";
      els.model.placeholder = "留空会保存失败，测试/提问时会提示";
      els.modelHint.textContent = "填写与你端点匹配的模型名（如 qwen-plus / gpt-4o-mini / claude-…，以你的网关为准）。";
      els.modelTag.textContent = "可编辑";
      updateEndpointHint();
    } else {
      els.model.placeholder = site.defaultModel || "…";
      // datalist suggestions
      els.modelsug.innerHTML = site.models
        .map((m) => `<option value="${escapeHtml(m)}"></option>`)
        .join("");
      els.model.value = state.models[keyId] || "";
      const def = site.defaultModel || site.models[0] || "";
      els.modelHint.textContent = def
        ? `留空默认使用 ${def}。模型名/价格会随服务商调整，请以官方控制台为准（可输入任意名称）。`
        : "输入任意模型名称。";
      els.modelTag.textContent = "可编辑";
    }
  }

  function updateEndpointHint() {
    const b = els.baseurl.value.trim().replace(/\/+$/, "");
    els.endpointHint.textContent = b
      ? `将向 ${escapeHtml(b + "/chat/completions")} 发送请求。`
      : "填写 OpenAI 兼容的 /chat/completions 端点，例如 https://your-gateway.example.com/v1";
    els.hostNote.hidden = !b || /^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(b);
  }

  function refreshPrefs() {
    if (els.lang.options.length === 0) {
      ["简体中文", "繁體中文", "English", "日本語", "한국어"].forEach((l) => {
        const o = document.createElement("option");
        o.value = l;
        o.textContent = l;
        els.lang.appendChild(o);
      });
    }
    els.lang.value = state.prefs.lang;
    els.maxchars.value = state.prefs.maxChars;
    els.customPrompt.value = state.prefs.customPrompt;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ---------- provider cards ---------- */
  function renderCards() {
    els.providers.textContent = "";
    P.PROVIDERS.forEach((p) => {
      const hasAnyKey = p.sites.some(
        (s) => (state.keys[P.keyIdFor(p.id, s.id)] || "").trim() !== ""
      );
      const div = document.createElement("div");
      div.className = "pa-pcard" + (p.id === state.activeProvider ? " on" : "");
      div.setAttribute("role", "radio");
      div.setAttribute("aria-checked", String(p.id === state.activeProvider));
      div.tabIndex = 0;
      const siteInfo =
        p.sites.length > 1
          ? `含 ${p.sites.length} 个站点（CN / 国际站 Key 不通用）`
          : p.id === "custom"
            ? "任意 OpenAI 兼容端点"
            : "官方开放平台";
      div.innerHTML =
        `<div class="pa-pc-t">${escapeHtml(p.name)}` +
        `<span class="pa-pc-tag">${hasAnyKey ? "已填 Key" : escapeHtml(p.tag)}</span></div>` +
        `<div class="pa-pc-d">${escapeHtml(siteInfo)}</div>`;
      const choose = () => {
        if (state.activeProvider === p.id) return;
        commitForm();
        state.activeProvider = p.id;
        const site = p.sites.find((s) => s.id === state.activeSite) || p.sites[0];
        state.activeSite = site.id;
        renderAll();
      };
      div.addEventListener("click", choose);
      div.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      });
      els.providers.appendChild(div);
    });
    const p = currentProvider();
    els.provNote.textContent = p.note;
  }

  /* ---------- site radios ---------- */
  function renderSites() {
    const p = currentProvider();
    if (p.sites.length > 1) {
      els.siteSec.hidden = false;
      els.siteWarn.textContent = p.note;
      els.sites.textContent = "";
      p.sites.forEach((s) => {
        const div = document.createElement("div");
        div.className = "pa-ssite" + (s.id === state.activeSite ? " on" : "");
        div.setAttribute("role", "radio");
        div.setAttribute("aria-checked", String(s.id === state.activeSite));
        div.innerHTML =
          `<b>${escapeHtml(s.label)}</b>` +
          `<small>${escapeHtml(s.baseUrl.replace(/^https?:\/\//, ""))}</small>`;
        const choose = () => {
          if (state.activeSite === s.id) return;
          commitForm();
          state.activeSite = s.id;
          renderAll();
        };
        div.addEventListener("click", choose);
        div.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            choose();
          }
        });
        els.sites.appendChild(div);
      });
    } else {
      els.siteSec.hidden = true;
      els.sites.textContent = "";
      // ensure site id consistent (e.g. leftover zai:cn)
      if (!p.sites.some((s) => s.id === state.activeSite)) state.activeSite = p.sites[0].id;
    }
  }

  /* ---------- section numbering ---------- */
  function renumber() {
    const hasSite = currentProvider().sites.length > 1;
    const n = { api: hasSite ? 3 : 2, pref: hasSite ? 4 : 3 };
    els.secApiNo.textContent = n.api;
    els.secPrefNo.textContent = n.pref;
  }

  function renderAll() {
    renderCards();
    renderSites();
    refreshApi();
    refreshPrefs();
    renumber();
    hideStatus();
  }

  /* ---------- persistence ---------- */
  async function persistState() {
    const norm = P.normalizeState(state);
    state = norm;
    await PAL.storage.set({ state: norm });
  }

  /* ---------- events ---------- */
  els.keyeye.addEventListener("click", () => {
    const show = els.key.type === "password";
    els.key.type = show ? "text" : "password";
    els.keyeye.textContent = show ? "🙈" : "👁";
  });

  els.baseurl.addEventListener("input", () => {
    commitForm();
    updateEndpointHint();
  });
  els.key.addEventListener("input", () => commitForm());
  els.model.addEventListener("input", () => commitForm());
  els.lang.addEventListener("change", () => commitForm());
  els.maxchars.addEventListener("input", () => commitForm());
  els.customPrompt.addEventListener("input", () => commitForm());

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    commitForm();
    try {
      await persistState();
      setStatus("ok", "已保存 ✓", "配置已写入本机存储，面板与服务端将立即生效。");
    } catch (err) {
      setStatus("err", "保存失败", escapeHtml(String(err && err.message || err)));
    }
  });

  els.test.addEventListener("click", async () => {
    commitForm();
    setStatus("busy", "测试连接中…", "正在向所选服务商发起一次最小请求（约几秒）。");
    els.test.disabled = true;
    try {
      await persistState();
      const resp = await PAL.sendMessage({ type: "test-connection" });
      if (resp && resp.ok) {
        const note = resp.note
          ? `<div>实际返回模型：<code>${escapeHtml(resp.note)}</code></div>`
          : "";
        setStatus(
          "ok",
          "连接成功 ✓",
          `模型 <code>${escapeHtml(resp.model || "")}</code> · ${escapeHtml(resp.endpoint || "")}${note}`
        );
      } else {
        const stepLabel = {
          config: "配置不完整",
          http: `接口返回 HTTP ${resp && resp.status != null ? resp.status : ""}`,
          timeout: "连接超时",
          network: "网络 / 权限错误",
        }[(resp && resp.step) || "network"];
        const msg = (resp && resp.message) || "未知错误";
        setStatus(
          "err",
          stepLabel,
          escapeHtml(msg) +
            (resp && resp.status != null
              ? `<div>HTTP ${resp.status}：检查 Key 是否正确、站点是否与 Key 匹配、账户是否有余额。</div>`
              : "")
        );
      }
    } catch (err) {
      setStatus("err", "测试失败", escapeHtml(String(err && err.message || err)));
    } finally {
      els.test.disabled = false;
    }
  });

  els.clear.addEventListener("click", async () => {
    const ok = window.confirm(
      "确定清空全部数据？\n\n将删除：所有已保存的 API Key、模型名、自定义端点与偏好设置。\n\n此操作不可撤销。"
    );
    if (!ok) return;
    try {
      state = P.normalizeState(P.defaultState());
      await persistState();
      renderAll();
      setStatus("ok", "已清空", "所有 Key 与设置已删除，已恢复默认值。");
    } catch (err) {
      setStatus("err", "清空失败", escapeHtml(String(err && err.message || err)));
    }
  });

  /* ---------- boot ---------- */
  (async function boot() {
    try {
      const got = await PAL.storage.get("state");
      state = P.normalizeState(got && got.state);
    } catch {
      state = P.normalizeState(null);
    }
    renderAll();
  })();
})();
