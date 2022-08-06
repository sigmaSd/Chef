import { $$ } from "https://deno.land/x/simple_shell@0.10.0/mod.ts";
import { Chef } from "./src/main.ts";

const chef = new Chef();
chef.add(
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
).add(
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
);

await chef.run();
