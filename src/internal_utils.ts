import * as infer from "@sigmasd/infer";
import * as path from "@std/path";
import { expect } from "./utils.ts";

export function getChefBasePath() {
  return path.join(
    cacheDir() ?? expect("cache dir not found"),
    "chef",
  );
}

export function getVersionFromUrl(text: string): string | undefined {
  const match = text.match(/@sigmasd\/chef[@/]([0-9]+\.[0-9]+\.[0-9]+[^"'/]*)/);
  return match ? match[1] : undefined;
}

export async function ensureDefaultChefFile(
  libUrl: string,
  utilsUrl: string,
): Promise<string> {
  const basePath = getChefBasePath();
  const isLocal = libUrl.startsWith("file://");
  const scriptName = isLocal ? "cheflocaldefault" : "chefjsrdefault";
  const scriptDir = path.join(basePath, scriptName);
  const defaultChefPath = path.join(scriptDir, `${scriptName}.ts`);

  try {
    await Deno.stat(defaultChefPath);
    if (!isLocal) {
      const content = await Deno.readTextFile(defaultChefPath);
      const fileVersion = getVersionFromUrl(content);
      const runningVersion = getVersionFromUrl(libUrl);

      if (fileVersion && runningVersion) {
        const semver = await import("@std/semver");
        if (
          semver.greaterThan(
            semver.parse(runningVersion),
            semver.parse(fileVersion),
          )
        ) {
          const newContent = content.replaceAll(
            `@sigmasd/chef@${fileVersion}`,
            `@sigmasd/chef@${runningVersion}`,
          );
          if (newContent !== content) {
            await Deno.writeTextFile(defaultChefPath, newContent);
            const { statusMessage } = await import("./ui.ts");
            statusMessage(
              "update",
              `Updated ${scriptName}.ts from version ${fileVersion} to ${runningVersion}`,
            );
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      const template = `
import { Chef, $ } from "${libUrl}";
import { getLatestGithubRelease } from "${utilsUrl}";

const chef = new Chef();

chef.add({
  name: "irust",
  download: async ({ latestVersion }) => {
    await $.request(
      \`https://github.com/sigmaSd/IRust/releases/download/\${latestVersion}/irust-x86_64-unknown-linux-gnu\`,
    ).showProgress().pipeToPath();
    await Deno.chmod("./irust-x86_64-unknown-linux-gnu", 0o555);
    return {
      exe: "./irust-x86_64-unknown-linux-gnu",
    };
  },
  version: () => getLatestGithubRelease("sigmaSd/IRust"),
});

await chef.start(import.meta.url);
`.trim();
      await Deno.mkdir(scriptDir, { recursive: true });
      await Deno.writeTextFile(defaultChefPath, template);
    } else {
      throw err;
    }
  }
  return defaultChefPath;
}

export async function runInTempDir<T>(fn: () => Promise<T>) {
  const currentDir = Deno.cwd();
  const tempDir = Deno.makeTempDirSync();
  Deno.chdir(tempDir);
  let ret: T;
  try {
    ret = await fn();
  } finally {
    Deno.chdir(currentDir);
    await Deno.remove(tempDir, { recursive: true });
  }
  return ret;
}

// deno-lint-ignore no-namespace
export namespace Colors {
  export const lightGreen = "#00ff00";
  export const lightRed = "#ff0000";
  export const lightYellow = "#ffff00";
  export const blueMarine = "#00b0f0";
}

export async function copyDirRecursively(from: string, to: string) {
  await Deno.mkdir(to, { recursive: true });
  const readDir = Deno.readDir(from);
  for await (const entry of readDir) {
    const newFrom = path.join(from, entry.name);
    const newTo = path.join(to, entry.name);
    if (entry.isDirectory) {
      await copyDirRecursively(newFrom, newTo);
    } else if (entry.isFile) {
      await Deno.copyFile(newFrom, newTo);
    }
  }
}

//https://deno.land/x/dir@1.5.2/cache_dir/mod.ts
export function cacheDir(): string | null {
  switch (Deno.build.os) {
    case "linux": {
      const xdg = Deno.env.get("XDG_CACHE_HOME");
      if (xdg) return xdg;
      const home = Deno.env.get("HOME");
      if (home) return `${home}/.cache`;
      break;
    }
    case "darwin": {
      const home = Deno.env.get("HOME");
      if (home) return `${home}/Library/Caches`;
      break;
    }
    case "windows":
      return Deno.env.get("LOCALAPPDATA") ?? null;
  }
  return null;
}

export async function getExt(iconPath: string) {
  const name = path.extname(iconPath);
  if (name) return name;

  const data = await fetch(iconPath);
  const header = await data.body?.getReader().read().then((d) => d.value);
  if (header) {
    const ext = infer.get(header)?.extension();
    if (ext) {
      return `.${ext}`;
    }
  }
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const process = new Deno.Command("which", {
      args: [cmd],
      stdout: "null",
      stderr: "null",
    });
    const { success } = await process.output();
    return success;
  } catch {
    return false;
  }
}
