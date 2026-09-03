/* PageAsk shared browser-API facade.
 * Works in Chrome, Edge and Safari Web Extensions (MV3).
 * Kept dependency-free; modules expose themselves on globalThis.PageAskLib (PAL).
 */
(function (global) {
  "use strict";

  const api = global.browser || global.chrome;
  const PAL = (global.PageAskLib = global.PageAskLib || {});

  PAL.browser = { api };

  /**
   * Call a browser API that may be callback-based (Chrome `chrome.*`) or
   * promise-based (Safari / Firefox `browser.*`). We pass a trailing callback
   * AND await a returned thenable if one is present — whichever settles first
   * wins, so the same call works on every host.
   */
  function promisify(fn, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (resp) => {
        if (settled) return;
        settled = true;
        const err = api && api.runtime && api.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(resp);
      };
      try {
        const ret = fn.apply(api, (args || []).concat([done]));
        if (ret && typeof ret.then === "function") {
          ret.then(
            (v) => { if (!settled) { settled = true; resolve(v); } },
            (e) => { if (!settled) { settled = true; reject(e); } }
          );
        }
      } catch (err) {
        if (!settled) { settled = true; reject(err); }
      }
    });
  }

  PAL.browser.promisify = promisify;

  /** Send a one-shot message (works across callback- and promise-based hosts). */
  function sendMessage(message) {
    if (!api || !api.runtime || !api.runtime.sendMessage) {
      return Promise.reject(new Error("runtime.sendMessage unavailable"));
    }
    return promisify(api.runtime.sendMessage, [message]);
  }

  /** Open the extension options/settings page (must be called from background). */
  function openOptions() {
    if (api.runtime && api.runtime.openOptionsPage) {
      return Promise.resolve(api.runtime.openOptionsPage());
    }
    return Promise.resolve();
  }

  /** chrome.storage.local promise wrapper. */
  const storage = {
    async get(keys) {
      if (api.storage && api.storage.local) {
        const area = api.storage.local;
        if (area.get.length >= 2) {
          return new Promise((resolve) => area.get(keys, resolve));
        }
        return area.get(keys);
      }
      return {};
    },
    async set(obj) {
      if (api.storage && api.storage.local) {
        if (api.storage.local.set.length >= 2) {
          return new Promise((resolve, reject) =>
            api.storage.local.set(obj, () => {
              const err = api.runtime.lastError;
              if (err) reject(new Error(err.message));
              else resolve();
            })
          );
        }
        return api.storage.local.set(obj);
      }
    },
    async remove(keys) {
      if (api.storage && api.storage.local) {
        if (api.storage.local.remove.length >= 2) {
          return new Promise((resolve) => api.storage.local.remove(keys, resolve));
        }
        return api.storage.local.remove(keys);
      }
    },
  };

  PAL.sendMessage = sendMessage;
  PAL.openOptions = openOptions;
  PAL.storage = storage;
})(typeof globalThis !== "undefined" ? globalThis : this);
