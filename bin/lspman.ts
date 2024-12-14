import { $ } from "jsr:@david/dax@0.39.2";
import { Chef } from "../mod.ts";
import { getLatestGithubRelease, getLatestNpmVersion } from "../src/utils.ts";

if (import.meta.main) {
  const chef = new Chef();
  chef.addMany(
    [
      {
        name: "slint-lsp",
        download: async () => {
          await $.request(
            "https://github.com/slint-ui/slint/releases/download/v1.5.1/slint-lsp-linux.tar.gz",
          ).pipeToPath();
          await $`tar -xzf slint-lsp-linux.tar.gz`;
          return {
            exe: "./slint-lsp/slint-lsp",
          };
        },
        version: () => getLatestGithubRelease("slint-ui/slint"),
      },
      {
        name: "typescript-language-server",
        download: async () => {
          await $`npm install typescript-language-server`;
          return {
            dir: {
              path: ".",
              exe: "./node_modules/typescript-language-server/lib/cli.mjs",
            },
          };
        },
        version: () => getLatestNpmVersion("typescript-language-server"),
      },
      {
        name: "svelte-language-server",
        download: async () => {
          await $`npm install typescript-language-server`;
          return {
            dir: {
              path: ".",
              exe: "./node_modules/svelte-language-server/bin/server.js",
            },
          };
        },
        version: () => getLatestNpmVersion("svelte-language-server"),
      },
    ],
  );

  await chef.start();
}
