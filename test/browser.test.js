const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

// browser.js reads `globalThis.browser || globalThis.chrome`, so we inject a
// fake host (promise-style `browser` or callback-style `chrome`) into the VM.
function loadBrowser(inject) {
  const code = fs.readFileSync(
    path.join(__dirname, "..", "web-extension", "lib", "browser.js"),
    "utf8"
  );
  const s = Object.assign({}, inject);
  vm.createContext(s);
  vm.runInContext(code, s);
  return s.PageAskLib;
}

describe("PAL.browser facade", () => {
  it("exposes api and promisify", () => {
    const PAL = loadBrowser({});
    assert.strictEqual(PAL.browser.api, undefined);
    assert.strictEqual(typeof PAL.browser.promisify, "function");
  });

  it("promisify resolves a callback-style (chrome) call", async () => {
    const PAL = loadBrowser({});
    const v = await PAL.browser.promisify((cb) => cb({ n: 42 }), []);
    assert.deepStrictEqual(v, { n: 42 });
  });

  it("promisify resolves a promise-style (browser) call", async () => {
    const PAL = loadBrowser({});
    const v = await PAL.browser.promisify(() => Promise.resolve("ok"), []);
    assert.strictEqual(v, "ok");
  });

  it("promisify rejects a rejected promise", async () => {
    const PAL = loadBrowser({});
    await assert.rejects(
      () => PAL.browser.promisify(() => Promise.reject(new Error("boom")), []),
      /boom/
    );
  });

  it("promisify rejects on a synchronous throw", async () => {
    const PAL = loadBrowser({});
    await assert.rejects(
      () => PAL.browser.promisify(() => { throw new Error("sync boom"); }, []),
      /sync boom/
    );
  });

  it("promisify rejects when runtime.lastError is set (chrome callback error)", async () => {
    const PAL = loadBrowser({
      chrome: {
        runtime: { lastError: { message: "no listener" } },
      },
    });
    await assert.rejects(
      () => PAL.browser.promisify((cb) => cb(), []),
      /no listener/
    );
  });

  it("promisify ignores the later settle when both callback and promise fire", async () => {
    const PAL = loadBrowser({});
    // Callback fires first and wins; the returned promise resolves second.
    const v = await PAL.browser.promisify((cb) => {
      cb("callback-wins");
      return Promise.resolve("promise-wins");
    }, []);
    assert.strictEqual(v, "callback-wins");
  });

  it("sendMessage works with promise-style browser.runtime.sendMessage", async () => {
    const PAL = loadBrowser({
      browser: {
        runtime: { sendMessage: (msg) => Promise.resolve({ echo: msg }) },
      },
    });
    const resp = await PAL.sendMessage({ type: "hello" });
    assert.deepStrictEqual(resp, { echo: { type: "hello" } });
  });

  it("sendMessage works with callback-style chrome.runtime.sendMessage", async () => {
    const PAL = loadBrowser({
      chrome: {
        runtime: {
          lastError: null,
          sendMessage: (msg, cb) => cb({ got: msg }),
        },
      },
    });
    const resp = await PAL.sendMessage({ type: "hello" });
    assert.deepStrictEqual(resp, { got: { type: "hello" } });
  });

  it("sendMessage rejects when the API is unavailable", async () => {
    const PAL = loadBrowser({});
    await assert.rejects(() => PAL.sendMessage({ type: "x" }), /unavailable/);
  });
});
