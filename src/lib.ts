import { cache_dir, ensureDirSync, path } from "./deps.ts";
import { Colors, runInTempDir } from "./utils.ts";

export interface Recipe {
  name: string;
  cmd: ({ latestVersion }: { latestVersion: string }) => Promise<string>;
  version: () => Promise<string | undefined>;
  postInstall?: (binPath: string) => void;
}

export class Chef {
  static Path = path.join(cache_dir()!, "chef");
  static BinPath = path.join(Chef.Path, "bin");
  static dbPath = path.join(Chef.Path, "db.json");
  static readDb = (): Record<string, string> => {
    let db;
    try {
      db = Deno.readTextFileSync(Chef.dbPath);
    } catch {
      db = "{}";
    }
    return JSON.parse(db);
  };
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

  recipes: Recipe[] = [];

  addMany = (recipes: Recipe[]) => {
    recipes.forEach((recipe) => this.add(recipe));
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
        await new Deno.Command(binPath, {
          args: Deno.args.slice(2),
          stdin: "inherit",
        }).spawn().status;
        break;
      }
      case "list":
        Chef.list();
        break;
      case "update":
      case undefined:
        await this.update();
        break;
      case "edit":
        this.edit();
        break;
      default:
        console.error(`Unknown command %c${cmd}`, `color: ${Colors.lightRed}`);
    }
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

      await runInTempDir(async () => {
        const tempBin = await cmd({ latestVersion });
        Deno.copyFileSync(tempBin, path.join(Chef.BinPath, name));
      });

      currentDb[name] = latestVersion;

      if (recipe.postInstall) {
        recipe.postInstall(path.join(Chef.BinPath, name));
      }

      console.log(
        `%c${name} ${latestVersion} was successfully updated`,
        "color: #00ff00",
      );
    }
    Deno.writeTextFileSync(Chef.dbPath, JSON.stringify(currentDb));
  };
  edit() {
    const stack = new Error().stack!;
    const lines = stack.split("\n");
    const chef = lines[lines.length - 1];

    let chefPath = chef.split("at ")[1];

    chefPath = chefPath.slice(0, chefPath.lastIndexOf(":") - 3);
    console.log(chefPath);
  }
}
