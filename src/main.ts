import { cache_dir, ensureDirSync, path } from "./deps.ts";
import { Colors, runInTempDir } from "./utils.ts";

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
      const dbData = JSON.parse(Deno.readTextFileSync(Chef.dbPath));
      for (const name of Object.keys(dbData)) {
        console.log(
          `%c${name} %c${dbData[name]}`,
          `color: ${Colors.lightYellow}`,
          `color: ${Colors.lightGreen}`,
        );
      }
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
        if (!binName) {
          Chef.list();
          return;
        }
        if (!db[binName]) {
          console.error(
            `Unknown binary: %c${binName}`,
            `color: ${Colors.lightRed}`,
          );
          console.log("%c\nAvailable binaries:", `color: ${Colors.blueMarine}`);
          Chef.list();
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
      case undefined:
        await this.update();
        break;
      default:
        console.error(`Unknown command %c${cmd}`, `color: ${Colors.lightRed}`);
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
    console.log(`%cLooking for updates..`, `color: magenta`);
    console.log("%c\nAvailable binaries:", `color: ${Colors.blueMarine}`);
    Chef.list();
    console.log("");

    ensureDirSync(Chef.BinPath);
    const currentDb = Chef.readDb();

    for (const recipe of this.recipes) {
      console.log(`Updating %c${recipe.name}`, `color: ${Colors.lightYellow}`);

      const { name, cmd, version } = recipe;
      const latestVersion = await version();
      if (!latestVersion) {
        console.warn("Chef was not able to get the latest version of", name);
        console.warn(`skipping ${name}`);
        continue;
      }
      const currentVersion = currentDb[name];
      if (currentVersion === latestVersion) {
        console.log(
          `%c${name}%c is %cuptodate`,
          `color: ${Colors.lightYellow}`,
          "",
          `color: ${Colors.lightGreen}`,
        );
        continue;
      }
      console.log(
        `%c${name} is out of date, updating to ${latestVersion}`,
        "color: #ffff00",
      );

      runInTempDir(() => {
        const tempBin = cmd({ latestVersion });
        Deno.copyFileSync(tempBin, path.join(Chef.BinPath, name));
      });

      currentDb[name] = latestVersion;

      console.log(
        `%c${name} ${latestVersion} was successfully updated`,
        "color: #00ff00",
      );
    }
    Deno.writeTextFileSync(Chef.dbPath, JSON.stringify(currentDb));
  };
}
