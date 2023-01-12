import { assert, cache_dir, ensureDirSync, path } from "./deps.ts";
import { Colors, copyDirRecursively, runInTempDir } from "./internal_utils.ts";

export class ChefInternal {
  Path = path.join(cache_dir()!, "chef");
  get BinPath() {
    return path.join(this.Path, "bin");
  }
  get dbPath() {
    return path.join(this.Path, "db.json");
  }
  readDb() {
    let db;
    try {
      db = Deno.readTextFileSync(this.dbPath);
    } catch {
      db = "{}";
    }
    return JSON.parse(db);
  }
  list() {
    try {
      const dbData = JSON.parse(Deno.readTextFileSync(this.dbPath));
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
  }

  recipes: Recipe[] = [];

  addMany = (recipes: Recipe[]) => {
    recipes.forEach((recipe) => this.add(recipe));
  };
  add = (recipe: Recipe) => {
    this.recipes.push(recipe);
  };
  run = async (args: string[]) => {
    const cmd = args[0];
    switch (cmd) {
      case "run": {
        const binName = args[1];
        const db = this.readDb();
        if (!binName) {
          this.list();
          return;
        }
        if (!db[binName]) {
          console.error(
            `Unknown binary: %c${binName}`,
            `color: ${Colors.lightRed}`,
          );
          console.log("%c\nAvailable binaries:", `color: ${Colors.blueMarine}`);
          this.list();
          return;
        }
        const binPath = path.join(this.BinPath, binName);
        const recipe = this.recipes.find((recipe) => recipe.name === binName);
        assert(recipe, "Recipe for this binary doesn't exist");

        let finalArgs = recipe.cmdArgs ? recipe.cmdArgs : [];
        finalArgs = finalArgs.concat(args.slice(2));

        await new Deno.Command(binPath, {
          args: finalArgs,
          stdin: "inherit",
          env: recipe.cmdEnv,
        }).spawn().status;
        break;
      }
      case "list":
        this.list();
        break;
      case "update":
      case undefined:
        await this.update();
        break;
      case "edit":
        console.log(this.edit());
        break;
      default:
        console.error(`Unknown command %c${cmd}`, `color: ${Colors.lightRed}`);
    }
  };
  update = async () => {
    console.log(`%cLooking for updates..`, `color: magenta`);
    console.log("%c\nAvailable binaries:", `color: ${Colors.blueMarine}`);
    this.list();
    console.log("");

    ensureDirSync(this.BinPath);
    const currentDb = this.readDb();

    const force = Deno.args.includes("--force");
    const maybeTarget = Deno.args[1];
    for (const recipe of this.recipes) {
      if (maybeTarget && recipe.name !== maybeTarget) continue;

      console.log(`Updating %c${recipe.name}`, `color: ${Colors.lightYellow}`);

      const { name, download, version } = recipe;
      const latestVersion = await version();
      if (!latestVersion) {
        console.warn("Chef was not able to get the latest version of", name);
        console.warn(`skipping ${name}`);
        continue;
      }
      const currentVersion = currentDb[name];
      if (!force && currentVersion === latestVersion) {
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
        const tempBin = await download({ latestVersion });
        if (tempBin.dir) {
          await copyDirRecursively(
            tempBin.dir,
            path.join(this.BinPath, tempBin.dir),
          );
          await Deno.symlink(
            path.join(
              this.BinPath,
              tempBin.exe,
            ),
            path.join(this.BinPath, name),
          );
        } else {
          await Deno.copyFile(tempBin.exe, path.join(this.BinPath, name));
        }
      });

      currentDb[name] = latestVersion;

      if (recipe.postInstall) {
        recipe.postInstall(path.join(this.BinPath, name));
      }

      console.log(
        `%c${name} ${latestVersion} was successfully updated`,
        "color: #00ff00",
      );
    }
    Deno.writeTextFileSync(this.dbPath, JSON.stringify(currentDb));
  };
  edit = () => {
    const stack = new Error().stack!;

    const chef = stack.split("\n").findLast((line) =>
      line.includes("file:///")
    );

    if (!chef) return;

    let chefPath = chef.split("at ")[1];

    chefPath = chefPath.slice(0, chefPath.lastIndexOf(":") - 3);
    return chefPath;
  };
}

export class Chef {
  #chefInternal: ChefInternal;
  constructor() {
    this.#chefInternal = new ChefInternal();
  }

  add = (recipe: Recipe) => this.#chefInternal.add(recipe);
  addMany = (recipes: Recipe[]) => this.#chefInternal.addMany(recipes);
  run = () => this.#chefInternal.run(Deno.args);
}

export interface App {
  /** The path of the executable */
  exe: string;
  /** If the executable needs the parent directory
   * you can specify it with dir */
  dir?: string;
}

export interface Recipe {
  name: string;
  download: (
    { latestVersion }: { latestVersion: string },
  ) => Promise<App>;
  version: () => Promise<string | undefined>;
  postInstall?: (binPath: string) => void;
  /**
      Pre-defined args, the user cli args will be appened after these
  **/
  cmdArgs?: string[];
  cmdEnv?: Record<string, string>;
}
