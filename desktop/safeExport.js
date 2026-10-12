"use strict";
/**
 * Where an exported file may be written. The renderer (web content) chooses `fileName`; the main process must never trust it.
 * Only a plain file name inside the downloads folder is accepted: no directories, no "..", no absolute paths, no drive letters,
 * no NUL bytes, no reserved device names. Pure function (no electron dependency) so it is unit-tested in backend/tests/node.
 */
const path = require("path");

const MAX_NAME = 150;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function resolveDownloadTarget(downloadsDir, fileName) {
  if (typeof fileName !== "string") throw new Error("INVALID_FILE_NAME");
  const name = fileName.trim();
  if (!name || name.length > MAX_NAME) throw new Error("INVALID_FILE_NAME");
  if (/[\u0000-\u001f<>:"/\\|?*]/.test(name)) throw new Error("INVALID_FILE_NAME"); // separators, drive colons, control chars
  if (name === "." || name === ".." || /^\.+$/.test(name) || /[. ]$/.test(name) || RESERVED.test(name)) throw new Error("INVALID_FILE_NAME");
  const base = path.resolve(downloadsDir);
  const target = path.resolve(base, name);
  if (path.dirname(target) !== base) throw new Error("INVALID_FILE_NAME");
  return target;
}

/**
 * Map a request URL onto a file inside `distDir`, or null when it would leave that directory. `GET /../../etc/passwd` sent by a
 * non-browser client (curl --path-as-is, another local process) would otherwise be joined straight onto the disk.
 */
function resolveStaticPath(distDir, rawUrl) {
  let p;
  try {
    p = decodeURIComponent(String(rawUrl).split("?")[0].split("#")[0]);
  } catch (_) {
    return null;
  }
  if (p.includes("\0") || !p.startsWith("/")) return null;
  if (p === "/") p = "/index.html";
  const base = path.resolve(distDir);
  const target = path.resolve(base, "." + p);
  return target === base || target.startsWith(base + path.sep) ? target : null;
}

module.exports = { resolveDownloadTarget, resolveStaticPath };
