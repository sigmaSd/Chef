import { assertEquals } from "https://deno.land/std@0.170.0/testing/asserts.ts";
import { path } from "./src/deps.ts";
import { ChefInternal } from "./src/lib.ts";

class TestChef extends ChefInternal {
  override Path = path.join(Deno.makeTempDirSync(), "chef");
}

Deno.test("test chef1", async () => {
  const dir = Deno.makeTempDirSync();
  const version = "1.0.0";
  const exePath = path.join(dir, `exe-${version}`);
  const versionPath = path.join(dir, "version");
  Deno.createSync(exePath).close();
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

  await chef.run();

  assertEquals(
    Deno.readTextFileSync(chef.dbPath),
    JSON.stringify({ "hello": "1.0.0" }),
  );
  // doesn't throw because file exists
  Deno.readTextFileSync(path.join(chef.BinPath, "hello"));
});

Deno.test("test edit", () => {
  const chef = new TestChef();
  assertEquals(chef.edit(), `file://${Deno.cwd()}/mod.test.ts`);
});
