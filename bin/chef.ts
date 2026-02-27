import { $, Chef } from "../mod.ts";
import * as utils from "../src/utils.ts";

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
      versions: (options) => utils.getGithubReleases("rr-debugger/rr", options),
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
      versions: (options) =>
        utils.getGithubReleases("gleam-lang/gleam", options),
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
      desktopFile: {
        comment: "Hex Editor",
        categories: "Development;",
        iconPath:
          "https://raw.githubusercontent.com/WerWolv/ImHex/master/resources/dist/common/logo/ImHexLogoSVGBG.svg",
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
            return { exe: "./usr/bin/heimer" };
        }
        throw new Error("Not implemented");
      },
      version: () => utils.getLatestGithubRelease("juzzlin/Heimer"),
      desktopFile: {
        comment: "Mind map editor",
        categories: "Office;",
      },
    },
    {
      name: "codeFormat",
      download: async () => {
        await $.request(
          "https://github.com/CppCXY/EmmyLuaCodeStyle/releases/latest/download/linux-x64.tar.gz",
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
          `https://github.com/sigmaSd/IRust/releases/download/${latestVersion}/irust-x86_64-unknown-linux-gnu`,
        ).showProgress().pipeToPath();
        await Deno.chmod("./irust-x86_64-unknown-linux-gnu", 0o555);
        return {
          exe: "./irust-x86_64-unknown-linux-gnu",
        };
      },
      versions: (options) => utils.getGithubReleases("sigmaSd/IRust", options),
      desktopFile: {
        name: "IRust",
        comment: "Rust REPL",
        categories: "Development;",
        iconPath:
          "https://raw.githubusercontent.com/sigmaSd/IRust/refs/heads/master/distro/io.github.sigmasd.IRust.svg",
        terminal: true,
      },
    },
    {
      name: "scrcpy",
      download: async ({ latestVersion }) => {
        await $.request(
          `https://github.com/Genymobile/scrcpy/releases/download/${latestVersion}/scrcpy-linux-x86_64-${latestVersion}.tar.gz`,
        ).showProgress().pipeToPath();
        await $`tar -xvf scrcpy-linux-x86_64-${latestVersion}.tar.gz`;
        return {
          dir: {
            path: `./scrcpy-linux-x86_64-${latestVersion}/`,
            exe: `./scrcpy`,
          },
        };
      },
      version: () => utils.getLatestGithubRelease("Genymobile/scrcpy"),
      desktopFile: {
        name: "SCRCPY",
        iconPath:
          "https://raw.githubusercontent.com/Genymobile/scrcpy/refs/heads/master/app/data/icon.svg",
      },
    },
    {
      name: "zaproxy",
      download: async ({ latestVersion }) => {
        await $.request(
          // slice to remove the v prefix
          // deno-fmt-ignore
          `https://github.com/zaproxy/zaproxy/releases/download/${latestVersion}/ZAP_${latestVersion.slice(1)}_Linux.tar.gz`,
        ).showProgress().pipeToPath();
        await $`tar -xvf ZAP_${latestVersion.slice(1)}_Linux.tar.gz`;
        return {
          dir: { path: `./ZAP_${latestVersion.slice(1)}/`, exe: "zap.sh" },
        };
      },
      version: () => utils.getLatestGithubRelease("zaproxy/zaproxy"),
      changeLog: ({ latestVersion }) =>
        // deno-fmt-ignore
        `https://www.zaproxy.org/docs/desktop/releases/${latestVersion.slice(1)}/`,
      desktopFile: {
        name: "ZAP",
        iconPath: "https://avatars.githubusercontent.com/u/6716868?s=200&v=4",
      },
    },
    {
      name: "tinymist",
      download: async ({ latestVersion }) => {
        await $.request(
          // https://github.com/Myriad-Dreamin/tinymist/releases/download/v0.13.16/tinymist-x86_64-unknown-linux-gnu.tar.gz
          `https://github.com/Myriad-Dreamin/tinymist/releases/download/${latestVersion}/tinymist-x86_64-unknown-linux-gnu.tar.gz`,
        ).showProgress().pipeToPath();
        await $`tar -xvf tinymist-x86_64-unknown-linux-gnu.tar.gz`;
        return {
          exe: "./tinymist-x86_64-unknown-linux-gnu/tinymist",
        };
      },
      version: () => utils.getLatestGithubRelease("Myriad-Dreamin/tinymist"),
      changeLog: () =>
        "https://github.com/Myriad-Dreamin/tinymist/blob/main/editors/vscode/CHANGELOG.md",
    },
    {
      name: "httptoolkit",
      download: async ({ latestVersion }) => {
        const version = latestVersion.slice(1);
        await $.request(
          `https://github.com/httptoolkit/httptoolkit-desktop/releases/download/${latestVersion}/HttpToolkit-${version}-x64.AppImage`,
        ).showProgress().pipeToPath();
        await $`chmod +x HttpToolkit-${version}-x64.AppImage`;
        return { exe: `HttpToolkit-${version}-x64.AppImage` };
      },
      version: () =>
        utils.getLatestGithubRelease("httptoolkit/httptoolkit-desktop"),
      desktopFile: {
        name: "HTTP Toolkit",
        comment: "HTTP debugging proxy",
        categories: "Development;",
        iconPath: "https://avatars.githubusercontent.com/u/39777515?s=48&v=4",
      },
    },
    {
      name: "codebook",
      download: async ({ latestVersion }) => {
        await $.request(
          `https://github.com/blopker/codebook/releases/download/${latestVersion}/codebook-lsp-x86_64-unknown-linux-musl.tar.gz`,
        ).showProgress().pipeToPath();
        await $`tar -xzf codebook-lsp-x86_64-unknown-linux-musl.tar.gz`;
        return { exe: "codebook-lsp" };
      },
      version: () => utils.getLatestGithubRelease("blopker/codebook"),
    },
    {
      name: "texlab",
      download: async ({ latestVersion }) => {
        await $.request(
          `https://github.com/latex-lsp/texlab/releases/download/${latestVersion}/texlab-x86_64-linux.tar.gz`,
        ).showProgress().pipeToPath();
        await $`tar -xzf texlab-x86_64-linux.tar.gz`;
        return { exe: "texlab" };
      },
      version: () => utils.getLatestGithubRelease("latex-lsp/texlab"),
    },
    {
      name: "ventoy",
      download: async ({ latestVersion }) => {
        const versionWithoutV = latestVersion.slice(1);
        const archiveName = `ventoy-${versionWithoutV}-linux.tar.gz`;
        await $.request(
          `https://github.com/ventoy/Ventoy/releases/download/${latestVersion}/${archiveName}`,
        ).showProgress().pipeToPath();
        await $`tar -xzf ${archiveName}`;
        await Deno.writeTextFile(
          `./ventoy-${versionWithoutV}/main`,
          `#!/usr/bin/env sh
          SCRIPT_DIR="$(dirname "$0")/ventoy-${versionWithoutV}"
          gnome-terminal -- pkexec sh -c "cd '$SCRIPT_DIR' && ./VentoyWeb.sh"`,
        );
        await Deno.chmod(`./ventoy-${versionWithoutV}/main`, 0o755);
        return {
          dir: {
            path: `./ventoy-${versionWithoutV}`,
            exe: `main`,
          },
        };
      },
      version: () => utils.getLatestGithubRelease("ventoy/Ventoy"),
      desktopFile: {
        name: "Ventoy",
        categories: "System;",
        iconPath: "https://www.ventoy.net/static/img/ventoy.png?v=1",
      },
    },
    {
      name: "Handy", // "H" so it doesn't get killed with kill -USR2 -n handy
      download: async ({ latestVersion }) => {
        const version = latestVersion.slice(1);
        await $.request(
          `https://github.com/cjpais/Handy/releases/download/${latestVersion}/Handy_${version}_amd64.AppImage`,
        ).showProgress().pipeToPath();
        await $`chmod +x Handy_${version}_amd64.AppImage`;
        return { exe: `Handy_${version}_amd64.AppImage` };
      },
      version: () => utils.getLatestGithubRelease("cjpais/Handy"),
      desktopFile: {
        name: "Handy",
        categories: "System;",
        iconPath:
          "https://raw.githubusercontent.com/cjpais/Handy/refs/heads/main/src-tauri/icons/icon.png",
      },
    },
    {
      name: "zellij",
      download: async ({ latestVersion }) => {
        const arch = Deno.build.arch === "x86_64" ? "x86_64" : "aarch64";
        const os = Deno.build.os === "linux"
          ? "unknown-linux-musl"
          : "apple-darwin";
        const archiveName = `zellij-${arch}-${os}.tar.gz`;
        await $.request(
          `https://github.com/zellij-org/zellij/releases/download/${latestVersion}/${archiveName}`,
        ).showProgress().pipeToPath();
        await $`tar -xzf ${archiveName}`;
        return { exe: "zellij" };
      },
      version: () => utils.getLatestGithubRelease("zellij-org/zellij"),
      versions: (options) =>
        utils.getGithubReleases("zellij-org/zellij", options),
      desktopFile: {
        name: "Zellij",
        comment: "A terminal workspace with batteries included",
        categories: "System;TerminalEmulator;",
        iconPath:
          "https://raw.githubusercontent.com/zellij-org/zellij/main/assets/logo.png",
        terminal: true,
      },
    },
  ],
);

await chef.start(import.meta.url);
