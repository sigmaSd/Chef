#!/usr/bin/env -S deno -A
import { $ } from "@david/dax";
$.setPrintCommand(true);

// 1. Safety check: Error out if there are uncommitted changes
const status = await $`git -C ../gtk status --porcelain`.text();
if (status.trim().length > 0) {
  console.error(
    "Error: ../gtk has uncommitted changes. Stash or commit them first.",
  );
  Deno.exit(1);
}

// 2. Copy contents from any version folder found in vendor
// This matches vendor/jsr.io/@sigmasd/gtk/<ANY_VERSION>/*
// TODO actually use dax
await $`fish -c "cp -r vendor/jsr.io/@sigmasd/gtk/*/* ../gtk"`;

// 3. Enter directory and cleanup specific file
Deno.chdir("../gtk");
await $`rm -f src/low/paths/\#findlib_80c0d.ts`;

// 4. Use sed to replace the versioned JSR import with the simple one
// Using -i for in-place editing across all files found by find
console.log("Reverting JSR imports to local style...");
await $`find . -type f -name "*.ts" -print0 | xargs -0 sed -i 's|import "jsr:@sigma/deno-compat@[0-9.]*";|import "@sigma/deno-compat";|g'`;

console.log("Done! Running test");
await $`deno fmt && deno task test`;
