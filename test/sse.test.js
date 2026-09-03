const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

// sse.js uses TextDecoder / (fallback) global fetch at runtime. A bare Node vm
// context exposes only ECMAScript built-ins, so inject the host globals it
// needs before the lib runs (TextDecoder is required for chatStream).
function loadLib(rel) {
  const code = fs.readFileSync(path.join(__dirname, "..", "web-extension", "lib", rel), "utf8");
  const s = { TextDecoder, TextEncoder, fetch, console };
  vm.createContext(s);
  vm.runInContext(code, s);
  return s.PageAskLib;
}

const PAL = loadLib("sse.js");
const S = PAL.sse;

// Values produced inside the vm context live in a different realm (different
// Object/Array prototypes), so normalize them before strict deep-compares.
const host = (v) => JSON.parse(JSON.stringify(v));

function makeResponse({ ok = true, status = 200, ctype = "text/event-stream", bodyText = "", chunks = null }) {
  const st = { idx: 0, canceled: false };
  return {
    ok,
    status,
    headers: {
      get: (n) => (String(n).toLowerCase() === "content-type" ? ctype : null),
    },
    async text() {
      return bodyText;
    },
    body: chunks
      ? {
          getReader() {
            return {
              async read() {
                if (st.idx >= chunks.length) return { done: true, value: undefined };
                return { done: false, value: Buffer.from(chunks[st.idx++], "utf8") };
              },
              async cancel() {
                st.canceled = true;
              },
            };
          },
        }
      : null,
    wasCanceled: () => st.canceled,
  };
}

describe("PAL.sse exports", () => {
  it("exposes createSSEParser, parseStreamEvent, parseNonStreamBody, chatStream, testConnection", () => {
    for (const fn of ["createSSEParser", "parseStreamEvent", "parseNonStreamBody", "chatStream", "testConnection"]) {
      assert.strictEqual(typeof S[fn], "function", `missing ${fn}`);
    }
  });
});

describe("parseStreamEvent", () => {
  it("marks [DONE] as done", () => {
    assert.deepStrictEqual(host(S.parseStreamEvent("[DONE]")), {
      content: "", reasoning: "", done: true, finishReason: "", error: null,
    });
  });

  it("extracts delta content text", () => {
    const r = S.parseStreamEvent('{"choices":[{"delta":{"content":"你"}}]}');
    assert.strictEqual(r.content, "你");
    assert.strictEqual(r.done, false);
    assert.strictEqual(r.error, null);
  });

  it("extracts reasoning_content and finish_reason", () => {
    const r = S.parseStreamEvent('{"choices":[{"delta":{"reasoning_content":"思考中"},"finish_reason":"stop"}]}');
    assert.strictEqual(r.reasoning, "思考中");
    assert.strictEqual(r.finishReason, "stop");
  });

  it("joins array-of-parts content", () => {
    const r = S.parseStreamEvent('{"choices":[{"delta":{"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}}]}');
    assert.strictEqual(r.content, "ab");
  });

  it("marks an empty choices array as done", () => {
    assert.strictEqual(S.parseStreamEvent('{"choices":[]}').done, true);
  });

  it("surfaces API errors and ignores non-JSON noise", () => {
    const r = S.parseStreamEvent('{"error":{"message":"boom"}}');
    assert.deepStrictEqual(host(r.error), { message: "boom" });
    assert.strictEqual(S.parseStreamEvent("not json").error, null);
    assert.strictEqual(S.parseStreamEvent("not json").content, "");
    assert.strictEqual(S.parseStreamEvent("not json").done, false);
  });
});

