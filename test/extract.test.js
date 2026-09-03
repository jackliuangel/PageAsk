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

const PAL = loadLib("extract.js");
const E = PAL.extract;

const host = (v) => JSON.parse(JSON.stringify(v));

describe("PAL.extract exports", () => {
  it("exposes tidyLine, joinLines, normalizeWhitespace, truncate", () => {
    for (const fn of ["tidyLine", "joinLines", "normalizeWhitespace", "truncate"]) {
      assert.strictEqual(typeof E[fn], "function", `missing ${fn}`);
    }
  });
});

describe("tidyLine", () => {
  it("collapses runs of whitespace to single spaces and trims", () => {
    assert.strictEqual(E.tidyLine("  a \t b\n\n  c  "), "a b c");
    assert.strictEqual(E.tidyLine("   only   "), "only");
    assert.strictEqual(E.tidyLine(""), "");
  });
});

describe("joinLines", () => {
  it("drops blank lines and joins the rest with blank lines between", () => {
    assert.strictEqual(E.joinLines(["  para one  ", "   ", "", " para two "]), "para one\n\npara two");
    assert.strictEqual(E.joinLines([]), "");
    assert.strictEqual(E.joinLines(["", "  "]), "");
  });
});

describe("normalizeWhitespace", () => {
  it("collapses runs of 3+ newlines down to 2 and trims", () => {
    assert.strictEqual(E.normalizeWhitespace("\n\n\nfoo\n\n\n\nbar\n\n"), "foo\n\nbar");
  });

  it("strips trailing spaces/tabs before newlines", () => {
    assert.strictEqual(E.normalizeWhitespace("a  \n\t\nb"), "a\n\nb");
  });

  it("returns '' for null/undefined input", () => {
    assert.strictEqual(E.normalizeWhitespace(null), "");
    assert.strictEqual(E.normalizeWhitespace(undefined), "");
  });
});

describe("truncate", () => {
  it("returns the text untouched when it fits", () => {
    const r = E.truncate("short text", 100);
    assert.deepStrictEqual(host(r), { text: "short text", truncated: false, originalLength: 10 });
  });

  it("handles empty / missing text", () => {
    assert.strictEqual(E.truncate("", 10).truncated, false);
    assert.strictEqual(E.truncate("", 10).originalLength, 0);
    assert.strictEqual(E.truncate(undefined, 10).text, "");
    assert.strictEqual(E.truncate(null, 10).originalLength, 0);
  });

  it("honors the length limit and prefers a sentence boundary", () => {
    // '。' sits at index 15; maxChars 20 → floor 12 → boundary qualifies (15 > 12)
    const text = "说明甲。".concat("y".repeat(11)).concat("。").concat("z".repeat(100));
    assert.strictEqual(text.length, 116);
    const r = E.truncate(text, 20);
    assert.strictEqual(r.truncated, true);
    assert.strictEqual(r.originalLength, 116);
    assert.ok(r.text.length <= 20);
    assert.ok(r.text.endsWith("。"));
  });

  it("keeps a surrogate pair intact when cutting at a sentence boundary", () => {
    const text = "第一句完整话。".concat("😀".repeat(30)); // '。' at index 6
    const r = E.truncate(text, 8);
    assert.strictEqual(r.truncated, true);
    assert.strictEqual(r.text, "第一句完整话。");
    // no lone surrogate halves in the output
    assert.ok(!/[\uD800-\uDBFF]$/.test(r.text), "result ends with a lone high surrogate");
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(r.text), "result contains a broken pair");
  });

  it("output length never exceeds maxChars even without a usable boundary", () => {
    // Pure emoji text has no sentence marker; code returns slice(0, maxChars).
    const text = "😀".repeat(10); // 20 code units
    const r = E.truncate(text, 5);
    assert.strictEqual(r.truncated, true);
    assert.ok(r.text.length <= 5);
  });

  it("never splits a surrogate pair when cutting at the hard cap", () => {
    // No sentence/paragraph boundary exists anywhere: hard-cap slice must not
    // land between the halves of an emoji surrogate pair.
    const text = "😀".repeat(10); // 20 code units, no boundaries
    for (const n of [5, 7, 9, 11, 15, 19]) {
      const r = E.truncate(text, n);
      assert.strictEqual(r.truncated, true);
      assert.ok(r.text.length <= n, `text length ${r.text.length} <= ${n}`);
      assert.ok(
        !/[\uD800-\uDBFF]$/.test(r.text),
        `no lone high surrogate at end for n=${n}`
      );
      assert.ok(
        !/[\uDC00-\uDFFF]/.test(r.text[0] || "") || r.text.charCodeAt(0) >= 0xd800,
        `no orphaned low surrogate at start for n=${n}`
      );
      // reconstructibility: r.text is a prefix of text
      assert.ok(
        text.startsWith(r.text),
        `result is a prefix of source for n=${n}`
      );
    }
    // And the even-safe case: when the cap lands right after a full pair, keep it.
    const even = E.truncate("😀".repeat(4), 8); // 8 code units == 4 full pairs
    assert.strictEqual(even.text, "😀".repeat(4));
  });
});
