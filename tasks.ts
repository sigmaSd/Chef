import $ from "@david/dax";
import { expandGlob } from "@std/fs";
import { parse } from "@std/path";

async function genUi() {
  const uiDir = $.path("src/ui");
  const genDir = uiDir.join("gen");
  await genDir.mkdir({ recursive: true });

  console.log("Generating UI files...");
  for await (const entry of expandGlob("src/ui/*.blp")) {
    const file = $.path(entry.path);
    const stem = parse(file.toString()).name;
    const out = genDir.join(stem + ".ui");
    console.log(`  ${file.basename()} -> gen/${out.basename()}`);
    await $`blueprint-compiler compile ${file} --output ${out}`;
  }
}

const tasks: Record<string, () => Promise<void>> = {
  "gen-ui": genUi,
};

if (import.meta.main) {
  const taskName = Deno.args[0];

  if (taskName in tasks) {
    await tasks[taskName]();
  } else {
    console.log(`Available tasks: ${Object.keys(tasks).join(", ")}`);
    Deno.exit(1);
  }
}
