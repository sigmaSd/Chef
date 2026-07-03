# Chef Recipe Skill

You are helping add a recipe to Chef (personal package manager). The user's recipe file is at **`~/.cache/chef/chefjsrdefault/chefjsrdefault.ts`**.

## Recipe Interface (only `name` + `download` required)

```ts
import { Chef, $ } from "jsr:@sigmasd/chef";
import { getLatestGithubRelease, getGithubReleases } from "jsr:@sigmasd/chef/utils";

const chef = new Chef();

chef.add({
  name: "myapp",                            // required
  download: async ({ latestVersion }) => {  // required, returns App
    await $.request(`https://...`).showProgress().pipeToPath();
    // download, extract/handle, locate binary, return it
    return { exe: "./binary" };
    // or: return { dir: { path: "./dir/", exe: "./binary" } };
    // or: return { extern: "command" };
  },
  version: () => getLatestGithubRelease("owner/repo"),      // latest available
  versions: (opts) => getGithubReleases("owner/repo", opts), // for version picker
  description: "Does X",                                     // shown in GUI
  desktopFile: { name: "MyApp", categories: "Development;", iconPath: "URL" },
  changelog: ({ latestVersion }) => `https://.../${latestVersion}`,
  cmdArgs: ["--flag"],
  cmdEnv: { KEY: "val" },
});
```

## Workflow — Discover Then Write

**Pass 1: Discover.** Download the real release asset and inspect it in a temp directory:
- Run curl/wget to download the asset the user points to
- Inspect the file: use `tar -tzf` for archives, `file` to detect type, `ls -R` to see extracted structure
- Check if the binary extracts directly into CWD or into a subdirectory
- Note the exact filename(s) and paths

**Pass 2: Write.** Craft the recipe based on the actual structure you observed:
- If the binary ends up at CWD → `{ exe: "./binary" }`
- If extraction creates a containing directory → `{ dir: { path: "./dir/", exe: "./binary" } }`
- If the asset itself is the binary (AppImage, statically linked binary) → `chmod +x` then `{ exe }`
- If the asset needs special handling (npm, `.deb`, custom install script) → handle accordingly

## Tips

- `$` is Chef's cross-platform shell wrapper (from `@david/dax`). Use template strings: <code>$`command`</code>
- Chef runs `download()` in a temp directory, so you can freely write files
- `.showProgress()` on requests shows a progress bar in the GUI
- Use `Deno.build.os` / `Deno.build.arch` when the release provides platform-specific assets

## Instructions

1. **Read the existing file** to understand its conventions.
2. **Find the real release URL** (GitHub releases, NPM, etc.) and download it to inspect.
3. **Write the recipe** based on your inspection — no guessing.
4. **Do NOT add comments** to the recipe code.
5. **Verify:**
   - Did I actually download and inspect the asset before writing?
   - Does the download URL use `latestVersion` (or the observed tag format)?
   - Does the extraction/handling match what I observed?
   - Is the `{ exe }` / `{ dir }` return value correct based on real inspection?
   - Desktop file included for GUI apps?
   - `versions()` included when a version picker is useful?
