export async function getLatestGithubRelease(
  repo: string,
): Promise<string | undefined> {
  return await fetch(`https://github.com/${repo}/releases/latest`).then((res) =>
    res.url.split("/").at(-1)
  );
}

export async function getLatestNpmVersion(
  packageName: string,
): Promise<string | undefined> {
  const response = await fetch(
    `https://registry.npmjs.org/${packageName}/latest`,
  );
  if (!response.ok) {
    return;
  }
  const data = await response.json();
  return data.version;
}
