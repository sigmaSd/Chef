export const getLatestGithubRelease = async (repo: string) =>
  await fetch(`https://github.com/${repo}/releases/latest`).then((res) =>
    res.url.split("/").at(-1)
  );
