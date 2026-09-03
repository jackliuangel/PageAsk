#!/usr/bin/env node
/* Bundle the background worker into a single file.
 *
 * Safari runs the extension background as "background content" (a page, not a
 * Service Worker), where `importScripts()` is unavailable. To make the same
 * manifest work in Chrome and Safari we inline the four lib/* dependencies that
 * `background.src.js` would otherwise load with `importScripts()`.
 *
 * Output: web-extension/background.js  (the file referenced by manifest.json)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "web-extension");
const LIBS = ["browser.js", "providers.js", "sse.js", "prompts.js"].map((f) =>
  path.join(ROOT, "lib", f)
);
const SRC = path.join(ROOT, "background.src.js");
const OUT = path.join(ROOT, "background.js");

const banner =
  "/* GENERATED FILE — do not edit by hand.\n" +
  " * Produced by scripts/bundle-background.js. It inlines lib/{browser,providers,sse,prompts}.js\n" +
  " * because Safari's background content lacks importScripts().\n" +
  " * Edit background.src.js and the lib files instead, then re-run the bundler.\n" +
  " */\n";

const parts = [banner];
for (const f of LIBS) {
  parts.push(`\n/* ==== lib/${path.basename(f)} ==== */\n`);
  parts.push(fs.readFileSync(f, "utf8").replace(/\s*$/, "\n"));
}
parts.push(`\n/* ==== background.src.js ==== */\n`);
parts.push(fs.readFileSync(SRC, "utf8"));

fs.writeFileSync(OUT, parts.join(""));
console.log("Wrote " + OUT);