describe("parseNonStreamBody", () => {
  it("parses a normal message payload", () => {
    const r = S.parseNonStreamBody('{"choices":[{"message":{"content":"你好"}}]}');
    assert.deepStrictEqual(host(r), { content: "你好", error: null });
  });

  it("handles delta-shaped replies and array content", () => {
    assert.strictEqual(S.parseNonStreamBody('{"choices":[{"delta":{"content":"hi"}}]}').content, "hi");
    assert.strictEqual(
      S.parseNonStreamBody('{"choices":[{"message":{"content":[{"type":"text","text":"x"},{"type":"text","text":"y"}]}}]}').content,
      "xy"
    );
  });

  it("returns an error object for API errors and garbage input", () => {
    assert.deepStrictEqual(host(S.parseNonStreamBody('{"error":{"message":"denied"}}')), {
      content: "",
      error: { message: "denied" },
    });
    const bad = S.parseNonStreamBody("<html>not json</html>");
    assert.strictEqual(bad.content, "");
    assert.ok(bad.error && bad.error.message);
  });
});

describe("createSSEParser", () => {
  it("accumulates partial chunks and yields data: payloads on blank-line boundaries", () => {
    const p = S.createSSEParser();
    assert.deepStrictEqual(host(p.push('data: {"choices":[{"delta":{"content":"好"}}]}')), []);
    const events = p.push('\n\ndata: [DONE]\n\n');
    assert.deepStrictEqual(host(events), ['{"choices":[{"delta":{"content":"好"}}]}', "[DONE]"]);
  });

  it("joins multi-line data: payloads with newlines", () => {
    const p = S.createSSEParser();
    assert.deepStrictEqual(host(p.push("data: line1\ndata: line2\n\n")), ["line1\nline2"]);
  });
});

describe("chatStream", () => {
  const SSE_OPTS = {
    endpoint: "https://api.test/v1/chat/completions",
    apiKey: "sk-12345",
    model: "model-x",
    messages: [{ role: "user", content: "hello" }],
  };

  function collect(resp, extra) {
    const events = [];
    let init = null;
    const promise = S.chatStream({
      ...SSE_OPTS,
      ...extra,
      fetchImpl: async (url, opts) => {
        init = { url, opts };
        return resp;
      },
      onEvent: (e) => events.push(e),
    });
    return { events, init: () => init, promise };
  }

  it("sends a correct streaming request and reports delta text then done", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n',
    ];
    const resp = makeResponse({ chunks });
    const { events, init, promise } = collect(resp);
    const out = await promise;

    assert.deepStrictEqual(host(out), { ok: true });
    assert.deepStrictEqual(host(events), [
      { type: "delta", text: "你" },
      { type: "delta", text: "好" },
      { type: "done" },
    ]);

    const { url, opts } = init();
    assert.strictEqual(url, SSE_OPTS.endpoint);
    assert.strictEqual(opts.method, "POST");
    assert.strictEqual(opts.headers["Content-Type"], "application/json");
    assert.strictEqual(opts.headers.Authorization, `Bearer ${SSE_OPTS.apiKey}`);
    const body = JSON.parse(opts.body);
    assert.deepStrictEqual(body, { model: "model-x", messages: SSE_OPTS.messages, stream: true });
    assert.strictEqual(resp.wasCanceled(), true, "reader should be cancelled on completion");
  });

  it("keeps decoding when an SSE event is split across network chunks", async () => {
    const resp = makeResponse({
      chunks: [
        'data: {"choices":[{"delta":{"co',
        'ntent":"跨块"}}]}\n\ndata: [DONE]\n\n',
      ],
    });
    const { events, promise } = collect(resp);
    const out = await promise;
    assert.strictEqual(out.ok, true);
    assert.deepStrictEqual(host(events), [{ type: "delta", text: "跨块" }, { type: "done" }]);
  });

  it("terminates cleanly on a finish_reason even without [DONE]", async () => {
    const resp = makeResponse({
      chunks: ['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'],
    });
    const { events, promise } = collect(resp);
    const out = await promise;
    assert.strictEqual(out.ok, true);
    assert.deepStrictEqual(host(events), [{ type: "done" }]);
  });

  it("passes max_tokens through when provided", async () => {
    const resp = makeResponse({ chunks: ["data: [DONE]\n\n"] });
    const { init, promise } = collect(resp, { maxTokens: 512 });
    await promise;
    assert.strictEqual(JSON.parse(init().opts.body).max_tokens, 512);
  });

  it("falls back to a plain JSON reply when content-type is not a stream", async () => {
    const resp = makeResponse({
      ctype: "application/json",
      bodyText: JSON.stringify({ choices: [{ message: { content: "非流式回复" } }] }),
    });
    const { events, promise } = collect(resp);
    const out = await promise;
    assert.strictEqual(out.ok, true);
    assert.deepStrictEqual(host(events), [{ type: "delta", content: "非流式回复" }, { type: "done" }]);
  });

  it("rejects with an HTTP error carrying status + detail", async () => {
    const resp = makeResponse({
      ok: false,
      status: 401,
      ctype: "application/json",
      bodyText: JSON.stringify({ error: { message: "bad key" } }),
    });
    const { promise } = collect(resp);
    await assert.rejects(promise, (err) => {
      assert.strictEqual(err.code, "HTTP");
      assert.strictEqual(err.status, 401);
      assert.strictEqual(err.detail, "bad key");
      return true;
    });
  });

  it("rejects with an API error when the stream carries an error payload", async () => {
    const resp = makeResponse({ chunks: ['data: {"error":{"message":"余额不足"}}\n\n'] });
    const { promise } = collect(resp);
    await assert.rejects(promise, (err) => {
      assert.strictEqual(err.code, "API");
      assert.strictEqual(err.message, "余额不足");
      return true;
    });
  });

  it("throws a NETWORK error when no fetch implementation is reachable", async () => {
    // Load into a sandbox with TextDecoder but no fetch and pass no fetchImpl.
    const code = fs.readFileSync(
      path.join(__dirname, "..", "web-extension", "lib", "sse.js"),
      "utf8"
    );
    const s = { TextDecoder, TextEncoder, console };
    vm.createContext(s);
    vm.runInContext(code, s);
    await assert.rejects(
      s.PageAskLib.sse.chatStream({
        endpoint: "https://x",
        apiKey: "k",
        model: "m",
        messages: [],
        onEvent: () => {},
      }),
      (err) => err.code === "NETWORK"
    );
  });
});

