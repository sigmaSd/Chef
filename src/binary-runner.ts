import * as path from "@std/path";
import { assert } from "@std/assert";
import type { Recipe } from "../mod.ts";
import { Colors } from "./internal_utils.ts";
import type { ChefDatabase } from "./database.ts";

/**
 * Handles running installed binaries
 */
export class BinaryRunner {
  constructor(
    private binPath: string,
    private database: ChefDatabase,
    private recipes: Recipe[],
  ) {}

  /**
   * Run a binary with the provided arguments
   */
  async run(name: string, binArgs: string[]) {
    const db = this.database.read().expect("failed to read database");
    if (!name) {
      this.list();
      return;
    }
    if (!db[name]) {
      console.error(
        `Unknown binary: %c${name}`,
        `color: ${Colors.lightRed}`,
      );
      console.log("%c\nAvailable binaries:", `color: ${Colors.blueMarine}`);
      this.list();
      return;
    }
    const binPath = path.join(this.binPath, name);
    const recipe = this.recipes.find((recipe) => recipe.name === name);
    assert(recipe, "Recipe for this binary doesn't exist");

    let finalArgs = recipe.cmdArgs ? recipe.cmdArgs : [];
    finalArgs = finalArgs.concat(binArgs);

    await new Deno.Command(binPath, {
      args: finalArgs,
      env: recipe.cmdEnv,
    }).spawn().status;
  }

  /**
   * List all installed and available binaries
   */
  list() {
    const dbData = this.database.read().expect("failed to read database");

    // Show installed binaries
    if (Object.keys(dbData).length > 0) {
      console.log("%cInstalled binaries:", `color: ${Colors.blueMarine}`);
      for (const name of Object.keys(dbData)) {
        console.log(
          `%c${name} %c${dbData[name]}`,
          `color: ${Colors.lightYellow}`,
          `color: ${Colors.lightGreen}`,
        );
      }
    }

    // Show available apps to install
    const availableToInstall = this.recipes.filter((recipe) =>
      !dbData[recipe.name]
    );
    if (availableToInstall.length > 0) {
      console.log("\nAvailable apps to install:");
      for (const recipe of availableToInstall) {
        console.log(
          `%c${recipe.name}`,
          `color: ${Colors.lightYellow}`,
        );
      }
    }

    if (Object.keys(dbData).length === 0 && availableToInstall.length === 0) {
      console.log("%cNo binaries configured", `color: ${Colors.lightRed}`);
    }
  }

  /**
   * Check if a binary is installed and executable
   */
  isInstalled(name: string): boolean {
    if (!this.database.isInstalled(name)) {
      return false;
    }

    try {
      const binPath = path.join(this.binPath, name);
      const stat = Deno.statSync(binPath);
      return stat.isFile;
    } catch {
      return false;
    }
  }

  /**
   * Get the path to an installed binary
   */
  getBinaryPath(name: string): string | null {
    if (!this.isInstalled(name)) {
      return null;
    }
    return path.join(this.binPath, name);
  }

  /**
   * Get all installed binaries with their paths
   */
  getInstalledBinaries(): Array<
    { name: string; path: string; version: string }
  > {
    const dbData = this.database.read().expect("failed to read database");
    return Object.entries(dbData)
      .filter(([name]) => this.isInstalled(name))
      .map(([name, version]) => ({
        name,
        path: path.join(this.binPath, name),
        version,
      }));
  }
}
