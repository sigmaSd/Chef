import { assertEquals } from "@std/assert";
import {
  copyDirRecursively,
  getVersionFromUrl,
} from "../src/internal_utils.ts";
import * as path from "@std/path";

Deno.test("getVersionFromUrl should extract version from JSR URL", () => {
  assertEquals(getVersionFromUrl("jsr:@sigmasd/chef@0.41.0/mod.ts"), "0.41.0");
  assertEquals(
    getVersionFromUrl("jsr:@sigmasd/chef@0.41.0-alpha.1/mod.ts"),
    "0.41.0-alpha.1",
  );
  assertEquals(
    getVersionFromUrl("https://jsr.io/@sigmasd/chef/0.45.0/mod.ts"),
    "0.45.0",
  );
});

Deno.test("getVersionFromUrl should extract version from import statement", () => {
  assertEquals(
    getVersionFromUrl('import { Chef } from "jsr:@sigmasd/chef@0.40.0";'),
    "0.40.0",
  );
  assertEquals(
    getVersionFromUrl(
      'import { getLatestGithubRelease } from "jsr:@sigmasd/chef@0.40.0/utils";',
    ),
    "0.40.0",
  );
});

Deno.test("getVersionFromUrl should return undefined if no version matches", () => {
  assertEquals(getVersionFromUrl("jsr:@sigmasd/chef/mod.ts"), undefined);
  assertEquals(
    getVersionFromUrl('import { Chef } from "jsr:@sigmasd/chef";'),
    undefined,
  );
});

Deno.test("ensureDefaultChefFile should update version if newer", async () => {
  const tempDir = await Deno.makeTempDir();
  const originalXdg = Deno.env.get("XDG_CACHE_HOME");
  Deno.env.set("XDG_CACHE_HOME", tempDir);

  try {
    const { ensureDefaultChefFile, getChefBasePath } = await import(
      "../src/internal_utils.ts"
    );
    const basePath = getChefBasePath();
    const scriptName = "chefjsrdefault";
    const scriptDir = `${basePath}/${scriptName}`;
    await Deno.mkdir(scriptDir, { recursive: true });

    const chefFile = `${scriptDir}/${scriptName}.ts`;
    const oldVersion = "0.40.0";
    const newVersion = "0.41.0";
    const libUrl = `https://jsr.io/@sigmasd/chef/${newVersion}/mod.ts`;
    const utilsUrl = `https://jsr.io/@sigmasd/chef/${newVersion}/src/utils.ts`;

    // Use the full URL form (matching what the template actually generates)
    const oldLibUrl = libUrl.replace(newVersion, oldVersion);
    const oldUtilsUrl = utilsUrl.replace(newVersion, oldVersion);
    const content = [
      `import { Chef, $ } from "${oldLibUrl}";`,
      `import { getLatestGithubRelease } from "${oldUtilsUrl}";`,
      "",
      "const chef = new Chef();",
      "await chef.start(import.meta.url);",
    ].join("\n");

    await Deno.writeTextFile(chefFile, content);

    await ensureDefaultChefFile(libUrl, utilsUrl);

    const newContent = await Deno.readTextFile(chefFile);
    assertEquals(newContent.includes(`@sigmasd/chef/${newVersion}`), true);
    assertEquals(newContent.includes(`@sigmasd/chef/${oldVersion}`), false);

    // Test no update if version is same
    await ensureDefaultChefFile(libUrl, utilsUrl);
    const sameContent = await Deno.readTextFile(chefFile);
    assertEquals(sameContent, newContent);

    // Test no update if version is older
    const olderLibUrl = `https://jsr.io/@sigmasd/chef/0.39.0/mod.ts`;
    await ensureDefaultChefFile(olderLibUrl, utilsUrl);
    const stillNewContent = await Deno.readTextFile(chefFile);
    assertEquals(stillNewContent, newContent);
  } finally {
    if (originalXdg) {
      Deno.env.set("XDG_CACHE_HOME", originalXdg);
    } else {
      Deno.env.delete("XDG_CACHE_HOME");
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("copyDirRecursively copies symlinks", async () => {
  const src = await Deno.makeTempDir();
  const dst = await Deno.makeTempDir();
  try {
    const content = "lib content";
    // Regular file
    Deno.writeTextFileSync(path.join(src, "libfoo.so.1.0.0"), content);
    // Symlink to file
    await Deno.symlink("libfoo.so.1.0.0", path.join(src, "libfoo.so.0"), {
      type: "file",
    });
    // Chain of symlinks
    await Deno.symlink("libfoo.so.0", path.join(src, "libfoo.so"), {
      type: "file",
    });

    await copyDirRecursively(src, path.join(dst, "out"));

    const outDir = path.join(dst, "out");
    // Regular file copied
    const stat1 = Deno.statSync(path.join(outDir, "libfoo.so.1.0.0"));
    assertEquals(stat1.isFile, true);

    // Symlink resolved to regular file with correct content
    const stat0 = Deno.lstatSync(path.join(outDir, "libfoo.so.0"));
    assertEquals(stat0.isFile, true);
    assertEquals(stat0.isSymlink, false);
    assertEquals(
      Deno.readTextFileSync(path.join(outDir, "libfoo.so.0")),
      content,
    );

    // Chained symlink also resolved
    const statLink = Deno.lstatSync(path.join(outDir, "libfoo.so"));
    assertEquals(statLink.isFile, true);
    assertEquals(statLink.isSymlink, false);
    assertEquals(
      Deno.readTextFileSync(path.join(outDir, "libfoo.so")),
      content,
    );
  } finally {
    await Deno.remove(src, { recursive: true });
    await Deno.remove(dst, { recursive: true });
  }
});
