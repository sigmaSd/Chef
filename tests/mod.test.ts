import * as path from "@std/path";
import { assert, assertEquals } from "@std/assert";
import type { App } from "../mod.ts";
import { expect } from "../src/utils.ts";
import { ChefInternal } from "../src/lib.ts";
import { DesktopFileManager } from "../src/desktop.ts";
import { ChefDatabase } from "../src/database.ts";
import type { Recipe } from "../mod.ts";

import { ChefPaths } from "../src/paths.ts";

class TestChef extends ChefInternal {
  // Override the base path for testing
  private testBasePath = path.join(Deno.makeTempDirSync(), "chef");

  private getScriptName() {
    return this.chefPath
      ? path.basename(this.chefPath, path.extname(this.chefPath))
      : "default";
  }

  async testInit() {
    const paths = new ChefPaths(
      this.getScriptName(),
      this.testBasePath,
    );
    await this.init({ paths });
  }

  override get binPath() {
    return this.paths.binPath;
  }

  override get iconsPath() {
    return this.paths.iconsPath;
  }

  override get dbPath() {
    return this.paths.dbPath;
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
    await chef.testInit();
    await chef.start(["update"]);

    assertEquals(
      Deno.readTextFileSync(chef.dbPath),
      JSON.stringify({ hello: { version: "1.0.0" } }),
    );
    // doesn't throw because file exists
    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    Deno.readTextFileSync(path.join(chef.binPath, "hello" + exeExtension));

    // run hello exe
    await chef.testInit();
    await chef.start(["run", "hello"]);
    // assert it works
    assertEquals(
      Deno.readTextFileSync(path.join(dir, "hello")),
      "hello written",
    );

    // uninstall hello
    await chef.testInit();
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
      await chef.testInit();
      await chef.start(["update"]);

      assertEquals(
        Deno.readTextFileSync(chef.dbPath),
        JSON.stringify({
          "extern-app": { version: "1.0.0", extern: externName },
        }),
      );

      // check if installed
      assertEquals(chef.isInstalled("extern-app"), true);

      // run it (should execute the mock)
      await chef.testInit();
      await chef.start(["run", "extern-app"]);

      // assert it works
      assertEquals(
        Deno.readTextFileSync(path.join(dir, "extern-run")),
        "extern run worked",
      );

      // uninstall
      await chef.testInit();
      await chef.start(["uninstall", "extern-app"]);
      assertEquals(
        Deno.readTextFileSync(chef.dbPath),
        JSON.stringify({}),
      );
    } finally {
      Deno.env.set("PATH", originalPath ?? expect("PATH env var not set"));
    }
  }));

Deno.test("changelog - app not found", async () =>
  await withTempDir(async () => {
    const chef = new TestChef();
    chef.add({
      name: "test-app",
      download: () => Promise.resolve({ exe: "test" } as App),
      version: () => Promise.resolve("v1.0.0"),
    });

    await chef.testInit();

    // Capture console.error output
    let errorMsg = "";
    const originalError = console.error;
    console.error = (msg) => {
      errorMsg += msg;
    };

    await chef.start(["changelog", "nonexistent"]);

    console.error = originalError;

    assertEquals(errorMsg.includes("not found"), true);
  }));

Deno.test("changelog - non-GitHub without explicit URL", async () =>
  await withTempDir(async () => {
    const chef = new TestChef();
    chef.add({
      name: "test-no-repo",
      download: () => Promise.resolve({ exe: "test" } as App),
      version: () => Promise.resolve("v1.0.0"),
    });

    await chef.testInit();

    let errorMsg = "";
    const originalError = console.error;
    console.error = (msg) => {
      errorMsg += msg;
    };

    await chef.start(["changelog", "test-no-repo"]);

    console.error = originalError;

    assertEquals(errorMsg.includes("Auto-search is only supported"), true);
  }));

