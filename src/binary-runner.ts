import * as path from "@std/path";
import { assert } from "@std/assert";
import type { Recipe } from "../mod.ts";
import type { ChefDatabase } from "./database.ts";
import {
  printTable,
  sectionHeader,
  spacer,
  statusMessage,
  Symbols,
  UIColors,
} from "./ui.ts";

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
      statusMessage("error", `Unknown binary: ${name}`);
      spacer();
      console.log(
        `%c${Symbols.info} Available binaries:`,
        `color: ${UIColors.info}; font-weight: bold`,
      );
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
   * List all installed and available binaries with improved formatting
   */
  list() {
    const dbData = this.database.read().expect("failed to read database");
    const installedBinaries = Object.entries(dbData);
    const availableToInstall = this.recipes.filter((recipe) =>
      !dbData[recipe.name]
    );

    if (installedBinaries.length === 0 && availableToInstall.length === 0) {
      statusMessage("warning", "No binaries configured");
      return;
    }

    // Show installed binaries in a table
    if (installedBinaries.length > 0) {
      sectionHeader("Installed Binaries");

      const headers = ["Name", "Version", "Status"];
      const rows = installedBinaries.map(([name, version]) => {
        const isExecutable = this.isInstalled(name);
        const status = isExecutable ? "Ready" : "Missing";
        return [name, version, status];
      });

      const colors = rows.map((row) =>
        row[2] === "Ready" ? UIColors.success : UIColors.warning
      );

      printTable(headers, rows, colors);
      spacer();
    }

    // Show available to install
    if (availableToInstall.length > 0) {
      sectionHeader("Available to Install");

      const headers = ["Name", "Description"];
      const rows = availableToInstall.map((recipe) => [
        recipe.name,
        "Available for installation",
      ]);

      printTable(headers, rows);
      spacer();

      console.log(
        `%c${Symbols.info} Run 'chef update' to install available binaries`,
        `color: ${UIColors.info}`,
      );
      spacer();
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