describe("testConnection", () => {
  it("pings with stream:false and max_tokens:1 and returns status/ok/body/raw", async () => {
    let init = null;
    const resp = makeResponse({
      ok: true,
      status: 200,
      ctype: "application/json",
      bodyText: JSON.stringify({ id: "ping-1", choices: [] }),
    });
    const out = await S.testConnection({
      endpoint: "https://api.test/chat/completions",
      apiKey: "sk-abc",
      model: "m1",
      fetchImpl: async (url, opts) => {
        init = opts;
        return resp;
      },
    });
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.ok, true);
    assert.deepStrictEqual(host(out.body), { id: "ping-1", choices: [] });
    assert.ok(out.raw.includes("ping-1"));
    const body = JSON.parse(init.body);
    assert.strictEqual(body.model, "m1");
    assert.strictEqual(body.max_tokens, 1);
    assert.strictEqual(body.stream, false);
    assert.deepStrictEqual(body.messages, [{ role: "user", content: "ping" }]);
    assert.strictEqual(init.headers.Authorization, "Bearer sk-abc");
  });

  it("returns the HTTP status/ok for failures without throwing", async () => {
    const resp = makeResponse({
      ok: false,
      status: 401,
      ctype: "application/json",
      bodyText: JSON.stringify({ error: { message: "nope" } }),
    });
    const out = await S.testConnection({
      endpoint: "https://x",
      apiKey: "k",
      model: "m",
      fetchImpl: async () => resp,
    });
    assert.strictEqual(out.status, 401);
    assert.strictEqual(out.ok, false);
    assert.deepStrictEqual(host(out.body), { error: { message: "nope" } });
  });
});
