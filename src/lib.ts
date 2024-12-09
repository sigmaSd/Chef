import * as path from "@std/path";
import { assert } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { Err, Ok, Result } from "@sigmasd/rust-types/result";
import { Option } from "@sigmasd/rust-types/option";
import { cacheDir } from "./internal_utils.ts";
import { Command } from "@cliffy/command";
import { Colors, copyDirRecursively, runInTempDir } from "./internal_utils.ts";
import type { Recipe } from "../mod.ts";

// Exported for tests, but this is internal
export class ChefInternal {
  Path = path.join(
    Option.wrap(cacheDir()).expect("cache dir not found"),
    "chef",
  );
  get BinPath() {
    return path.join(this.Path, "bin");
  }
  get dbPath() {
    return path.join(this.Path, "db.json");
  }
  readDb(): Result<Record<string, string>, unknown> {
    const db = Result
      .wrap(() => Deno.readTextFileSync(this.dbPath))
      .unwrapOr("{}");

    const dbParsed = Result.wrap(() =>
      JSON.parse(db) as Record<string, string>
    );
    if (dbParsed.isErr()) return Err(dbParsed.err);

    return Ok(Object.fromEntries(
      Object.entries(dbParsed.ok).filter(([name]) =>
        this.recipes.find((r) => r.name === name)
      ),
    ));
  }

  writeDb(db: Record<string, string>) {
    Result.wrap(() => Deno.writeTextFileSync(this.dbPath, JSON.stringify(db)))
      .expect(
        "failed to write to database",
      );
  }
  list() {
    const dbData = this.readDb().expect("failed to read database");
    for (const name of Object.keys(dbData)) {
      console.log(
        `%c${name} %c${dbData[name]}`,
        `color: ${Colors.lightYellow}`,
        `color: ${Colors.lightGreen}`,
      );
    }
  }

  recipes: Recipe[] = [];

  addMany = (recipes: Recipe[]) => {
    for (const recipe of recipes) this.add(recipe);
  };
  add = (recipe: Recipe) => {
    this.recipes.push(recipe);
  };

  run = async (name: string, binArgs: string[]) => {
    const binName = name;
    const db = this.readDb().expect("failed to read database");
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
    finalArgs = finalArgs.concat(binArgs);

    await new Deno.Command(binPath, {
      args: finalArgs,
      env: recipe.cmdEnv,
    }).spawn().status;
  };

  start = async (args: string[]) => {
    await new Command()
      .name("chef")
      .description("Manage random binaries")
      .action(function () {
        this.showHelp();
      })
      .command("run", "run a binary")
      .arguments("<name:string> [...binArgs]")
      .stopEarly()
      .action(async (_opts, name, ...binArgs) => await this.run(name, binArgs))
      .command("list", "list installed binaries")
      .action(() => this.list())
      .command("update", "update installed binaries")
      .option("--force", "force update a binary")
      .option("--skip <name:string>", "skip updating a binary")
      .option("--only <name:string>", "only update this binary")
      .option("--dry-run", "only look for new versions but don't update")
      .action(async (options) => await this.update(options))
      .command("edit", "output chef entry file")
      .action(() => console.log(this.edit()))
      .parse(args);
  };
  update = async (
    options: {
      force?: boolean;
      skip?: string;
      only?: string;
      dryRun?: boolean;
    },
  ) => {
    if (options.only && !this.recipes.find((r) => r.name === options.only)) {
      console.error(
        `%cBinary: ${options.only} is not installed`,
        "color:red",
      );
      return;
    }

    console.log("%cLooking for updates..", "color: magenta");
    console.log("%c\nAvailable binaries:", `color: ${Colors.blueMarine}`);
    this.list();
    console.log("");

    ensureDirSync(this.BinPath);
    const currentDb = this.readDb().expect("failed to read database");

    for (const recipe of this.recipes) {
      if (options.only && recipe.name !== options.only) continue;

      console.log(`Updating %c${recipe.name}`, `color: ${Colors.lightYellow}`);

      const { name, download, version } = recipe;

      if (options.skip && options.skip === name) {
        console.log(`%cskipping ${name}`, "color:red");
        continue;
      }

      const latestVersion = await version();
      if (!latestVersion) {
        console.warn("Chef was not able to get the latest version of", name);
        console.warn(`skipping ${name}`);
        continue;
      }
      const currentVersion = currentDb[name];
      if (!options.force && currentVersion === latestVersion) {
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

      if (options.dryRun) {
        console.log("skipping beacause of --dry-run");
        continue;
      }

      try {
        await runInTempDir(async () => {
          const tempBin = await download({ latestVersion });
          if (tempBin.dir) {
            await copyDirRecursively(
              tempBin.dir,
              path.join(this.BinPath, tempBin.dir),
            );
            // remove old symlink if it exists
            const symlinkPath = path.join(this.BinPath, name);
            try {
              await Deno.remove(symlinkPath);
            } catch {
              /**/
            }
            await Deno.symlink(
              path.join(this.BinPath, tempBin.exe),
              symlinkPath,
            );
          } else {
            await Deno.copyFile(tempBin.exe, path.join(this.BinPath, name));
          }
        });
      } catch (e) {
        console.error(
          `%c${name} failed to update:`,
          "color: #ff0000",
        );
        console.error(e instanceof Error ? e.message : e);
        continue;
      }

      currentDb[name] = latestVersion;

      if (recipe.postInstall) {
        recipe.postInstall(path.join(this.BinPath, name));
      }

      console.log(
        `%c${name} ${latestVersion} was successfully updated`,
        "color: #00ff00",
      );
    }
    this.writeDb(currentDb);
  };
  edit = () => {
    const stack = new Error().stack;

    const chef = stack
      ?.split("\n")
      .findLast((line) => line.includes("file:///"));

    if (!chef) return;

    // at file:///path/example.ts:126:1
    // at async file:///path/example.ts:126:1
    let chefPath = chef.split("at ")[1];
    if (chefPath.startsWith("async")) chefPath = chefPath.split("async ")[1];

    chefPath = chefPath.slice(
      0,
      chefPath.lastIndexOf(":", chefPath.lastIndexOf(":") - 1),
    );
    return chefPath;
  };
}
