/* PageAsk text extraction helpers.
 * Pure, DOM-free helpers are exported for unit tests; DOM walking lives in
 * content.js and reuses the helpers below.
 */
(function (global) {
  "use strict";

  const PAL = (global.PageAskLib = global.PageAskLib || {});

  /** Collapse runs of whitespace inside a single line of text. */
  function tidyLine(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  /** Join raw DOM text fragments into readable paragraphs. */
  function joinLines(lines) {
    const out = [];
    for (const raw of lines) {
      const line = tidyLine(raw);
      if (line) out.push(line);
    }
    return out.join("\n\n");
  }

  /** Merge >2 consecutive blank lines and trim. */
  function normalizeWhitespace(text) {
    return (text || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * Truncate to at most maxChars characters, preferring to cut at a sentence
   * or paragraph boundary. Never splits a surrogate pair. Returns
   * { text, truncated, originalLength }.
   */
  function truncate(text, maxChars) {
    const original = text || "";
    const originalLength = original.length;
    if (originalLength <= maxChars) {
      return { text: original, truncated: false, originalLength };
    }
    let cut = original.slice(0, maxChars);
    // Back off to the last sentence-ish boundary after 60% of the window.
    const floor = Math.floor(maxChars * 0.6);
    let boundary = -1;
    for (const marker of ["\n\n", "。", ". ", "！", "？", "\n"]) {
      const i = cut.lastIndexOf(marker);
      if (i >= floor && i > boundary) boundary = i;
    }
    if (boundary > floor) {
      // keep marker; drop it when the marker is the line break itself
      const keep = cut[boundary] === "\n" ? boundary : boundary + 1;
      cut = cut.slice(0, keep);
    } else {
      // No suitable boundary found: enforce the hard cap without splitting a
      // surrogate pair (e.g. an emoji-heavy paragraph with no punctuation).
      if (boundaryCouldSplitPair(cut)) {
        cut = cut.slice(0, maxChars - 1);
      }
    }
    return { text: cut, truncated: true, originalLength };
  }

  /** True when index maxChars-1 (already sliced) falls between a surrogate pair. */
  function boundaryCouldSplitPair(cut) {
    if (cut.length === 0) return false;
    const last = cut.charCodeAt(cut.length - 1);
    // high surrogate (0xD800-0xDBFF) with no following low surrogate means split
    return last >= 0xd800 && last <= 0xdbff;
  }

  PAL.extract = {
    tidyLine,
    joinLines,
    normalizeWhitespace,
    truncate,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
