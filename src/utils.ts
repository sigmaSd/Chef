/**
 * This module provides utility functions to fetch the latest releases from different sources.
 * @module
 */

/**
 * Fetches the latest release tag from a given GitHub repository.
 *
 * @param {string} repo - The GitHub repository in the format "owner/repo".
 * @returns {Promise<string | undefined>} A promise that resolves to the latest release tag, or undefined if the request fails.
 */
/**
 * Fetches the latest release tag from a given GitHub repository.
 *
 * @param {string} repo - The GitHub repository in the format "owner/repo".
 * @returns {Promise<string | undefined>} A promise that resolves to the latest release tag, or undefined if the request fails.
 */
export async function getLatestGithubRelease(
  repo: string,
): Promise<string | undefined> {
  const url = `https://github.com/${repo}/releases/latest`;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Chef-Package-Manager",
      },
    });

    if (response.ok) {
      if (response.url !== url) {
        const latest = response.url.split("/").at(-1);
        if (latest && latest !== "latest" && latest !== "releases") {
          return decodeURIComponent(latest);
        }
      }

      // If no redirect, try scraping the HTML for the tag
      const html = await response.text();
      // Look for /releases/tag/TAG_NAME
      const match = html.match(/\/releases\/tag\/([^"'\s>]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    }
  } catch {
    // Ignore error and try API fallback
  }

  // API Fallback
  try {
    const releases = await getGithubReleases(repo, { page: 1 });
    return releases[0];
  } catch {
    return undefined;
  }
}

/**
 * Fetches all release tags from a given GitHub repository.
 *
 * @param {string} repo - The GitHub repository in the format "owner/repo".
 * @param {object} options - Options for pagination.
 * @returns {Promise<string[]>} A promise that resolves to an array of release tags.
 */
export async function getGithubReleases(
  repo: string,
  options: { page?: number } = {},
): Promise<string[]> {
  const page = options.page ?? 1;
  const url =
    `https://api.github.com/repos/${repo}/releases?page=${page}&per_page=30`;
  try {
    const response = await fetch(
      url,
      {
        headers: {
          "User-Agent": "Chef-Package-Manager",
        },
      },
    );
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return data.map((release: { tag_name: string }) => release.tag_name);
  } catch {
    return [];
  }
}

/**
 * Fetches the latest version of a given npm package.
 *
 * @param {string} packageName - The name of the npm package.
 * @returns {Promise<string | undefined>} A promise that resolves to the latest version of the package, or undefined if the request fails.
 */
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

/**
 * Fetches all available versions of a given npm package.
 *
 * @param {string} packageName - The name of the npm package.
 * @param {object} options - Options for pagination.
 * @returns {Promise<string[]>} A promise that resolves to an array of available versions.
 */
export async function getNpmVersions(
  packageName: string,
  options: { page?: number } = {},
): Promise<string[]> {
  const page = options.page ?? 1;
  const perPage = 30;
  const response = await fetch(`https://registry.npmjs.org/${packageName}`);
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  const versions = Object.keys(data.versions).reverse(); // Newest first

  const start = (page - 1) * perPage;
  const end = start + perPage;
  return versions.slice(start, end);
}

/**
 * Checks if a given string is a valid URL.
 *
 * @param {string} str - The string to check.
 * @returns {boolean} True if the string is a valid URL, false otherwise.
 */
export function isUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Throws an error with the given message.
 * Useful with the nullish coalescing operator: `val ?? expect("msg")`.
 *
 * @param {string} msg - The error message.
 * @returns {never}
 */
export function expect(msg: string): never {
  throw new Error(msg);
}
