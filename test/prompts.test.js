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

const PAL = loadLib("prompts.js");
const Pr = PAL.prompts;

describe("PAL.prompts exports", () => {
  it("exposes LANGS, defaultLang, buildMessages", () => {
    assert.ok(Array.isArray(Pr.LANGS));
    assert.strictEqual(typeof Pr.defaultLang, "function");
    assert.strictEqual(typeof Pr.buildMessages, "function");
  });

  it("LANGS starts with 简体中文 and defaultLang returns it", () => {
    assert.strictEqual(Pr.LANGS[0], "简体中文");
    assert.ok(Pr.LANGS.includes("English"));
    assert.strictEqual(Pr.defaultLang(), "简体中文");
  });

  it("buildMessages returns an array of {role, content} messages", () => {
    const msgs = Pr.buildMessages({ task: "ask", userText: "hi", pageText: "" });
    assert.ok(Array.isArray(msgs));
    assert.ok(msgs.length >= 2);
    for (const m of msgs) {
      assert.strictEqual(typeof m.role, "string");
      assert.strictEqual(typeof m.content, "string");
    }
  });
});

describe("buildMessages — translate", () => {
  it("system prompt mentions 翻译 and the target lang 'English'", () => {
    const msgs = Pr.buildMessages({
      task: "translate",
      lang: "English",
      pageText: "Hello world.",
      pageTitle: "Test Page",
      pageUrl: "https://example.com",
    });
    const sys = msgs.find((m) => m.role === "system");
    assert.ok(sys.content.includes("English"));
    assert.ok(sys.content.includes("翻译"));
  });

  it("the user message contains the page text and page header", () => {
    const pageText = "这是需要翻译的正文内容。";
    const msgs = Pr.buildMessages({
      task: "translate",
      lang: "简体中文",
      pageText,
      pageTitle: "测试页",
      pageUrl: "https://example.com/x",
    });
    const user = msgs.find((m) => m.role === "user");
    assert.ok(user.content.includes(pageText));
    assert.ok(user.content.includes("《测试页》"));
    assert.ok(user.content.includes("https://example.com/x"));
    assert.ok(user.content.includes("【正文开始】"));
    assert.ok(user.content.includes("【正文结束】"));
  });

  it("includes a truncation notice with the char count when truncated=true", () => {
    const msgs = Pr.buildMessages({
      task: "translate",
      lang: "English",
      pageText: "text".repeat(10),
      truncated: true,
      charCount: 45210,
    });
    const user = msgs.find((m) => m.role === "user");
    assert.ok(user.content.includes("截取前 45210 字左右"));
  });

  it("omits the truncation notice when truncated=false", () => {
    const msgs = Pr.buildMessages({
      task: "translate",
      lang: "English",
      pageText: "abc",
      truncated: false,
      charCount: 3,
    });
    const user = msgs.find((m) => m.role === "user");
    assert.ok(!user.content.includes("字左右"));
  });

  it("falls back to 简体中文 for an unsupported lang", () => {
    const msgs = Pr.buildMessages({ task: "translate", lang: "Klingon", pageText: "x" });
    const sys = msgs.find((m) => m.role === "system");
    assert.ok(sys.content.includes("简体中文"));
    assert.ok(!sys.content.includes("Klingon"));
  });
});

describe("buildMessages — ask", () => {
  it("appends a custom prompt to the built-in system prompt", () => {
    const msgs = Pr.buildMessages({
      task: "ask",
      lang: "English",
      customPrompt: "Use concise bullet points.",
      userText: "What matters?",
    });
    assert.ok(msgs[0].content.includes("网页阅读助理"));
    assert.ok(msgs[0].content.includes("用户自定义指令：\nUse concise bullet points."));
  });

  it("grounds the system prompt and carries the userText question", () => {
    const q = "这篇文章的主要结论是什么？";
    const msgs = Pr.buildMessages({
      task: "ask",
      lang: "English",
      userText: q,
      pageText: "Some page body…",
    });
    assert.strictEqual(msgs[0].role, "system");
    assert.ok(msgs[0].content.includes("English"));
    const user = msgs.find((m) => m.role === "user");
    assert.ok(user.content.includes(q));
    assert.ok(user.content.includes("Some page body…"));
  });

  it("defaults an unknown task to ask", () => {
    const q = "它讲了什么？";
    const msgs = Pr.buildMessages({ userText: q, pageText: "" });
    assert.ok(msgs.find((m) => m.role === "user").content.includes(q));
  });
});

describe("buildMessages — other tasks", () => {
  it("summarize uses a summarizing system prompt", () => {
    const msgs = Pr.buildMessages({ task: "summarize", lang: "简体中文", pageText: "正文" });
    assert.ok(msgs[0].content.includes("总结"));
    const user = msgs.find((m) => m.role === "user");
    assert.ok(user.content.includes("正文"));
  });

  it("selection-translate translates the selected content", () => {
    const sel = "选中的一段文字";
    const msgs = Pr.buildMessages({ task: "selection-translate", lang: "English", pageText: sel });
    assert.ok(msgs[0].content.includes("翻译"));
    const user = msgs.find((m) => m.role === "user");
    assert.ok(user.content.includes(sel));
  });
});
