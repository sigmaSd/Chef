import { path } from "./deps.ts";

export async function runInTempDir<T>(fn: () => Promise<T>) {
  const currentDir = Deno.cwd();
  const tempDir = Deno.makeTempDirSync();
  Deno.chdir(tempDir);
  let ret;
  try {
    ret = await fn();
  } finally {
    Deno.chdir(currentDir);
    await Deno.remove(tempDir, { recursive: true });
  }
  return ret;
}

export class Colors {
  static lightGreen = "#00ff00";
  static lightRed = "#ff0000";
  static lightYellow = "#ffff00";
  static blueMarine = "#00b0f0";
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
