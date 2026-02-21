import * as path from "@std/path";
import { assert } from "@std/assert";
import type { Recipe } from "../mod.ts";
import type { ChefDatabase } from "./database.ts";
import { commandExists } from "./internal_utils.ts";
import { expect } from "./utils.ts";
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
  private statusListener?: (name: string, running: boolean) => void;
  private activeProcesses: Map<string, Set<Deno.ChildProcess>> = new Map();

  constructor(
    private binPath: string,
    private database: ChefDatabase,
    private recipes: Recipe[],
  ) {}

  setStatusListener(listener: (name: string, running: boolean) => void) {
    this.statusListener = listener;
  }

  notifyStatus(name: string, running: boolean) {
    this.statusListener?.(name, running);
  }

  /**
   * Run a binary with the provided arguments
   */
  run(name: string, binArgs: string[]) {
    if (!name) {
      this.list();
      return;
    }

    const recipe = this.recipes.find((recipe) => recipe.name === name);
    if (!recipe) {
      statusMessage("error", `Unknown binary: ${name}`);
      spacer();
      console.log(
        `%c${Symbols.info} Available binaries:`,
        `color: ${UIColors.info}; font-weight: bold`,
      );
      this.list();
      return;
    }

    let binPath: string;
    if (recipe.provider) {
      // For provider binaries, assume they are in PATH
      binPath = name;
    } else {
      const db = this.database.read() ?? expect("failed to read database");
      const entry = db[name];
      if (!entry) {
        statusMessage("error", `Binary "${name}" is not installed.`);
        return;
      }
      if (entry.extern) {
        binPath = entry.extern;
      } else {
        const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
        binPath = path.join(this.binPath, name + exeExtension);
      }
    }

    assert(recipe, "Recipe for this binary doesn't exist");

    let finalArgs = recipe.cmdArgs ? recipe.cmdArgs : [];
    finalArgs = finalArgs.concat(binArgs);

    try {
      const command = new Deno.Command(binPath, {
        args: finalArgs,
        env: recipe.cmdEnv,
      });
      const process = command.spawn();

      this.trackProcess(name, process);

      return process;
    } catch (e) {
      statusMessage(
        "error",
        `Failed to run ${name}: ${e instanceof Error ? e.message : e}`,
      );
      return;
    }
  }

  trackProcess(name: string, process: Deno.ChildProcess) {
    if (!this.activeProcesses.has(name)) {
      this.activeProcesses.set(name, new Set());
    }
    const processes = this.activeProcesses.get(name) ?? expect(
      "processes set not found",
    );
    processes.add(process);

    this.statusListener?.(name, true);

    process.status.then(() => {
      processes.delete(process);
      this.statusListener?.(name, false);
    });
  }

  killAll(name: string) {
    const processes = this.activeProcesses.get(name);
    if (processes) {
      for (const process of processes) {
        try {
          process.kill();
        } catch (e) {
          console.error(`Failed to kill process for ${name}:`, e);
        }
      }
    }
  }

  /**
   * List all installed and available binaries with improved formatting
   */
  list() {
    const allRecipes = this.recipes;
    if (allRecipes.length === 0) {
      statusMessage("info", "No binaries installed or available");
      return;
    }

    const recipesByProvider: Record<string, Recipe[]> = {};
    for (const recipe of allRecipes) {
      const provider = recipe.provider || "Chef";
      if (!recipesByProvider[provider]) recipesByProvider[provider] = [];
      recipesByProvider[provider].push(recipe);
    }

    const sortedProviders = Object.keys(recipesByProvider).sort((a, b) => {
      if (a === "Chef") return -1;
      if (b === "Chef") return 1;
      return a.localeCompare(b);
    });

    for (const provider of sortedProviders) {
      const recipes = recipesByProvider[provider].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      sectionHeader(`${provider} (${recipes.length})`);

      const headers = ["Binary", "Installed", "Latest", "Status"];
      const rows: string[][] = [];
      const rowColors: string[] = [];

      for (const recipe of recipes) {
        let installedVersion = "-";
        let latestVersion = "-";
        let status = "Available";
        let color: string = UIColors.muted;

        if (recipe.provider) {
          // Provider recipe
          installedVersion = recipe._currentVersion &&
              recipe._currentVersion !== "-"
            ? recipe._currentVersion
            : "-";
          latestVersion = recipe._latestVersion || "-";
        } else {
          // Native recipe
          installedVersion = this.database.getVersion(recipe.name) || "-";
          // We don't fetch latest version here to keep it fast
        }

        const isInstalled = installedVersion !== "-";
        if (isInstalled) {
          status = "Ready";
          color = UIColors.success;

          // Check for update if we have both versions
          if (
            latestVersion !== "-" && latestVersion !== "" &&
            installedVersion !== latestVersion
          ) {
            status = `Update Available ${Symbols.update}`;
            color = UIColors.warning;
          }
        }

        rows.push([
          recipe.name,
          installedVersion,
          latestVersion,
          status,
        ]);
        rowColors.push(color);
      }

      printTable(headers, rows, rowColors);
      spacer();
    }

    console.log(
      `%c${Symbols.info} Run 'chef update' to install available binaries`,
      `color: ${UIColors.info}`,
    );
    spacer();
  }

  /**
   * Check if a binary is installed and executable
   */
  async isInstalled(name: string): Promise<boolean> {
    const recipe = this.recipes.find((r) => r.name === name);
    if (recipe?.provider) {
      return await commandExists(name);
    }

    const entry = this.database.getEntry(name);
    if (!entry) {
      return false;
    }

    if (entry.extern) {
      return await commandExists(entry.extern);
    }

    try {
      const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
      const binPath = path.join(this.binPath, name + exeExtension);
      const stat = await Deno.stat(binPath);
      return stat.isFile;
    } catch {
      return false;
    }
  }

  /**
   * Get the path to an installed binary
   */
  async getBinaryPath(name: string): Promise<string | null> {
    if (!await this.isInstalled(name)) {
      return null;
    }

    const recipe = this.recipes.find((r) => r.name === name);
    if (recipe?.provider) {
      return name;
    }

    const entry = this.database.getEntry(name);
    if (entry?.extern) {
      return entry.extern;
    }

    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    return path.join(this.binPath, name + exeExtension);
  }

  /**
   * Get all installed binaries with their paths
   */
  async getInstalledBinaries(): Promise<
    Array<
      { name: string; path: string; version: string }
    >
  > {
    const dbData = this.database.read() ?? expect("failed to read database");
    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    const result = [];
    for (const [name, entry] of Object.entries(dbData)) {
      if (await this.isInstalled(name)) {
        result.push({
          name,
          path: path.join(this.binPath, name + exeExtension),
          version: entry.version,
        });
      }
    }
    return result;
  }
}
