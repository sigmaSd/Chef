import { assertEquals } from "https://deno.land/std@0.170.0/testing/asserts.ts";
import { path } from "./src/deps.ts";
import { ChefInternal } from "./src/lib.ts";

class TestChef extends ChefInternal {
  override Path = path.join(Deno.makeTempDirSync(), "chef");
}

async function withTempDir(f: (dir: string) => Promise<void> | void) {
  const originalPath = Deno.cwd();
  const dir = Deno.makeTempDirSync();
  Deno.chdir(dir);
  try {
    await f(dir);
  } finally {
    Deno.chdir(originalPath);
    Deno.removeSync(dir, { recursive: true });
  }
}
Deno.test("test chef1", async () =>
  await withTempDir(async (dir: string) => {
    const version = "1.0.0";
    const exeCodePath = path.join(dir, `exe-${version}.js`);
    Deno.writeTextFileSync(
      exeCodePath,
      `Deno.writeTextFileSync("./hello", "hello written")`,
    );
    await new Deno.Command("deno", {
      args: ["compile", "--no-check", "--allow-write=.", exeCodePath],
    }).spawn()
      .status;
    const exePath = Deno.build.os === "windows"
      ? (exeCodePath.replace(".js", ".exe"))
      : exeCodePath.replace(".js", "");

    const versionPath = path.join(dir, "version");
    Deno.writeTextFileSync(versionPath, version);

    const chef = new TestChef();

    chef.addMany([{
      name: "hello",
      download: async ({ latestVersion }) => {
        const exe = `exe-${latestVersion}`;
        await Deno.copyFile(exePath, exe);
        await Deno.rename(exe, "exe");
        return "exe";
      },
      version: () => Deno.readTextFile(versionPath),
    }]);

    // install hello exe
    await chef.run([]);

    assertEquals(
      Deno.readTextFileSync(chef.dbPath),
      JSON.stringify({ "hello": "1.0.0" }),
    );
    // doesn't throw because file exists
    Deno.readTextFileSync(path.join(chef.BinPath, "hello"));

    // run hello exe
    await chef.run(["run", "hello"]);
    // assert it wroks
    assertEquals(
      Deno.readTextFileSync(path.join(dir, "hello")),
      "hello written",
    );
  }));

Deno.test("test edit", () => {
  const chef = new TestChef();
  const expected = Deno.build.os === "windows"
    ? `file:///${Deno.cwd().replaceAll("\\", "/")}/mod.test.ts`
    : `file://${Deno.cwd()}/mod.test.ts`;
  assertEquals(chef.edit(), expected);
});
