"use strict";
/**
 * Test-only: lets `require("x.ts")` work on Node versions without built-in type stripping (Node 20, which the production image uses).
 * Loaded with `node --require` by the test scripts in package.json. On Node versions that can strip types natively it does nothing.
 *
 * It uses the project's own `typescript` devDependency (installed by `npm ci`). Type errors are NOT checked here (that is what
 * `npx tsc --noEmit` does in CI); the file is only transpiled to CommonJS, the way type stripping would run it.
 */
const Module = require("module");
const fs = require("fs");

function nativeStripping() {
  // process.features.typescript is "strip" / "transform" / false on versions that have it.
  if (process.features && process.features.typescript) return true;
  try {
    // Node 22.6-22.17 need the flag; they list it in execArgv when it is on.
    return process.execArgv.some((a) => /experimental-strip-types|experimental-transform-types/.test(a)) && !process.execArgv.includes("--no-experimental-strip-types");
  } catch (_) {
    return false;
  }
}

let installed = false;
function install(force = false) {
  if (installed || (!force && nativeStripping())) return;
  let ts;
  try {
    ts = require("typescript");
  } catch (e) {
    throw new Error("registerTs: this Node version cannot run .ts files natively and the `typescript` package is not installed (run `npm ci`).");
  }
  const compile = (module, filename) => {
    const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }
    });
    module._compile(out.outputText, filename);
  };
  Module._extensions[".ts"] = compile;
  Module._extensions[".tsx"] = compile;
  installed = true;
}

install(false);
module.exports = { install };
