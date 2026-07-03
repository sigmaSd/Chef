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
    // download + extract in CWD (Chef runs in a temp dir)
    await $.request(`https://...`).showProgress().pipeToPath();
    await $`tar -xzf ...`;
    return { exe: "./myapp" };
    // or: return { dir: { path: "./dir/", exe: "./bin" } };
    // or: return { extern: "command" };
  },
  version: () => getLatestGithubRelease("owner/repo"),      // latest available
  versions: (opts) => getGithubReleases("owner/repo", opts), // for version picker
  description: "Does X",                                     // shown in GUI
  desktopFile: { name: "MyApp", categories: "Development;", iconPath: "URL" },
  changelog: ({ latestVersion }) => `https://.../${latestVersion}`,
  cmdArgs: ["--flag"],   // prepended to user args on `chef run`
  cmdEnv: { KEY: "val" },
});
```

## Common Patterns

| Pattern | Snippet |
|---------|---------|
| **tar.gz → single binary** | `$.request(URL).pipeToPath()` → `$`tar -xzf ...`` → `{ exe: "binary" }` |
| **Strip `v` prefix** | `latestVersion.slice(1)` when GitHub tag is `v1.2.3` but URL wants `1.2.3` |
| **AppImage** | Download → `$`chmod +x AppImage`` → `{ exe: "./AppImage" }` |
| **Directory install** | Extract → `{ dir: { path: "./extracted/", exe: "./binary" } }` |
| **NPM package** | `$`npm install pkg`` → `{ dir: { path: ".", exe: "./node_modules/.bin/pkg" } }`, use `getLatestNpmVersion` |
| **Cross-platform** | `Deno.build.os` / `Deno.build.arch` to select correct asset |
| **Desktop file** | Add `desktopFile: { name, categories, iconPath, terminal }` for GUI apps |

## Instructions

1. **Read existing file** — understand its structure and conventions.
2. **Add the recipe** — use `chef.add()` inside the `chef.addMany([...])` array or add a new `chef.add()` call.
3. **Do NOT add comments** to the recipe code.
4. **Verify**:
   - Download URL is constructed correctly with template literals
   - Version tag format matches what GitHub/NPM provides
   - Extraction paths match what the archive produces
   - Binaries are `chmod +x`'d if not from a standard extraction
   - Desktop file is included for GUI applications
   - `versions()` is included when a version picker is useful
