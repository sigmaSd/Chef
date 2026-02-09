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

    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    const binPath = path.join(this.binPath, name + exeExtension);
    const recipe = this.recipes.find((recipe) => recipe.name === name);
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
  list() {
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
      const rows = installedBinaries.map(([name, entry]) => {
        const isExecutable = this.isInstalled(name);
        return [
          name,
          entry.version,
          isExecutable ? "Ready" : "Not Found",
        ];
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
      const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
      const binPath = path.join(this.binPath, name + exeExtension);
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
    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    return path.join(this.binPath, name + exeExtension);
  }

  /**
   * Get all installed binaries with their paths
   */
  getInstalledBinaries(): Array<
    { name: string; path: string; version: string }
  > {
    const dbData = this.database.read().expect("failed to read database");
    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    return Object.entries(dbData)
      .filter(([name]) => this.isInstalled(name))
      .map(([name, entry]) => ({
        name,
        path: path.join(this.binPath, name + exeExtension),
        version: entry.version,
      }));
  }
}