Deno.test("desktop id - install and uninstall with system icon", async () =>
  await withTempDir(async (dir: string) => {
    if (Deno.build.os !== "linux") return;

    const fakeHome = path.join(dir, "fake-home");
    Deno.mkdirSync(path.join(fakeHome, ".local/share/applications"), {
      recursive: true,
    });
    Deno.mkdirSync(
      path.join(fakeHome, ".local/share/icons/hicolor/scalable/apps"),
      { recursive: true },
    );
    Deno.mkdirSync(
      path.join(fakeHome, ".local/share/icons/hicolor/512x512/apps"),
      { recursive: true },
    );
    const originalHome = Deno.env.get("HOME");
    Deno.env.set("HOME", fakeHome);

    try {
      const svgIconPath = path.join(dir, "test-icon.svg");
      const svgContent =
        `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect fill="red" width="512" height="512"/></svg>`;
      Deno.writeTextFileSync(svgIconPath, svgContent);

      const desktopId = "dev.test.TestApp";
      const internalIconsPath = path.join(dir, "icons");
      const dbPath = path.join(dir, "db.json");

      const recipes: Recipe[] = [{
        name: "testapp",
        download: () => Promise.resolve({ exe: "test" } as App),
        version: () => Promise.resolve("1.0.0"),
        desktopFile: {
          name: "Test App",
          iconPath: `file://${svgIconPath}`,
          id: desktopId,
        },
      }];

      const db = new ChefDatabase(dbPath, recipes);
      db.setEntry("testapp", { version: "1.0.0", desktopId });

      const desktopManager = new DesktopFileManager(
        internalIconsPath,
        "file:///fake/chef.ts",
        recipes,
        "io.github.sigmasd.chef.test",
        "test",
        db,
      );

      await desktopManager.create("testapp", {});

      // Verify icon was installed to system location
      const systemIconPath = path.join(
        fakeHome,
        `.local/share/icons/hicolor/scalable/apps/${desktopId}.svg`,
      );
      try {
        Deno.statSync(systemIconPath);
      } catch {
        assert(false, `System icon not found at ${systemIconPath}`);
      }

      // Verify desktop file uses desktopId as filename
      const desktopPath = path.join(
        fakeHome,
        `.local/share/applications/${desktopId}.desktop`,
      );
      try {
        Deno.statSync(desktopPath);
      } catch {
        assert(false, `Desktop file not found at ${desktopPath}`);
      }

      // Verify desktop file uses iconId (not full path)
      const desktopContent = Deno.readTextFileSync(desktopPath);
      assert(
        desktopContent.includes(`Icon=${desktopId}`),
        `Desktop file should contain Icon=${desktopId}`,
      );

      // Uninstall
      desktopManager.remove("testapp", { silent: true });

      // Verify icon was removed
      try {
        Deno.statSync(systemIconPath);
        assert(false, "System icon should have been removed after uninstall");
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }

      // Verify desktop file was removed
      try {
        Deno.statSync(desktopPath);
        assert(false, "Desktop file should have been removed after uninstall");
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
    } finally {
      if (originalHome !== undefined) {
        Deno.env.set("HOME", originalHome);
      } else {
        Deno.env.delete("HOME");
      }
    }
  }));

Deno.test("desktop id - desktop file renamed without iconPath", async () =>
  await withTempDir(async (dir: string) => {
    if (Deno.build.os !== "linux") return;

    const fakeHome = path.join(dir, "fake-home");
    Deno.mkdirSync(path.join(fakeHome, ".local/share/applications"), {
      recursive: true,
    });
    const originalHome = Deno.env.get("HOME");
    Deno.env.set("HOME", fakeHome);

    try {
      const desktopId = "com.example.MyApp";
      const dbPath = path.join(dir, "db.json");

      const recipes: Recipe[] = [{
        name: "myapp",
        download: () => Promise.resolve({ exe: "test" } as App),
        version: () => Promise.resolve("1.0.0"),
        desktopFile: {
          name: "My App",
          id: desktopId,
        },
      }];

      const db = new ChefDatabase(dbPath, recipes);
      db.setEntry("myapp", { version: "1.0.0", desktopId });

      const desktopManager = new DesktopFileManager(
        path.join(dir, "icons"),
        "file:///fake/chef.ts",
        recipes,
        "io.github.sigmasd.chef.test",
        "test",
        db,
      );

      await desktopManager.create("myapp", {});

      const desktopPath = path.join(
        fakeHome,
        `.local/share/applications/${desktopId}.desktop`,
      );
      try {
        Deno.statSync(desktopPath);
      } catch {
        assert(false, `Desktop file not found at ${desktopPath}`);
      }

      desktopManager.remove("myapp", { silent: true });

      try {
        Deno.statSync(desktopPath);
        assert(false, "Desktop file should have been removed");
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
    } finally {
      if (originalHome !== undefined) {
        Deno.env.set("HOME", originalHome);
      } else {
        Deno.env.delete("HOME");
      }
    }
  }));

Deno.test("desktop env - env vars are prepended to Exec line", async () =>
  await withTempDir(async (dir: string) => {
    if (Deno.build.os !== "linux") return;

    const fakeHome = path.join(dir, "fake-home");
    Deno.mkdirSync(path.join(fakeHome, ".local/share/applications"), {
      recursive: true,
    });
    const originalHome = Deno.env.get("HOME");
    Deno.env.set("HOME", fakeHome);

    try {
      const recipes: Recipe[] = [{
        name: "envapp",
        download: () => Promise.resolve({ exe: "test" } as App),
        version: () => Promise.resolve("1.0.0"),
        desktopFile: {
          name: "Env App",
          env: {
            MY_VAR: "hello",
            ANOTHER: "123",
          },
        },
      }];

      const dbPath = path.join(dir, "db.json");
      const db = new ChefDatabase(dbPath, recipes);
      db.setEntry("envapp", { version: "1.0.0" });

      const desktopManager = new DesktopFileManager(
        path.join(dir, "icons"),
        "file:///fake/chef.ts",
        recipes,
        "io.github.sigmasd.chef.test",
        "test",
        db,
      );

      await desktopManager.create("envapp", {});

      const desktopPath = path.join(
        fakeHome,
        `.local/share/applications/envapp.desktop`,
      );
      const content = Deno.readTextFileSync(desktopPath);

      assert(
        content.includes("Exec=env MY_VAR=hello ANOTHER=123 deno run"),
        `Desktop file should contain env vars in Exec line, got:\n${content}`,
      );

      desktopManager.remove("envapp", { silent: true });
    } finally {
      if (originalHome !== undefined) {
        Deno.env.set("HOME", originalHome);
      } else {
        Deno.env.delete("HOME");
      }
    }
  }));

Deno.test("versionCommand - populates _currentVersion and affects isInstalled/getVersion/checkUpdate", async () =>
  await withTempDir(async () => {
    const chef = new TestChef();

    chef.addMany([{
      name: "detect-app",
      download: () => Promise.resolve({ exe: "test" }),
      version: () => Promise.resolve("2.0.0"),
      versionCommand: () => Promise.resolve("1.5.0"),
    }]);

    await chef.testInit();

    const recipe = chef.recipes.find((r) => r.name === "detect-app")!;
    assertEquals(recipe._currentVersion, undefined);

    await chef.refreshRecipes();

    assertEquals(recipe._currentVersion, "1.5.0");
    assertEquals(chef.isInstalled("detect-app"), true);
    assertEquals(chef.getVersion("detect-app"), "1.5.0");

    const updateInfo = await chef.checkUpdate("detect-app");
    assertEquals(updateInfo.currentVersion, "1.5.0");
    assertEquals(updateInfo.latestVersion, "2.0.0");
    assertEquals(updateInfo.needsUpdate, true);
  }));

Deno.test("versionCommand - failure leaves _currentVersion undefined", async () =>
  await withTempDir(async () => {
    const chef = new TestChef();

    chef.addMany([{
      name: "failing-app",
      download: () => Promise.resolve({ exe: "test" } as App),
      version: () => Promise.resolve("1.0.0"),
      versionCommand: () => Promise.reject(new Error("not found")),
    }]);

    await chef.testInit();
    await chef.refreshRecipes();

    const recipe = chef.recipes.find((r) => r.name === "failing-app")!;
    assertEquals(recipe._currentVersion, undefined);
    assertEquals(chef.isInstalled("failing-app"), false);
    assertEquals(chef.getVersion("failing-app"), undefined);
  }));

Deno.test("versionCommand - takes priority over database version in checkUpdate", async () =>
  await withTempDir(async (dir: string) => {
    const detectedVersionPath = path.join(dir, "detected-version");
    Deno.writeTextFileSync(detectedVersionPath, "2.0.0");

    const chef = new TestChef();
    chef.addMany([{
      name: "detect-app",
      download: () => Promise.resolve({ exe: "test" } as App),
      version: () => Promise.resolve("2.0.0"),
      versionCommand: () => Deno.readTextFile(detectedVersionPath),
    }]);

    await chef.testInit();

    // Write DB entry manually to simulate install
    chef.database.setEntry("detect-app", { version: "2.0.0" });
    assertEquals(chef.database.getVersion("detect-app"), "2.0.0");

    // Refresh runs versionCommand
    await chef.refreshRecipes();
    const recipe = chef.recipes.find((r) => r.name === "detect-app")!;
    assertEquals(recipe._currentVersion, "2.0.0");

    // checkUpdate uses _currentVersion (not DB)
    let updateInfo = await chef.checkUpdate("detect-app");
    assertEquals(updateInfo.currentVersion, "2.0.0");
    assertEquals(updateInfo.latestVersion, "2.0.0");

    // Simulate external update: change what versionCommand detects
    Deno.writeTextFileSync(detectedVersionPath, "3.0.0");
    await chef.refreshRecipes();
    assertEquals(recipe._currentVersion, "3.0.0");

    // checkUpdate uses _currentVersion (3.0.0), not DB (2.0.0)
    updateInfo = await chef.checkUpdate("detect-app");
    assertEquals(updateInfo.currentVersion, "3.0.0");
    assertEquals(updateInfo.latestVersion, "2.0.0");
    assertEquals(updateInfo.needsUpdate, true);
  }));

Deno.test("versionCommand - trailing whitespace is trimmed", async () =>
  await withTempDir(async () => {
    const chef = new TestChef();
    chef.addMany([{
      name: "trim-app",
      download: () => Promise.resolve({ exe: "test" } as App),
      version: () => Promise.resolve("2.0.0"),
      versionCommand: () => Promise.resolve("2.0.0\n"),
    }]);

    await chef.testInit();
    await chef.refreshRecipes();

    const recipe = chef.recipes.find((r) => r.name === "trim-app")!;
    assertEquals(recipe._currentVersion, "2.0.0");

    const updateInfo = await chef.checkUpdate("trim-app");
    assertEquals(updateInfo.needsUpdate, false);
  }));

Deno.test("versionCommand - chef list shows version from versionCommand", async () =>
  await withTempDir(async () => {
    const chef = new TestChef();
    chef.addMany([{
      name: "list-app",
      download: () => Promise.resolve({ exe: "test" } as App),
      version: () => Promise.resolve("3.0.0"),
      versionCommand: () => Promise.resolve("2.0.0"),
    }]);

    await chef.testInit();
    await chef.refreshRecipes();

    assertEquals(chef.isInstalled("list-app"), true);
    assertEquals(chef.getVersion("list-app"), "2.0.0");

    let listOutput = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      listOutput += msg + "\n";
    };

    await chef.start(["list"]);

    console.log = originalLog;
    assertEquals(listOutput.includes("2.0.0"), true);
    assertEquals(listOutput.includes("list-app"), true);
  }));

Deno.test("update - refreshRecipes is not called twice", async () =>
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

    await chef.testInit();

    // Install first so update finds an existing binary
    await chef.start(["update"]);

    // Count refreshRecipes calls during a named update
    let refreshCount = 0;
    const originalRefresh = chef.refreshRecipes;
    chef.refreshRecipes = async (signal) => {
      refreshCount++;
      await originalRefresh(signal);
    };

    await chef.start(["update", "hello"]);

    assertEquals(refreshCount, 1);
  }));

