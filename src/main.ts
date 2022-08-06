import cache_dir from "https://deno.land/x/dir@1.5.1/cache_dir/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.145.0/fs/mod.ts";
import * as path from "https://deno.land/std@0.145.0/path/mod.ts";
import { runInTempDir } from "./utils.ts";

export interface Recipe {
  name: string;
  cmd: ({ latestVersion }: { latestVersion: string }) => string;
  version: () => Promise<string | undefined>;
}

export class Chef {
  static Path = path.join(cache_dir()!, "chef");
  static BinPath = path.join(Chef.Path, "bin");
  static dbPath = path.join(Chef.Path, "db.json");
  recipes: Recipe[] = [];

  static list = () => {
    try {
      console.log(Deno.readTextFileSync(Chef.dbPath));
    } catch {
      console.log("No db yet, add a new program for it to get created");
    }
  };
  add = (recipe: Recipe) => {
    this.recipes.push(recipe);
    return this;
  };
  run = async () => {
    const cmd = Deno.args[0];
    switch (cmd) {
      case "run": {
        const binName = Deno.args[1];
        const db = Chef.readDb();
        if (!binName || !db[binName]) {
          console.error("trying to run an unknown binary ", binName);
          return;
        }
        const binPath = path.join(Chef.BinPath, binName);
        await Deno.spawn(binPath, {
          args: Deno.args.slice(2),
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
        });
        break;
      }
      case "list":
        Chef.list();
        break;
      case "update":
        await this.update();
        break;
      default:
        await this.update();
        //console.error("unknown command ", cmd);
    }
  };
  static readDb = (): Record<string, string> => {
    let db;
    try {
      db = Deno.readTextFileSync(Chef.dbPath);
    } catch {
      db = "{}";
    }
    return JSON.parse(db);
  };
  update = async () => {
    ensureDirSync(Chef.BinPath);
    const currentDb = Chef.readDb();

    for (const recipe of this.recipes) {
      const { name, cmd, version } = recipe;
      const latestVersion = await version();
      if (!latestVersion) {
        console.warn("Chef was not able to get the latest version of", name);
        console.warn(`skipping ${name}`);
        continue;
      }
      const currentVersion = currentDb[name];
      if (currentVersion === latestVersion) {
        console.log(name, "is up to date");
        continue;
      }
      console.log(`${name} is out of date, updating to ${latestVersion}`);

      runInTempDir(() => {
        const tempBin = cmd({ latestVersion });
        Deno.copyFileSync(tempBin, path.join(Chef.BinPath, name));
      });

      currentDb[name] = latestVersion;

      console.log(`${name} ${latestVersion} was successfully updated`);
    }
    Deno.writeTextFileSync(Chef.dbPath, JSON.stringify(currentDb));
  };
}

if (import.meta.main) {
  Chef.list();
}
