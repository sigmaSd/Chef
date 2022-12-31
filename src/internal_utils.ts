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
