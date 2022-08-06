export function runInTempDir<T>(fn: () => T) {
  const currentDir = Deno.cwd();
  const tempDir = Deno.makeTempDirSync();
  Deno.chdir(tempDir);
  const ret = fn();
  Deno.chdir(currentDir);
  return ret;
}