Deno.test("update - unknown binary is silently skipped", async () =>
  await withTempDir(async () => {
    const chef = new TestChef();

    chef.add({
      name: "real-app",
      download: () => Promise.resolve({ exe: "test" } as App),
      version: () => Promise.resolve("1.0.0"),
    });

    await chef.testInit();

    // Should not throw for unknown binary
    await chef.start(["update", "--dry-run", "nonexistent"]);

    // Should not print error for a known binary alongside an unknown one
    let logOutput = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      logOutput += msg;
    };

    await chef.start(["update", "--dry-run", "real-app", "nonexistent"]);

    console.log = originalLog;
    assertEquals(logOutput.includes("not found"), false);
  }));

Deno.test("exes install creates symlinks for each sub-binary", async () =>
  await withTempDir(async (dir: string) => {
    const exeDir = path.join(dir, "fake-extracted");
    Deno.mkdirSync(exeDir);
    Deno.writeTextFileSync(path.join(exeDir, "bin-a"), "binary a content");
    Deno.writeTextFileSync(path.join(exeDir, "bin-b"), "binary b content");

    const chef = new TestChef();

    chef.add({
      name: "multibin",
      download: async () => {
        Deno.mkdirSync("./extracted");
        await Deno.copyFile(
          path.join(exeDir, "bin-a"),
          "./extracted/bin-a",
        );
        await Deno.copyFile(
          path.join(exeDir, "bin-b"),
          "./extracted/bin-b",
        );
        return {
          dir: { path: "./extracted", exes: ["bin-a", "bin-b"] },
        } as App;
      },
      version: () => Promise.resolve("1.0.0"),
    });

    await chef.testInit();
    await chef.start(["update"]);

    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";

    // Extracted directory exists with both binaries
    const extractedDir = path.join(chef.binPath, "multibin-dir");
    Deno.statSync(path.join(extractedDir, "bin-a"));
    Deno.statSync(path.join(extractedDir, "bin-b"));

    // Primary symlink exists (first exe) at {binPath}/{name}
    const primarySymlink = path.join(chef.binPath, "multibin" + exeExtension);
    assertEquals(Deno.lstatSync(primarySymlink).isSymlink, true);

    // Sub-binary symlinks exist at {binPath}/{name}-{exe}
    const symlinkA = path.join(chef.binPath, "multibin-bin-a" + exeExtension);
    const symlinkB = path.join(chef.binPath, "multibin-bin-b" + exeExtension);
    assertEquals(Deno.lstatSync(symlinkA).isSymlink, true);
    assertEquals(Deno.lstatSync(symlinkB).isSymlink, true);

    // DB has subBinaries
    const db = JSON.parse(Deno.readTextFileSync(chef.dbPath));
    assertEquals(db.multibin.subBinaries, ["bin-a", "bin-b"]);
  }));

