import { $ } from "https://deno.land/x/dax@0.17.0/mod.ts";
import { Chef, utils } from "./mod.ts";

const chef = new Chef();
chef.addMany(
  [
    {
      name: "heimer",
      download: async ({ latestVersion }) => {
        //https://github.com/juzzlin/Heimer/releases/download/3.6.4/Heimer-3.6.4-x86_64.AppImage
        const archiveSuffix = (() => {
          switch (Deno.build.os) {
            case "linux":
              return "-x86_64.AppImage";
          }
        })();
        const archiveName = `Heimer-${latestVersion}${archiveSuffix}`;

        await $`wget https://github.com/juzzlin/Heimer/releases/download/${latestVersion}/${archiveName}`;
        switch (Deno.build.os) {
          case "linux":
            await $`chmod +x ${archiveName}`; //AppImage
            await $`mv ${archiveName} heimer`;
            return `heimer`;
        }
        throw "Not implemented";
      },
      cmdEnv: { "QT_QPA_PLATFORM": "" },
      version: () => utils.getLatestGithubRelease("juzzlin/Heimer"),
    },
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
      cmdArgs: ["llvm-cov"],
    },
  ],
);

await chef.run();
