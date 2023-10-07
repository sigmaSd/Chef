import { $ } from "https://deno.land/x/dax@0.35.0/mod.ts";
import { Chef, utils } from "./mod.ts";

const chef = new Chef();
chef.addMany(
  [
    {
      name: "rr",
      download: async ({ latestVersion }) => {
        await $.request(
          //https://github.com/rr-debugger/rr/releases/download/5.6.0/rr-5.6.0-Linux-x86_64.tar.gz
          `https://github.com/rr-debugger/rr/releases/download/${latestVersion}/rr-${latestVersion}-Linux-x86_64.tar.gz`,
        ).showProgress().pipeToPath();
        //rr-5.6.0-Linux-x86_64.tar.gz
        await $`tar -xzf rr-${latestVersion}-Linux-x86_64.tar.gz`;
        return { exe: `rr-${latestVersion}-Linux-x86_64/bin/rr` };
      },
      version: () => utils.getLatestGithubRelease("rr-debugger/rr"),
    },
    {
      name: "gleam",
      download: async ({ latestVersion }) => {
        await $.request(
          `https://github.com/gleam-lang/gleam/releases/download/${latestVersion}/gleam-${latestVersion}-x86_64-unknown-linux-musl.tar.gz`,
        ).showProgress().pipeToPath();
        await $`tar -xzf gleam-${latestVersion}-x86_64-unknown-linux-musl.tar.gz`;
        return { exe: "gleam" };
      },
      version: () => utils.getLatestGithubRelease("gleam-lang/gleam"),
    },
    {
      name: "imhex",
      download: async ({ latestVersion }) => {
        // remove v from version
        // v1.20.0 -> 1.20.0
        latestVersion = latestVersion.slice(1);

        await $.request(
          `https://github.com/WerWolv/ImHex/releases/download/v${latestVersion}/imhex-${latestVersion}-x86_64.AppImage`,
        ).showProgress().pipeToPath();

        //FIXME
        await $`chmod +x imhex-${latestVersion}-x86_64.AppImage`;
        return { exe: `imhex-${latestVersion}-x86_64.AppImage` };
      },
      version: () => utils.getLatestGithubRelease("WerWolv/ImHex"),
    },
    {
      name: "heimer",
      download: async ({ latestVersion }) => {
        //https://github.com/juzzlin/Heimer/releases/download/3.6.4/Heimer-3.6.4-x86_64.AppImage
        const archiveSuffix = (() => {
          switch (Deno.build.os) {
            case "linux":
              return "-ubuntu-22.04_amd64.deb";
          }
        })();
        const archiveName = `Heimer-${latestVersion}${archiveSuffix}`;

        await $.request(
          `https://github.com/juzzlin/Heimer/releases/download/${latestVersion}/${archiveName}`,
        ).showProgress().pipeToPath();
        switch (Deno.build.os) {
          case "linux":
            await $`ar x ${archiveName}`;
            await $`tar -xzf data.tar.gz`;
            return { exe: `./usr/bin/heimer` };
        }
        throw "Not implemented";
      },
      version: () => utils.getLatestGithubRelease("juzzlin/Heimer"),
    },
    {
      name: "codeFormat",
      download: async () => {
        await $.request(
          `https://github.com/CppCXY/EmmyLuaCodeStyle/releases/latest/download/linux-x64.tar.gz`,
        ).showProgress().pipeToPath();
        await $`tar -xzf linux-x64.tar.gz`;
        return { exe: "./linux-x64/bin/CodeFormat" };
      },
      version: () => utils.getLatestGithubRelease("CppCXY/EmmyLuaCodeStyle"),
    },
    {
      name: "irust",
      download: async ({ latestVersion }) => {
        //https://github.com/sigmaSd/IRust/releases/download/irust@1.71.4/irust-x86_64-unknown-linux-musl
        await $.request(
          `https://github.com/sigmaSd/IRust/releases/download/${latestVersion}/irust-x86_64-unknown-linux-musl`,
        ).showProgress().pipeToPath();
        await Deno.chmod(`./irust-x86_64-unknown-linux-musl`, 0o555);
        return {
          exe: `./irust-x86_64-unknown-linux-musl`,
        };
      },
      version: () => utils.getLatestGithubRelease("sigmaSd/IRust"),
    },
  ],
);

await chef.start();
