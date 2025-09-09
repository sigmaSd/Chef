import * as path from "@std/path";
import { ensureDirSync } from "@std/fs";
import type { Recipe } from "../mod.ts";
import { Colors, copyDirRecursively, runInTempDir } from "./internal_utils.ts";
import type { ChefDatabase } from "./database.ts";
import { BinaryRunner } from "./binary-runner.ts";
import type { DesktopFileManager } from "./desktop.ts";

/**
 * Handles updating installed binaries
 */
export class BinaryUpdater {
  constructor(
    private binPath: string,
    private database: ChefDatabase,
    private recipes: Recipe[],
    private desktopManager?: DesktopFileManager,
  ) {}

  /**
   * Update binaries based on provided options
   */
  async update(
    options: {
      force?: boolean;
      skip?: string;
      only?: string;
      dryRun?: boolean;
    },
  ) {
    if (options.only && !this.recipes.find((r) => r.name === options.only)) {
      console.error(
        `%cBinary: ${options.only} is not installed`,
        "color:red",
      );
      return;
    }

    console.log("%cLooking for updates..", "color: magenta");
    console.log("%c\nAvailable binaries:", `color: ${Colors.blueMarine}`);

    const runner = new BinaryRunner(this.binPath, this.database, this.recipes);
    runner.list();
    console.log("");

    ensureDirSync(this.binPath);
    const currentDb = this.database.read().expect("failed to read database");

    for (const recipe of this.recipes) {
      if (options.only && recipe.name !== options.only) continue;

      console.log(`Updating %c${recipe.name}`, `color: ${Colors.lightYellow}`);

      const { name, version } = recipe;

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

      if (recipe.changeLog) {
        console.log(
          `%cChange log: ${recipe.changeLog({ latestVersion })}`,
          "color: #00ff00",
        );
      }

      if (options.dryRun) {
        console.log("skipping because of --dry-run");
        continue;
      }

      try {
        await this.downloadAndInstallBinary(recipe, latestVersion);
        currentDb[name] = latestVersion;

        if (recipe.postInstall) {
          recipe.postInstall(path.join(this.binPath, name));
        }

        // Automatically create desktop file if specified in recipe
        if (recipe.desktopFile && this.desktopManager) {
          try {
            await this.desktopManager.create(name, {});
          } catch (e) {
            console.warn(
              `%cFailed to create desktop file for ${name}: ${
                e instanceof Error ? e.message : e
              }`,
              `color: ${Colors.lightYellow}`,
            );
          }
        }

        console.log(
          `%c${name} ${latestVersion} was successfully updated`,
          "color: #00ff00",
        );
      } catch (e) {
        console.error(
          `%c${name} failed to update:`,
          "color: #ff0000",
        );
        console.error(e instanceof Error ? e.message : e);
        continue;
      }
    }

    this.database.write(currentDb);
  }

  /**
   * Download and install a binary
   */
  private async downloadAndInstallBinary(
    recipe: Recipe,
    latestVersion: string,
  ) {
    await runInTempDir(async () => {
      const tempBin = await recipe.download({ latestVersion });

      if ("dir" in tempBin) {
        const destDir = path.join(
          this.binPath,
          tempBin.dir.path === "." ? `${recipe.name}-dir` : tempBin.dir.path,
        );
        await copyDirRecursively(
          tempBin.dir.path,
          destDir,
        );
        // remove old symlink if it exists
        const symlinkPath = path.join(this.binPath, recipe.name);
        try {
          await Deno.remove(symlinkPath);
        } catch {
          // Ignore errors when removing old symlink
        }
        await Deno.symlink(
          path.join(destDir, tempBin.dir.exe),
          symlinkPath,
        );
      } else {
        await Deno.copyFile(tempBin.exe, path.join(this.binPath, recipe.name));
      }
    });
  }

  /**
   * Check if a binary needs updating
   */
  async needsUpdate(recipe: Recipe): Promise<{
    needsUpdate: boolean;
    currentVersion?: string;
    latestVersion?: string;
  }> {
    const currentVersion = this.database.getVersion(recipe.name);

    try {
      const latestVersion = await recipe.version();
      if (!latestVersion) {
        return { needsUpdate: false };
      }

      return {
        needsUpdate: currentVersion !== latestVersion,
        currentVersion,
        latestVersion,
      };
    } catch (e) {
      console.warn(`Failed to check version for ${recipe.name}:`, e);
      return { needsUpdate: false };
    }
  }

  /**
   * Get update information for all recipes
   */
  async getUpdateInfo(): Promise<
    Array<{
      name: string;
      currentVersion?: string;
      latestVersion?: string;
      needsUpdate: boolean;
    }>
  > {
    const results = [];

    for (const recipe of this.recipes) {
      const info = await this.needsUpdate(recipe);
      results.push({
        name: recipe.name,
        ...info,
      });
    }

    return results;
  }

  /**
   * Update a single binary by name
   */
  async updateSingle(name: string, options: { force?: boolean } = {}) {
    await this.update({
      only: name,
      force: options.force,
    });
  }
}
