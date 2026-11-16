#!/usr/bin/env node
// Rewrites ASSETS and VERSION in sw.js from the files on disk. Run after any
// change to the app so installed copies pick up the update.
//
//   node tools/build_sw.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["index.html", "manifest.webmanifest", "models/catalog.json"];
const walk = (dir) => {
  for (const f of fs.readdirSync(path.join(repo, dir)).sort()) {
    const rel = path.posix.join(dir, f);
    const st = fs.statSync(path.join(repo, rel));
    if (st.isDirectory()) walk(rel);
    else if (/\.(js|css|svg|png)$/.test(f)) files.push(rel);
  }
};
for (const d of ["css", "js", "icons", "vendor/web-llm"]) walk(d);

const hash = crypto.createHash("sha256");
for (const f of files) hash.update(f).update(fs.readFileSync(path.join(repo, f)));
const version = hash.digest("hex").slice(0, 12);

const swPath = path.join(repo, "sw.js");
let sw = fs.readFileSync(swPath, "utf8");
sw = sw.replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`);
sw = sw.replace(/const ASSETS = \[[\s\S]*?\];/, `const ASSETS = [\n  "./",\n${files.map((f) => `  "${f}",`).join("\n")}\n];`);
fs.writeFileSync(swPath, sw);
console.log(`sw.js version ${version}, ${files.length + 1} assets`);
