/* PageAsk minimal Markdown -> safe HTML renderer.
 * Strategy: HTML-escape first, then apply structural transforms so raw HTML
 * from the LLM can never execute. Content is rendered inside a Shadow DOM.
 */
(function (global) {
  "use strict";

  const PAL = (global.PageAskLib = global.PageAskLib || {});

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inline(md) {
    let s = escapeHtml(md);
    // inline code
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    // bold
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    // italic
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    // links: keep plain text target, no javascript:
    s = s.replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      (_, label, href) => `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`
    );
    return s;
  }

  /**
   * Render markdown text to an HTML string (no surrounding block wrapper).
   * Supports: headings #..###, fenced code blocks, bullet/numbered lists,
   * blockquotes, hr, paragraphs, inline styling.
   */
  function render(md) {
    if (md == null) return "";
    const raw = String(md).replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    const out = [];
    let i = 0;
    let inCode = false;
    let codeBuf = [];
    let inList = null; // "ul" | "ol" | null

    const closeList = () => {
      if (inList) {
        out.push(`</${inList}>`);
        inList = null;
      }
    };

    const flushCode = () => {
      if (!inCode) return;
      out.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
      codeBuf = [];
      inCode = false;
    };

    for (; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^```(.*)$/);
      if (fence) {
        if (inCode) {
          flushCode();
        } else {
          closeList();
          inCode = true;
          codeBuf = [];
        }
        continue;
      }
      if (inCode) {
        codeBuf.push(escapeHtml(line));
        continue;
      }
      const trimmed = line.trim();
      if (!trimmed) {
        closeList();
        continue;
      }
      const hr = trimmed.match(/^(-{3,}|\*{3,}|_{3,})$/);
      if (hr) {
        closeList();
        out.push("<hr>");
        continue;
      }
      const head = trimmed.match(/^(#{1,3})\s+(.*)$/);
      if (head) {
        closeList();
        const level = head[1].length;
        out.push(`<h${level}>${inline(head[2])}</h${level}>`);
        continue;
      }
      const quote = trimmed.startsWith(">");
      if (quote) {
        closeList();
        out.push(`<blockquote>${inline(trimmed.replace(/^>\s?/, ""))}</blockquote>`);
        continue;
      }
      const li = trimmed.match(/^[-*+]\s+(.*)$/);
      if (li) {
        if (inList !== "ul") {
          closeList();
          out.push("<ul>");
          inList = "ul";
        }
        out.push(`<li>${inline(li[1])}</li>`);
        continue;
      }
      const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
      if (ol) {
        if (inList !== "ol") {
          closeList();
          out.push("<ol>");
          inList = "ol";
        }
        out.push(`<li>${inline(ol[1])}</li>`);
        continue;
      }
      closeList();
      out.push(`<p>${inline(trimmed)}</p>`);
    }
    closeList();
    flushCode();
    return out.join("\n");
  }

  PAL.md = { render, escapeHtml, inline };
})(typeof globalThis !== "undefined" ? globalThis : this);
