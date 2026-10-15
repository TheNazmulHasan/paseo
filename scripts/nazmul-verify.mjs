#!/usr/bin/env node
/**
 * Runs the proof commands for every mod in docs/nazmul-mods.md (Nazmul's queue on top of
 * Riajul's fork). Same format and parser as scripts/fork-verify.mjs: `## <id>` heading, then
 * the first ```bash block, one command per line.
 *
 *   node scripts/nazmul-verify.mjs            every check (needs a built app for bundle lines)
 *   node scripts/nazmul-verify.mjs --source   skip the built-app checks
 *   node scripts/nazmul-verify.mjs <id> ...   only these mods;  --list prints the ids
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDecisions } from "./fork-verify.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mods = parseDecisions(readFileSync(join(repoRoot, "docs", "nazmul-mods.md"), "utf8"));
const args = process.argv.slice(2);

if (args.includes("--list")) {
  for (const m of mods) console.log(m.id);
  process.exit(0);
}

const sourceOnly = args.includes("--source");
const wanted = args.filter((a) => !a.startsWith("-"));
const selected = wanted.length ? mods.filter((m) => wanted.includes(m.id)) : mods;
const failed = [];

for (const [i, m] of selected.entries()) {
  const commands = m.commands.filter((c) => !(sourceOnly && c.includes("nazmul-bundle-has")));
  process.stdout.write(`run  ${i + 1}/${selected.length} ${m.id} ... `);
  if (commands.length === 0) {
    console.log("NO PROOF");
    failed.push({ id: m.id, command: "(no proof command)" });
    continue;
  }
  const failing = commands.find(
    (cmd) => spawnSync(cmd, { cwd: repoRoot, shell: true, stdio: "pipe" }).status !== 0,
  );
  if (failing === undefined) {
    console.log("ok");
  } else {
    console.log("FAIL");
    failed.push({ id: m.id, command: failing });
  }
}

console.log();
if (failed.length === 0) {
  console.log(
    `nazmul-verify: ${selected.length} mod(s) verified${sourceOnly ? " (source only)" : ""}`,
  );
  process.exit(0);
}
console.error(`nazmul-verify: ${failed.length} mod(s) FAILED`);
for (const f of failed) console.error(`  ${f.id}\n    ${f.command}`);
console.error(
  "\nA failure is a mod that no longer works: either upstream/Riajul absorbed it (drop its card" +
    "\nand section) or the rebase broke it (fix the card). Never ship with a FAIL.",
);
process.exit(1);
