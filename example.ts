import { $ } from "https://deno.land/x/dax@0.17.0/mod.ts";
import { Chef, utils } from "./mod.ts";

const chef = new Chef();
chef.addMany(
  [
    {
      name: "codeFormat",
      download: async () => {
        await $`wget https://github.com/CppCXY/EmmyLuaCodeStyle/releases/latest/download/linux-x64.tar.gz`;
        await $`tar -xzf linux-x64.tar.gz`;
        return "./linux-x64/bin/CodeFormat";
      },
      version: () => utils.getLatestGithubRelease("CppCXY/EmmyLuaCodeStyle"),
    },
    {
      name: "irust",
      download: async ({ latestVersion }) => {
        await $`wget https://github.com/sigmaSd/IRust/releases/download/${latestVersion}/irust-${latestVersion}-x86_64-unknown-linux-musl.tar.gz`;
        await $`tar -xzf irust-${latestVersion}-x86_64-unknown-linux-musl.tar.gz`;
        return `./irust-${latestVersion}-x86_64-unknown-linux-musl/irust`;
      },
      version: () => utils.getLatestGithubRelease("sigmaSd/IRust"),
    },
    {
      name: "cargo-llvm-cov",
      download: async ({ latestVersion }) => {
        //cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz
        await $`wget https://github.com/taiki-e/cargo-llvm-cov/releases/download/${latestVersion}/cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz`;
        await $`tar -xzf cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz`;
        return `./cargo-llvm-cov`;
      },
      version: () => utils.getLatestGithubRelease("taiki-e/cargo-llvm-cov"),
      cmdPreDefinedArgs: ["llvm-cov"],
    },
  ],
);

await chef.run();
