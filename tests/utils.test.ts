import { assertEquals } from "@std/assert";
import { assertSpyCall, stub } from "@std/testing/mock";
import { getGithubReleases, getNpmVersions } from "../src/utils.ts";

Deno.test("getGithubReleases fetches versions (mocked)", async () => {
  const mockResponse = JSON.stringify([
    { tag_name: "v1.1.0" },
    { tag_name: "v1.0.0" },
  ]);

  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.resolve(new Response(mockResponse, { status: 200 })),
  );

  try {
    const versions = await getGithubReleases("owner/repo");
    assertEquals(versions, ["v1.1.0", "v1.0.0"]);
    assertSpyCall(fetchStub, 0, {
      args: [
        "https://api.github.com/repos/owner/repo/releases?page=1&per_page=30",
        { headers: { "User-Agent": "Chef-Package-Manager" } },
      ],
    });
  } finally {
    fetchStub.restore();
  }
});

Deno.test("getGithubReleases pagination (mocked)", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    (input: string | URL | Request) => {
      const url = new URL(input.toString());
      const page = url.searchParams.get("page");
      const mockData = page === "1"
        ? [{ tag_name: "v2" }]
        : [{ tag_name: "v1" }];
      return Promise.resolve(
        new Response(JSON.stringify(mockData), { status: 200 }),
      );
    },
  );

  try {
    const page1 = await getGithubReleases("owner/repo", { page: 1 });
    const page2 = await getGithubReleases("owner/repo", { page: 2 });

    assertEquals(page1, ["v2"]);
    assertEquals(page2, ["v1"]);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("getNpmVersions fetches versions (mocked)", async () => {
  const mockResponse = JSON.stringify({
    versions: {
      "1.0.0": {},
      "1.1.0": {},
    },
  });

  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.resolve(new Response(mockResponse, { status: 200 })),
  );

  try {
    const versions = await getNpmVersions("pkg");
    assertEquals(versions, ["1.1.0", "1.0.0"]);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("getNpmVersions pagination (mocked)", async () => {
  const versions: Record<string, object> = {};
  for (let i = 1; i <= 40; i++) {
    versions[`1.0.${i}`] = {};
  }
  const mockResponse = JSON.stringify({ versions });

  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.resolve(new Response(mockResponse, { status: 200 })),
  );

  try {
    const page1 = await getNpmVersions("pkg", { page: 1 });
    const page2 = await getNpmVersions("pkg", { page: 2 });

    assertEquals(page1.length, 30);
    assertEquals(page1[0], "1.0.40");
    assertEquals(page2.length, 10);
    assertEquals(page2[0], "1.0.10");
  } finally {
    fetchStub.restore();
  }
});
