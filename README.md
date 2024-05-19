# Chef

Personal package manager

## Why it exists

This is useful for those binaries that are not packaged by a distro.

With chef you can:

- Install a random binary
- Keep it up-to-date
- Run it

## Usage

Create a file for example **chef.ts** with:

```typescript
import { Chef } from "jsr:@sigmasd/chef";

const chef = new Chef();

chef.add({
  name: "binary1",
  download: () => {
    // a fuction that downloads the binary and return its relative path
  },
  version: () => {
    // a function that returns the latest version of the binary
  },
});

await chef.run();
```

For a better experience install it with deno install (make sure `~/.deno/bin` is
in your path):

`deno install -A -n chef chef.ts`

You can now use:

- `chef update` to update all binaries (or install it if it doesn't exist yet)
- `chef list` to list currently binaries
- `chef run ${binary} $args` to run one of the installed binaries

Checkout `bin` direcotry for more examples.

## Examples

**Example 1**

```ts
import { $ } from "jsr:@david/dax@0.39.2";
import { Chef } from "jsr:@sigmasd/chef";
import { getLatestGithubRelease, getLatestNpmVersion } from "jsr:@sigmasd/chef/utils";

if (import.meta.main) {
 const chef = new Chef();
 chef.addMany(
   [
     {
       name: "slint-lsp",
       download: async () => {
         await $.request(
           "https://github.com/slint-ui/slint/releases/download/v1.5.1/slint-lsp-linux.tar.gz",
         ).pipeToPath();
         await $`tar -xzf slint-lsp-linux.tar.gz`;
         return {
           exe: "./slint-lsp/slint-lsp",
         };
       },
       version: () => getLatestGithubRelease("slint-ui/slint"),
     },
     {
       name: "typescript-language-server",
       download: async () => {
         await $`npm install typescript-language-server`;
         return {
           exe: "./node_modules/typescript-language-server/lib/cli.mjs",
           dir: ".",
         };
       },
       version: () => getLatestNpmVersion("typescript-language-server"),
     },
  ],
);

await chef.start();
```