Deno.test("run namespaced sub-binary", async () =>
  await withTempDir(async (dir: string) => {
    // Compile two small executables
    const exeACode = path.join(dir, "exe-a.js");
    Deno.writeTextFileSync(
      exeACode,
      `Deno.writeTextFileSync("./ran-a", "ran a")`,
    );
    const exeBCode = path.join(dir, "exe-b.js");
    Deno.writeTextFileSync(
      exeBCode,
      `Deno.writeTextFileSync("./ran-b", "ran b")`,
    );
    await new Deno.Command("deno", {
      args: ["compile", "--no-check", "--allow-write=.", exeACode],
    }).spawn().status;
    await new Deno.Command("deno", {
      args: ["compile", "--no-check", "--allow-write=.", exeBCode],
    }).spawn().status;
    const exeA = Deno.build.os === "windows"
      ? exeACode.replace(".js", ".exe")
      : exeACode.replace(".js", "");
    const exeB = Deno.build.os === "windows"
      ? exeBCode.replace(".js", ".exe")
      : exeBCode.replace(".js", "");

    const chef = new TestChef();

    chef.add({
      name: "multibin",
      download: async () => {
        Deno.mkdirSync("./extracted");
        await Deno.copyFile(exeA, "./extracted/bin-a");
        // Make sure bin-a is executable (compile already does this on linux)
        try {
          await Deno.chmod("./extracted/bin-a", 0o755);
          // deno-lint-ignore no-empty
        } catch {}
        await Deno.copyFile(exeB, "./extracted/bin-b");
        try {
          await Deno.chmod("./extracted/bin-b", 0o755);
          // deno-lint-ignore no-empty
        } catch {}
        return {
          dir: { path: "./extracted", exes: ["bin-a", "bin-b"] },
        } as App;
      },
      version: () => Promise.resolve("1.0.0"),
    });

    await chef.testInit();
    await chef.start(["update"]);

    // Run sub-binary via namespaced name
    await chef.start(["run", "multibin/bin-a"]);

    // Assert it ran
    assertEquals(
      Deno.readTextFileSync(path.join(dir, "ran-a")),
      "ran a",
    );
  }));

