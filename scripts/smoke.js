#!/usr/bin/env node
/* PageAsk 真实 API Key 冒烟测试。
 *
 * 用途：不装扩展、不跑浏览器，直接对某一家服务商发一次最小
 * /chat/completions 请求，验证端点连通、Key 有效、响应可解析。
 *
 * 用法：
 *   node scripts/smoke.js deepseek           # Key 从环境变量读
 *   node scripts/smoke.js zai:cn   [模型]
 *   node scripts/smoke.js zai:intl [模型]
 *   node scripts/smoke.js kimi     [模型]
 *   node scripts/smoke.js custom [key] [baseUrl] [模型]
 *
 * 参数（位置）：
 *   argv[2] provider
 *   argv[3] key        （缺省读环境变量 PAGEASK_KEY 或 PAGEASK_<PROVIDER>_KEY）
 *   argv[4] model      （非 custom：覆盖默认模型；custom：当作 baseUrl）
 *   argv[5] baseUrl    （仅 custom：OpenAI 兼容根地址；custom 的 model 放 argv[4]）
 *
 * 例：
 *   PAGEASK_KEY=sk-xxxx node scripts/smoke.js deepseek
 *   node scripts/smoke.js kimi sk-xxxx
 *   node scripts/smoke.js custom sk-xxxx http://127.0.0.1:8000/v1 gpt-4o-mini
 */
"use strict";

// 加载纯数据/纯函数库（IIFE，挂到 globalThis.PageAskLib）
require("../web-extension/lib/providers.js");
const P = globalThis.PageAskLib.providers;

const providerArg = process.argv[2] || "";
const keyArg = process.argv[3] || "";
const argv4 = process.argv[4] || "";
const argv5 = process.argv[5] || "";

function usage() {
  console.error(
    "用法: node scripts/smoke.js <provider> [key] [model|baseUrl] [baseUrl]\n" +
      "  provider: deepseek | zai:cn | zai:intl | kimi | custom\n" +
      "  key 缺省时读环境变量 PAGEASK_KEY 或 PAGEASK_<PROVIDER>_KEY\n"
  );
  process.exit(2);
}

if (!providerArg) usage();

let providerId = providerArg;
let siteId = "default";
if (providerArg.startsWith("zai:")) {
  providerId = "zai";
  siteId = providerArg.slice(4) || "cn";
}

const provider = P.findProvider(providerId);
if (!provider) {
  console.error(`未知服务商: ${providerArg}`);
  usage();
}
const site = provider.sites.find((s) => s.id === siteId) || provider.sites[0];
const isCustom = provider.id === "custom";

const keyEnvName = `PAGEASK_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_KEY`;
const apiKey = (keyArg || process.env.PAGEASK_KEY || process.env[keyEnvName] || "").trim();
if (!apiKey) {
  console.error(
    "未提供 API Key。请用第 2 个参数，或环境变量 PAGEASK_KEY / " + keyEnvName + " 提供。"
  );
  usage();
}

let baseUrl = site.baseUrl || "";
let model = site.defaultModel || site.models[0] || "";

if (isCustom) {
  baseUrl = argv4; // custom: 第4参是 baseUrl
  model = argv5 || model || "gpt-4o-mini"; // 第5参是 model
} else if (argv4) {
  model = argv4; // 非 custom: 第4参覆盖模型
}

const endpoint = P.endpointFor(baseUrl);
if (!endpoint) {
  console.error("无法确定端点：baseUrl 为空（custom 请提供 baseUrl）。");
  usage();
}

async function main() {
  console.log(`→ ${provider.fullName} / ${site.label}`);
  console.log(`  endpoint: ${endpoint}`);
  console.log(`  model:    ${model}`);
  console.log(`  key:      ${apiKey.slice(0, 6)}…（${apiKey.length} 字符）`);

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "用一句话回答：你好。" }],
        max_tokens: 512,
        stream: false,
      }),
    });
  } catch (err) {
    console.error(`\n✗ 网络错误: ${err && err.message}`);
    process.exit(1);
  }

  const ms = Date.now() - t0;
  const rawText = await res.text();
  let body = null;
  try {
    body = JSON.parse(rawText);
  } catch {
    /* 非 JSON */
  }

  if (!res.ok) {
    console.error(`\n✗ HTTP ${res.status}（${ms}ms）`);
    if (body && body.error) {
      console.error(`  error: ${JSON.stringify(body.error)}`);
    } else {
      console.error(`  body: ${rawText.slice(0, 500)}`);
    }
    process.exit(1);
  }

  const msg = body && body.choices && body.choices[0] ? body.choices[0].message || {} : null;
  const content = msg && typeof msg.content === "string" ? msg.content : "";
  const reasoning = msg && typeof msg.reasoning_content === "string" ? msg.reasoning_content : "";
  if (msg === null || content === "") {
    console.error(`\n✗ 响应缺少 choices[0].message.content（${ms}ms）`);
    console.error(`  body: ${rawText.slice(0, 500)}`);
    process.exit(1);
  }

  console.log(`\n✓ 成功（${ms}ms）`);
  if (reasoning) console.log(`  reasoning: ${reasoning.length} 字符（已折叠）`);
  console.log(`  reply: ${content.trim()}`);
}

main();
