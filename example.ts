import { $ } from "https://deno.land/x/dax@0.24.1/mod.ts";
import { Chef, utils } from "./mod.ts";

const chef = new Chef();
chef.addMany(
  [
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
        await $`chmod +x imhex-${latestVersion}.AppImage`;
        return { exe: `imhex-${latestVersion}.AppImage` };
      },
      version: () => utils.getLatestGithubRelease("WerWolv/ImHex"),
    },
    {
      name: "godot4",
      version: async () => {
        const url = await fetch(
          "https://downloads.tuxfamily.org/godotengine/4.0/",
        ).then((r) => r.text());

        const beta =
          [...url.matchAll(/beta\d+/g)].sort((a, b) =>
            Number(a[0].split("beta")[1]) - Number(b[0].split("beta")[1])
          ).at(-1)![0];

        return `v4.0-${beta}_mono`;
      },
      download: async ({ latestVersion }) => {
        const versionPath = latestVersion
          .slice(1)
          .replace("-", "/")
          .replace(
            "_",
            "/",
          );
        await $.request(
          `https://downloads.tuxfamily.org/godotengine/${versionPath}/Godot_${latestVersion}_linux_x86_64.zip`,
        ).showProgress().pipeToPath();
        await $`unzip Godot_${latestVersion}_linux_x86_64`;

        return {
          dir: `./Godot_${latestVersion}_linux_x86_64/`,
          exe:
            `./Godot_${latestVersion}_linux_x86_64/Godot_${latestVersion}_linux.x86_64`,
        };
      },
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
        await $.request(
          `https://github.com/sigmaSd/IRust/releases/download/${latestVersion}/irust-${latestVersion}-x86_64-unknown-linux-musl.tar.gz`,
        ).showProgress().pipeToPath();
        await $`tar -xzf irust-${latestVersion}-x86_64-unknown-linux-musl.tar.gz`;
        return {
          exe: `./irust-${latestVersion}-x86_64-unknown-linux-musl/irust`,
        };
      },
      version: () => utils.getLatestGithubRelease("sigmaSd/IRust"),
    },
    {
      name: "cargo-llvm-cov",
      download: async ({ latestVersion }) => {
        //cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz
        await $.request(
          `https://github.com/taiki-e/cargo-llvm-cov/releases/download/${latestVersion}/cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz`,
        ).showProgress().pipeToPath();
        await $`tar -xzf cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz`;
        return { exe: `./cargo-llvm-cov` };
      },
      version: () => utils.getLatestGithubRelease("taiki-e/cargo-llvm-cov"),
      cmdArgs: ["llvm-cov"],
    },
  ],
);

await chef.start();
