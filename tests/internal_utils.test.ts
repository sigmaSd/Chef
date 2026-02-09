import { assertEquals } from "@std/assert";
import { getVersionFromUrl } from "../src/internal_utils.ts";

Deno.test("getVersionFromUrl should extract version from JSR URL", () => {
  assertEquals(getVersionFromUrl("jsr:@sigmasd/chef@0.41.0/mod.ts"), "0.41.0");
  assertEquals(
    getVersionFromUrl("jsr:@sigmasd/chef@0.41.0-alpha.1/mod.ts"),
    "0.41.0-alpha.1",
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
    await Deno.mkdir(basePath, { recursive: true });

    const chefFile = `${basePath}/chef-default-jsr.ts`;
    const oldVersion = "0.40.0";
    const newVersion = "0.41.0";
    const libUrl = `jsr:@sigmasd/chef@${newVersion}/mod.ts`;
    const utilsUrl = `jsr:@sigmasd/chef@${newVersion}/src/utils.ts`;

    const content = `
import { Chef, $ } from "jsr:@sigmasd/chef@${oldVersion}";
import { getLatestGithubRelease } from "jsr:@sigmasd/chef@${oldVersion}/utils";

const chef = new Chef();
await chef.start(import.meta.url);
`.trim();

    await Deno.writeTextFile(chefFile, content);

    await ensureDefaultChefFile(libUrl, utilsUrl);

    const newContent = await Deno.readTextFile(chefFile);
    assertEquals(newContent.includes(`@sigmasd/chef@${newVersion}`), true);
    assertEquals(newContent.includes(`@sigmasd/chef@${oldVersion}`), false);

    // Test no update if version is same
    await ensureDefaultChefFile(libUrl, utilsUrl);
    const sameContent = await Deno.readTextFile(chefFile);
    assertEquals(sameContent, newContent);

    // Test no update if version is older
    const olderLibUrl = `jsr:@sigmasd/chef@0.39.0/mod.ts`;
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
