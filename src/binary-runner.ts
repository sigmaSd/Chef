import * as path from "@std/path";
import { assert } from "@std/assert";
import type { Recipe } from "../mod.ts";
import type { ChefDatabase } from "./database.ts";
import { commandExists } from "./internal_utils.ts";
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
  async run(name: string, binArgs: string[]) {
    if (!name) {
      await this.list();
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
      await this.list();
      return;
    }

    let binPath: string;
    if (recipe.provider) {
      // For provider binaries, assume they are in PATH
      binPath = name;
    } else {
      const db = this.database.read().expect("failed to read database");
      if (!db[name]) {
        statusMessage("error", `Binary "${name}" is not installed.`);
        return;
      }
      const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
      binPath = path.join(this.binPath, name + exeExtension);
    }

    assert(recipe, "Recipe for this binary doesn't exist");

    let finalArgs = recipe.cmdArgs ? recipe.cmdArgs : [];
    finalArgs = finalArgs.concat(binArgs);

    const command = new Deno.Command(binPath, {
      args: finalArgs,
      env: recipe.cmdEnv,
    });
    const process = command.spawn();

    this.trackProcess(name, process);

    return process;
  }

  trackProcess(name: string, process: Deno.ChildProcess) {
    if (!this.activeProcesses.has(name)) {
      this.activeProcesses.set(name, new Set());
    }
    const processes = this.activeProcesses.get(name)!;
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
  async list() {
    const dbData = this.database.getInstalledBinaries();

    const installedBinaries = Object.entries(dbData);
    const availableToInstall = this.recipes.filter((recipe) =>
      !this.database.isInstalled(recipe.name)
    );

    if (installedBinaries.length === 0 && availableToInstall.length === 0) {
      statusMessage("info", "No binaries installed or available");
      return;
    }

    // Show installed binaries in a table
    if (installedBinaries.length > 0) {
      sectionHeader("Installed Binaries");

      const headers = ["Binary", "Version", "Status"];
      const rows = await Promise.all(
        installedBinaries.map(async ([name, entry]) => {
          const isExecutable = await this.isInstalled(name);
          return [
            name,
            entry.version,
            isExecutable ? "Ready" : "Not Found",
          ];
        }),
      );

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
        recipe.provider
          ? `(via ${recipe.provider})`
          : "Available for installation",
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
  async isInstalled(name: string): Promise<boolean> {
    const recipe = this.recipes.find((r) => r.name === name);
    if (recipe?.provider) {
      return await commandExists(name);
    }

    if (!this.database.isInstalled(name)) {
      return false;
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
    const dbData = this.database.read().expect("failed to read database");
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
