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
export async function getLatestGithubRelease(
  repo: string,
): Promise<string | undefined> {
  return await fetch(`https://github.com/${repo}/releases/latest`)
    .then((res) => res.url.split("/").at(-1));
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
