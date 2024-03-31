import * as path from "@std/path";

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
    const newFrom = rustJoin(from, entry.name);
    const newTo = rustJoin(to, entry.name);
    if (entry.isDirectory) {
      await copyDirRecursively(newFrom, newTo);
    } else if (entry.isFile) {
      await Deno.copyFile(newFrom, newTo);
    }
  }
}
function rustJoin(path1: string, path2: string) {
  const maybeCommon = path.common([path1, path2]);
  if (!maybeCommon) return path.join(path1, path2);

  return path.join(
    maybeCommon,
    path1.replace(maybeCommon, ""),
    path2.replace(maybeCommon, ""),
  );
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
