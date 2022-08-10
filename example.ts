import { $$ } from "https://deno.land/x/simple_shell@0.10.0/mod.ts";
import { Chef } from "./mod.ts";

const chef = new Chef();
chef.addMany(
  [
    {
      name: "codeFormat",
      cmd: () => {
        $$(
          "wget https://github.com/CppCXY/EmmyLuaCodeStyle/releases/latest/download/linux-x64.tar.gz",
        );
        $$("tar -xzf linux-x64.tar.gz");
        return "./linux-x64/bin/CodeFormat";
      },
      version: async () => {
        return await fetch(
          "https://github.com/CppCXY/EmmyLuaCodeStyle/releases/latest",
        ).then((res) => res.url.split("/").at(-1));
      },
    },
    {
      name: "irust",
      cmd: ({ latestVersion }) => {
        $$(
          `wget https://github.com/sigmaSd/IRust/releases/download/${latestVersion}/irust-${latestVersion}-x86_64-unknown-linux-musl.tar.gz`,
        );
        $$(`tar -xzf irust-${latestVersion}-x86_64-unknown-linux-musl.tar.gz`);
        return `./irust-${latestVersion}-x86_64-unknown-linux-musl/irust`;
      },
      version: async () => {
        return await fetch(
          "https://github.com/sigmaSd/IRust/releases/latest",
        ).then((res) => res.url.split("/").at(-1));
      },
    },
    {
      name: "imhex",
      cmd: ({ latestVersion }) => {
        // remove v from version
        // v1.20.0 -> 1.20.0
        latestVersion = latestVersion.slice(1);

        $$(
          `wget https://github.com/WerWolv/ImHex/releases/latest/download/imhex-${latestVersion}.AppImage`,
        );
        $$(`mv imhex-${latestVersion}.AppImage imhex`);
        return `./imhex`;
      },
      version: async () => {
        return await fetch(
          "https://github.com/WerWolv/ImHex/releases/latest",
        ).then((res) => res.url.split("/").at(-1));
      },
      postInstall(binPath) {
        $$`chmod +x ${binPath}`;
      },
    },
  ],
);

await chef.run();
