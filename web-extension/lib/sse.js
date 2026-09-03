/* PageAsk streaming chat client for OpenAI-compatible /chat/completions.
 * Pure-ish module: no browser globals used at runtime except fetch/AbortController,
 * so it can be unit-tested under Node with injected fetch.
 */
(function (global) {
  "use strict";

  const PAL = (global.PageAskLib = global.PageAskLib || {});

  /** Incremental SSE parser: feed raw chunks, get back arrays of `data:` payloads. */
  function createSSEParser() {
    let buffer = "";
    return {
      push(chunk) {
        buffer += chunk;
        buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const events = [];
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = block.split("\n").filter((l) => l.startsWith("data:"));
          if (dataLines.length) {
            events.push(dataLines.map((l) => l.slice(5).replace(/^ /, "")).join("\n"));
          }
        }
        return events;
      },
    };
  }

  /**
   * Extract streamed delta fields from one parsed `data:` JSON payload.
   * Returns { content, reasoning, done, finishReason, error } (strings/booleans).
   * Tolerates: string content, array-of-parts content, reasoning_content,
   * choices empty (usage-only), and [DONE].
   */
  function parseStreamEvent(dataText) {
    const out = { content: "", reasoning: "", done: false, finishReason: "", error: null };
    if (dataText === "[DONE]") {
      out.done = true;
      return out;
    }
    let obj;
    try {
      obj = JSON.parse(dataText);
    } catch {
      return out; // ignore non-JSON noise
    }
    if (obj.error) {
      out.error = obj.error;
      return out;
    }
    const choice = obj.choices && obj.choices[0];
    if (!choice) {
      if (obj.choices && obj.choices.length === 0) out.done = true;
      return out;
    }
    const delta = choice.delta || choice.message || {};
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      out.reasoning = delta.reasoning_content;
    }
    if (typeof delta.content === "string") {
      out.content = delta.content;
    } else if (Array.isArray(delta.content)) {
      out.content = delta.content
        .filter((p) => p && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
    }
    if (choice.finish_reason) out.finishReason = choice.finish_reason;
    return out;
  }

  /** Parse a non-streaming JSON response body. */
  function parseNonStreamBody(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return { content: "", error: { message: "无法解析 API 响应" } };
    }
    if (obj.error) return { content: "", error: obj.error };
    const choice = obj.choices && obj.choices[0];
    const msg = (choice && (choice.message || choice.delta)) || {};
    let content = "";
    if (typeof msg.content === "string") content = msg.content;
    else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((p) => p && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
    }
    return { content, error: null };
  }

  /**
   * Run a chat completion request, streaming deltas to onEvent.
   *
   * opts: {
   *   endpoint, apiKey, model, messages,
   *   maxTokens?,   // optional
   *   signal?,      // external AbortSignal (user stop)
   *   fetchImpl?,   // injectable fetch for tests
   *   onEvent({type:'delta'|'reasoning'|'done'|'error', ...})
   * }
   * Returns a promise resolving with { ok } or rejecting with ApiError.
   */
  async function chatStream(opts) {
    const {
      endpoint,
      apiKey,
      model,
      messages,
      maxTokens,
      signal,
      fetchImpl,
      onEvent,
    } = opts;
    const fetchFn = fetchImpl || global.fetch;
    if (!fetchFn) {
      const e = new Error("当前环境不支持 fetch");
      e.code = "NETWORK";
      throw e;
    }

    const body = {
      model,
      messages,
      stream: true,
    };
    if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;

    let resp;
    try {
      resp = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      const e = new Error(err && err.message ? err.message : "网络请求失败");
      e.code = err && err.name === "AbortError" ? "ABORTED" : "NETWORK";
      if (e.code === "NETWORK" && err && err.cause) e.cause = err.cause;
      throw e;
    }

    const ctype = (resp.headers.get("content-type") || "").toLowerCase();
    if (!resp.ok) {
      let detail = "";
      try {
        const text = await resp.text();
        try {
          const j = JSON.parse(text);
          detail = (j.error && (j.error.message || j.error.code)) || text;
        } catch {
          detail = text.slice(0, 500);
        }
      } catch {
        /* ignore */
      }
      const e = new Error(detail || `HTTP ${resp.status}`);
      e.code = "HTTP";
      e.status = resp.status;
      e.detail = detail;
      throw e;
    }

    const isStream =
      ctype.includes("text/event-stream") ||
      ctype.includes("application/x-ndjson");

    if (!isStream) {
      // Some gateways ignore `stream: true`; fall back to a plain JSON reply.
      const text = await resp.text();
      const { content, error } = parseNonStreamBody(text);
      if (error) {
        const e = new Error(error.message || "API 返回错误");
        e.code = "API";
        throw e;
      }
      if (content) onEvent({ type: "delta", content });
      onEvent({ type: "done" });
      return { ok: true };
    }

    if (!resp.body || !resp.body.getReader) {
      const e = new Error("浏览器不支持流式读取响应");
      e.code = "NETWORK";
      throw e;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const parser = createSSEParser();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const events = parser.push(decoder.decode(value, { stream: true }));
        for (const ev of events) {
          const parsed = parseStreamEvent(ev);
          if (parsed.error) {
            const e = new Error(parsed.error.message || "API 返回错误");
            e.code = "API";
            throw e;
          }
          if (parsed.reasoning) onEvent({ type: "reasoning", text: parsed.reasoning });
          if (parsed.content) onEvent({ type: "delta", text: parsed.content });
          if (parsed.done || parsed.finishReason) {
            finished = true;
          }
        }
        if (finished) break;
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    onEvent({ type: "done" });
    return { ok: true };
  }

  /** Build a short "ping" request to validate key/endpoint/model. */
  async function testConnection(opts) {
    const { endpoint, apiKey, model, signal, fetchImpl } = opts;
    const fetchFn = fetchImpl || global.fetch;
    const resp = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal,
    });
    const text = await resp.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: resp.status, ok: resp.ok, body: parsed, raw: text.slice(0, 400) };
  }

  PAL.sse = {
    createSSEParser,
    parseStreamEvent,
    parseNonStreamBody,
    chatStream,
    testConnection,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
