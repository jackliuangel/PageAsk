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

const PAL = loadLib("md.js");
const M = PAL.md;

describe("PAL.md exports", () => {
  it("exposes render, escapeHtml, inline", () => {
    assert.strictEqual(typeof M.render, "function");
    assert.strictEqual(typeof M.escapeHtml, "function");
    assert.strictEqual(typeof M.inline, "function");
  });
});

describe("escapeHtml", () => {
  it("escapes HTML-special characters", () => {
    assert.strictEqual(M.escapeHtml("<script>"), "&lt;script&gt;");
    assert.strictEqual(M.escapeHtml('a&b"c\'d'), "a&amp;b&quot;c&#39;d");
    assert.strictEqual(M.escapeHtml("plain text"), "plain text");
    assert.strictEqual(M.escapeHtml(null), "null");
    assert.strictEqual(M.escapeHtml(undefined), "undefined");
  });
});

describe("inline", () => {
  it("turns **bold** into <strong>", () => {
    assert.strictEqual(M.inline("**粗**"), "<strong>粗</strong>");
    assert.strictEqual(M.inline("前 **bold** 后"), "前 <strong>bold</strong> 后");
  });

  it("never emits raw <script>", () => {
    const out = M.inline("<script>alert(1)</script>");
    assert.ok(!out.includes("<script>"));
    assert.ok(out.includes("&lt;script&gt;"));
  });

  it("renders inline code with backticks", () => {
    assert.strictEqual(M.inline("run `npm test` now"), "run <code>npm test</code> now");
    assert.strictEqual(M.inline("`<b>`"), "<code>&lt;b&gt;</code>");
  });

  it("only links http(s) URLs and never javascript:", () => {
    const out = M.inline("[GitHub](https://github.com)");
    assert.ok(out.includes('<a href="https://github.com" target="_blank" rel="noreferrer noopener">GitHub</a>'));
    const bad = M.inline("[x](javascript:alert(1))");
    assert.ok(!bad.includes("<a"));
  });
});

describe("render", () => {
  it("renders **粗** into a <strong>", () => {
    const out = M.render("**粗**");
    assert.ok(out.includes("<strong>粗</strong>"));
    assert.strictEqual(out, "<p><strong>粗</strong></p>");
  });

  it("escapes raw HTML so scripts never execute", () => {
    const out = M.render("<script>alert(1)</script>");
    assert.ok(!out.includes("<script>"));
    assert.ok(out.includes("&lt;script&gt;"));
  });

  it("escapes content inside fenced code blocks", () => {
    const out = M.render("```html\n<script>x</script>\n```");
    assert.strictEqual(out, "<pre><code>&lt;script&gt;x&lt;/script&gt;</code></pre>");
  });

  it("renders headings, lists, blockquotes and hr", () => {
    assert.strictEqual(M.render("# 标题"), "<h1>标题</h1>");
    assert.strictEqual(M.render("### 小标题 **粗**"), "<h3>小标题 <strong>粗</strong></h3>");
    assert.strictEqual(M.render("- a\n- b"), "<ul>\n<li>a</li>\n<li>b</li>\n</ul>");
    assert.strictEqual(M.render("1. a\n2. b"), "<ol>\n<li>a</li>\n<li>b</li>\n</ol>");
    assert.strictEqual(M.render("> 引用"), "<blockquote>引用</blockquote>");
    assert.strictEqual(M.render("---"), "<hr>");
  });

  it("wraps plain paragraphs in <p> and splits on blank lines", () => {
    assert.strictEqual(M.render("第一段\n\n第二段"), "<p>第一段</p>\n<p>第二段</p>");
  });

  it("handles nullish and empty input", () => {
    assert.strictEqual(M.render(""), "");
    assert.strictEqual(M.render(null), "");
    assert.strictEqual(M.render(undefined), "");
  });
});
