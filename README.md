# Chef

Personal package manager

## Why it exists

This is useful for those binaries that are not packaged by a distro.

With chef you can:

- Install a random binary
- Keep it up-to-date
- Run it

## Usage

create a file for example **chef.ts** with:

```ts
import { Chef } from "https://deno.land/x/derchef/mod.ts";

const chef = new Chef();

chef.add({
    name: "binary1",
    cmd: () => {
    // a fuction that downloads the binary and return its relative path
    },
    version: () => {
    // a function that returns the latest version of the binary
    }
}

await chef.run()
```

For a better experience install it with deno install (make sure `~/.deno/bin` is
in your path):

`deno install -A --unstable -n chef chef.ts`

You can now use:

- `chef` or `chef update` to update all binaries (or install it if it doesn't
  exist yet)
- `chef list` to list currently binaries
- `chef run ${binary}` to run one of the installed binaries

Checkout `examples.ts` for more info.
