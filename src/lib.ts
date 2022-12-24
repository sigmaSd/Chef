import { assert, cache_dir, ensureDirSync, path } from "./deps.ts";
import { Colors, runInTempDir } from "./internal_utils.ts";

class ChefInternal {
  static Path = path.join(cache_dir()!, "chef");
  static binPath = path.join(ChefInternal.Path, "bin");
  static dbPath = path.join(ChefInternal.Path, "db.json");
  static readDb = (): Record<string, string> => {
    let db;
    try {
      db = Deno.readTextFileSync(ChefInternal.dbPath);
    } catch {
      db = "{}";
    }
    return JSON.parse(db);
  };
  static list = () => {
    try {
      const dbData = JSON.parse(Deno.readTextFileSync(ChefInternal.dbPath));
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
        const db = ChefInternal.readDb();
        if (!binName) {
          ChefInternal.list();
          return;
        }
        if (!db[binName]) {
          console.error(
            `Unknown binary: %c${binName}`,
            `color: ${Colors.lightRed}`,
          );
          console.log("%c\nAvailable binaries:", `color: ${Colors.blueMarine}`);
          ChefInternal.list();
          return;
        }
        const binPath = path.join(ChefInternal.binPath, binName);
        const recipe = this.recipes.find((recipe) => recipe.name === binName);
        assert(recipe, "Recipe for this binary doesn't exist");

        let args = recipe.cmdPreDefinedArgs ? recipe.cmdPreDefinedArgs : [];
        args = args.concat(Deno.args.slice(2));

        await new Deno.Command(binPath, {
          args,
          stdin: "inherit",
        }).spawn().status;
        break;
      }
      case "list":
        ChefInternal.list();
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
    ChefInternal.list();
    console.log("");

    ensureDirSync(ChefInternal.binPath);
    const currentDb = ChefInternal.readDb();

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
        Deno.copyFileSync(tempBin, path.join(ChefInternal.binPath, name));
      });

      currentDb[name] = latestVersion;

      if (recipe.postInstall) {
        recipe.postInstall(path.join(ChefInternal.binPath, name));
      }

      console.log(
        `%c${name} ${latestVersion} was successfully updated`,
        "color: #00ff00",
      );
    }
    Deno.writeTextFileSync(ChefInternal.dbPath, JSON.stringify(currentDb));
  };
  edit = () => {
    const stack = new Error().stack!;
    const lines = stack.split("\n");
    const chef = lines[lines.length - 1];

    let chefPath = chef.split("at ")[1];

    chefPath = chefPath.slice(0, chefPath.lastIndexOf(":") - 3);
    console.log(chefPath);
  };
}

export class Chef {
  #chefInternal: ChefInternal;
  constructor() {
    this.#chefInternal = new ChefInternal();
  }

  static dbPath = ChefInternal.dbPath;
  static binPath = ChefInternal.binPath;

  add = (recipe: Recipe) => this.#chefInternal.add(recipe);
  addMany = (recipes: Recipe[]) => this.#chefInternal.addMany(recipes);
  run = () => this.#chefInternal.run();
}

export interface Recipe {
  name: string;
  cmd: ({ latestVersion }: { latestVersion: string }) => Promise<string>;
  version: () => Promise<string | undefined>;
  postInstall?: (binPath: string) => void;
  /**
      Pre-defined args, the user cli args will be appened after these
  **/
  cmdPreDefinedArgs?: string[];
}
