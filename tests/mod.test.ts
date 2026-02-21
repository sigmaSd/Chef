import * as path from "@std/path";
import { assertEquals } from "@std/assert";
import { expect } from "../src/utils.ts";
import { ChefInternal } from "../src/lib.ts";

class TestChef extends ChefInternal {
  // Override the base path for testing
  private testBasePath = path.join(Deno.makeTempDirSync(), "chef");

  override get binPath() {
    return path.join(this.testBasePath, this.getScriptName(), "bin");
  }

  override get iconsPath() {
    return path.join(this.testBasePath, this.getScriptName(), "icons");
  }

  override get dbPath() {
    return path.join(
      this.testBasePath,
      this.getScriptName(),
      "db.json",
    );
  }

  private getScriptName() {
    return this.chefPath
      ? path.basename(this.chefPath, path.extname(this.chefPath))
      : "default";
  }
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
        return { exe: "exe" };
      },
      version: () => Deno.readTextFile(versionPath),
    }]);

    // install hello exe
    await chef.start(["update"]);

    assertEquals(
      Deno.readTextFileSync(chef.dbPath),
      JSON.stringify({ hello: { version: "1.0.0" } }),
    );
    // doesn't throw because file exists
    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    Deno.readTextFileSync(path.join(chef.binPath, "hello" + exeExtension));

    // run hello exe
    await chef.start(["run", "hello"]);
    // assert it works
    assertEquals(
      Deno.readTextFileSync(path.join(dir, "hello")),
      "hello written",
    );

    // uninstall hello
    await chef.start(["uninstall", "hello"]);
    assertEquals(
      Deno.readTextFileSync(chef.dbPath),
      JSON.stringify({}),
    );
    // file should be gone
    try {
      Deno.statSync(path.join(chef.binPath, "hello" + exeExtension));
      throw new Error("File should have been deleted");
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }));

Deno.test("test chef extern", async () =>
  await withTempDir(async (dir: string) => {
    const chef = new TestChef();
    const mockExe = path.join(dir, "mock-extern.js");
    Deno.writeTextFileSync(
      mockExe,
      `Deno.writeTextFileSync("./extern-run", "extern run worked")`,
    );
    const externName = "extern-mock-cmd";

    // Create a wrapper script to act as the external command
    const wrapper = Deno.build.os === "windows"
      ? path.join(dir, `${externName}.bat`)
      : path.join(dir, externName);
    const content = Deno.build.os === "windows"
      ? `@echo off\ndeno run -A "${mockExe}"`
      : `#!/bin/sh\ndeno run -A "${mockExe}"`;
    Deno.writeTextFileSync(wrapper, content);
    if (Deno.build.os !== "windows") {
      Deno.chmodSync(wrapper, 0o755);
    }

    // Add dir to PATH so 'which' or 'commandExists' can find it
    const originalPath = Deno.env.get("PATH");
    Deno.env.set("PATH", `${dir}${path.DELIMITER}${originalPath}`);

    try {
      chef.addMany([{
        name: "extern-app",
        // deno-lint-ignore require-await
        download: async () => {
          return { extern: externName };
        },
        version: () => Promise.resolve("1.0.0"),
      }]);

      // install extern app
      await chef.start(["update"]);

      assertEquals(
        Deno.readTextFileSync(chef.dbPath),
        JSON.stringify({
          "extern-app": { version: "1.0.0", extern: externName },
        }),
      );

      // check if installed
      assertEquals(await chef.isInstalled("extern-app"), true);

      // run it (should execute the mock)
      await chef.start(["run", "extern-app"]);

      // assert it works
      assertEquals(
        Deno.readTextFileSync(path.join(dir, "extern-run")),
        "extern run worked",
      );

      // uninstall
      await chef.start(["uninstall", "extern-app"]);
      assertEquals(
        Deno.readTextFileSync(chef.dbPath),
        JSON.stringify({}),
      );
    } finally {
      Deno.env.set("PATH", originalPath ?? expect("PATH env var not set"));
    }
  }));
