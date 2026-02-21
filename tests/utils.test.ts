import { assert, assertGreater } from "@std/assert";
import { getGithubReleases, getNpmVersions } from "../src/utils.ts";

Deno.test("getGithubReleases fetches versions", async () => {
  // Use a stable repo with many releases
  const versions = await getGithubReleases("sigmaSd/IRust");
  assert(Array.isArray(versions));
  assertGreater(versions.length, 0);
  assert(versions.every((v) => typeof v === "string"));
});

Deno.test("getGithubReleases pagination", async () => {
  const page1 = await getGithubReleases("sigmaSd/IRust", { page: 1 });
  const page2 = await getGithubReleases("sigmaSd/IRust", { page: 2 });

  assertGreater(page1.length, 0);
  if (page2.length > 0) {
    assert(page1[0] !== page2[0], "Page 1 and Page 2 should be different");
  }
});

Deno.test("getNpmVersions fetches versions", async () => {
  const versions = await getNpmVersions("typescript");
  assert(Array.isArray(versions));
  assertGreater(versions.length, 0);
  assert(versions.every((v) => typeof v === "string"));
});

Deno.test("getNpmVersions pagination", async () => {
  const page1 = await getNpmVersions("typescript", { page: 1 });
  const page2 = await getNpmVersions("typescript", { page: 2 });

  assertGreater(page1.length, 0);
  assertGreater(page2.length, 0);
  assert(page1[0] !== page2[0], "Page 1 and Page 2 should be different");
});
