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
      messages.push({ role: "system", content: buildTranslateSystem(lang) });
      const body = payload.pageText || "";
      const user =
        `请把网页 ${header} 的正文完整翻译成${lang}。` +
        notice +
        `\n\n【正文开始】\n${body}\n【正文结束】`;
      messages.push({ role: "user", content: user });
    } else if (task === "selection-translate") {
      messages.push({ role: "system", content: buildTranslateSystem(lang) });
      const body = payload.pageText || payload.userText || "";
      messages.push({
        role: "user",
        content: `请把以下选中内容翻译成${lang}：\n\n"""\n${body}\n"""`,
      });
    } else if (task === "summarize") {
      messages.push({ role: "system", content: buildSummarizeSystem(lang) });
      const user =
        `请总结网页 ${header} 的正文。` +
        notice +
        `\n\n【正文开始】\n${payload.pageText || ""}\n【正文结束】`;
      messages.push({ role: "user", content: user });
    } else {
      // ask — grounded Q&A
      messages.push({ role: "system", content: buildAskSystem(lang) });
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
