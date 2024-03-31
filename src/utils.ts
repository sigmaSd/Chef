export async function getLatestGithubRelease(repo: string) {
  return await fetch(`https://github.com/${repo}/releases/latest`).then((res) =>
    res.url.split("/").at(-1)
  );
}

export async function getLatestNpmVersion(
  packageName: string,
): Promise<string> {
  const response = await fetch(
    `https://registry.npmjs.org/${packageName}/latest`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch latest version for ${packageName}`);
  }
  const data = await response.json();
  return data.version;
}
