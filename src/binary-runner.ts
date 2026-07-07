import * as path from "@std/path";
import type { Recipe } from "../mod.ts";
import type { ChefDatabase, DbEntry } from "./database.ts";
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
   * Split a namespaced name like "parent/sub" into { parentName, subName }.
   * Returns parentName only if there's no slash.
   */
  static parseSubName(name: string): { parentName: string; subName?: string } {
    const idx = name.indexOf("/");
    if (idx === -1) return { parentName: name };
    return { parentName: name.slice(0, idx), subName: name.slice(idx + 1) };
  }

  /**
   * Run a binary with the provided arguments
   */
  async run(name: string, binArgs: string[]) {
    if (!name) {
      await this.list();
      return;
    }

    const { parentName, subName } = BinaryRunner.parseSubName(name);
    const db = this.database.read();
    const entry = db[parentName];

    // For sub-binaries, the recipe is matched by parent name
    const recipeKey = subName ? parentName : name;
    const recipe = this.recipes.find((r) => r.name === recipeKey);
    const dbEntry = entry as DbEntry | undefined;

    if (!recipe && !dbEntry) {
      statusMessage("error", `Unknown binary: ${name}`);
      spacer();
      console.log(
        `%c${Symbols.info} Available binaries:`,
        `color: ${UIColors.info}; font-weight: bold`,
      );
      await this.list();
      return;
    }

    let binPath: string;
    if (recipe?.provider) {
      binPath = name;
    } else if (!dbEntry) {
      statusMessage("error", `Binary "${name}" is not installed.`);
      return;
    } else if (dbEntry.extern) {
      binPath = dbEntry.extern;
    } else if (!subName && dbEntry.subBinaries?.length) {
      spacer();
      console.log(
        `%c${parentName} has multiple binaries:`,
        `color: ${UIColors.info}; font-weight: bold`,
      );
      for (const sub of dbEntry.subBinaries) {
        console.log(
          `%c  ${Symbols.arrow} ${parentName}/${sub}`,
          `color: ${UIColors.bright}`,
        );
      }
      spacer();
      console.log(
        `%c${Symbols.info} Run one with: chef run ${parentName}/<binary>`,
        `color: ${UIColors.info}`,
      );
      spacer();
      return;
    } else {
      const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
      binPath = subName
        ? path.join(this.binPath, `${parentName}-${subName}${exeExtension}`)
        : path.join(this.binPath, name + exeExtension);
    }

    let finalArgs = recipe?.cmdArgs ? recipe.cmdArgs : [];
    finalArgs = finalArgs.concat(binArgs);

    try {
      const command = new Deno.Command(binPath, {
        args: finalArgs,
        env: recipe?.cmdEnv,
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

    void process.status.then(() => {
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
          installedVersion = recipe._currentVersion &&
              recipe._currentVersion !== "-"
            ? recipe._currentVersion
            : "-";
          latestVersion = recipe._latestVersion || "-";
        } else {
          installedVersion = recipe._currentVersion ||
            this.database.getVersion(recipe.name) || "-";
          latestVersion = recipe._latestVersion || "-";
        }

        const isInstalled = installedVersion !== "-";
        if (isInstalled) {
          status = "Ready";
          color = UIColors.success;

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
    const { parentName, subName } = BinaryRunner.parseSubName(name);
    const recipe = this.recipes.find((r) => r.name === parentName);
    if (recipe?.provider) {
      return await commandExists(name);
    }

    const entry = this.database.getEntry(parentName);
    if (!entry) return false;

    if (subName) {
      return Array.isArray(entry.subBinaries) &&
        entry.subBinaries.includes(subName);
    }

    if (entry.extern) return await commandExists(entry.extern);

    try {
      const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
      const binPath = path.join(this.binPath, name + exeExtension);
      const stat = await Deno.stat(binPath);
      return stat.isFile || stat.isSymlink;
    } catch {
      return false;
    }
  }

  /**
   * Get the path to an installed binary
   */
  async getBinaryPath(name: string): Promise<string | null> {
    const { parentName, subName } = BinaryRunner.parseSubName(name);

    if (!await this.isInstalled(name)) return null;

    const recipe = this.recipes.find((r) => r.name === parentName);
    if (recipe?.provider) return name;

    const entry = this.database.getEntry(parentName);
    if (entry?.extern) return entry.extern;

    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    return subName
      ? path.join(this.binPath, `${parentName}-${subName}${exeExtension}`)
      : path.join(this.binPath, name + exeExtension);
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
