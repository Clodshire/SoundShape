// Bundle the content script (TS → one IIFE JS file Chrome can load).
// Uses esbuild from the frontend's node_modules. Run:  node extension/build.mjs
import { build } from "../frontend/node_modules/esbuild/lib/main.js";

await build({
  entryPoints: ["extension/src/content.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: "extension/content.js",
  legalComments: "none",
});

console.log("Built extension/content.js");