Deno.test("uninstall removes parent + all sub-binary artifacts", async () =>
  await withTempDir(async (dir: string) => {
    const exeDir = path.join(dir, "fake-extracted");
    Deno.mkdirSync(exeDir);
    Deno.writeTextFileSync(path.join(exeDir, "bin-a"), "binary a");
    Deno.writeTextFileSync(path.join(exeDir, "bin-b"), "binary b");

    const chef = new TestChef();
    chef.add({
      name: "multibin",
      download: async () => {
        Deno.mkdirSync("./extracted");
        await Deno.copyFile(path.join(exeDir, "bin-a"), "./extracted/bin-a");
        await Deno.copyFile(path.join(exeDir, "bin-b"), "./extracted/bin-b");
        return {
          dir: { path: "./extracted", exes: ["bin-a", "bin-b"] },
        } as App;
      },
      version: () => Promise.resolve("1.0.0"),
    });

    await chef.testInit();
    await chef.start(["update"]);

    // Verify installed
    assertEquals(chef.database.isInstalled("multibin"), true);

    // Uninstall
    await chef.start(["uninstall", "multibin"]);

    // DB entry gone
    assertEquals(chef.database.isInstalled("multibin"), false);

    // Primary symlink gone
    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    const primaryPath = path.join(chef.binPath, "multibin" + exeExtension);
    try {
      Deno.statSync(primaryPath);
      throw new Error("should not exist");
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }

    // Sub-binary symlinks gone
    const symlinkA = path.join(chef.binPath, "multibin-bin-a" + exeExtension);
    try {
      Deno.statSync(symlinkA);
      throw new Error("should not exist");
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }

    // Extracted directory gone
    const extractedDir = path.join(chef.binPath, "multibin-dir");
    try {
      Deno.statSync(extractedDir);
      throw new Error("should not exist");
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }));

Deno.test("backward compat: dir.exe still works unchanged", async () =>
  await withTempDir(async (dir: string) => {
    const exeDir = path.join(dir, "fake-extracted");
    Deno.mkdirSync(exeDir);
    Deno.writeTextFileSync(path.join(exeDir, "my-bin"), "binary content");

    const chef = new TestChef();
    chef.add({
      name: "singlebin",
      download: async () => {
        Deno.mkdirSync("./extracted");
        await Deno.copyFile(path.join(exeDir, "my-bin"), "./extracted/my-bin");
        return { dir: { path: "./extracted", exe: "my-bin" } } as App;
      },
      version: () => Promise.resolve("1.0.0"),
    });

    await chef.testInit();
    await chef.start(["update"]);

    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    const primarySymlink = path.join(chef.binPath, "singlebin" + exeExtension);
    assertEquals(Deno.lstatSync(primarySymlink).isSymlink, true);

    const extractedDir = path.join(chef.binPath, "extracted");
    Deno.statSync(path.join(extractedDir, "my-bin"));

    const db = JSON.parse(Deno.readTextFileSync(chef.dbPath));
    assertEquals(db.singlebin.dir, "./extracted");
    assertEquals(db.singlebin.subBinaries, undefined);
  }));

Deno.test("getVersions maps sub-binary name to parent recipe", async () =>
  await withTempDir(async () => {
    const chef = new TestChef();
    chef.add({
      name: "multibin",
      download: () => Promise.resolve({ exe: "test" } as App),
      version: () => Promise.resolve("2.0.0"),
    });

    await chef.testInit();
    const versions = await chef.getVersions("multibin/bin-a");
    assertEquals(versions, ["2.0.0"]);
  }));
