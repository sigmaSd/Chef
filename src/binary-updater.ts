import * as path from "@std/path";
import { ensureDirSync } from "@std/fs";
import { pooledMap } from "@std/async/pool";
import type { Recipe } from "../mod.ts";
import { copyDirRecursively, runInTempDir } from "./internal_utils.ts";
import { setSignal } from "./dax_wrapper.ts";
import type { ChefDatabase } from "./database.ts";
import type { DesktopFileManager } from "./desktop.ts";
import {
  boxText,
  listItem,
  printTable,
  sectionHeader,
  spacer,
  statusMessage,
  Symbols,
  UIColors,
} from "./ui.ts";

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
      binary?: string[];
      signal?: AbortSignal;
    },
  ) {
    if (options.signal?.aborted) return;

    // Determine which binaries to update
    const targetBinaries = new Set<string>();

    if (options.only) {
      targetBinaries.add(options.only);
    } else if (options.binary && options.binary.length > 0) {
      options.binary.forEach((name) => targetBinaries.add(name));
    }

    // Validate that specified binaries exist
    for (const binaryName of targetBinaries) {
      if (!this.recipes.find((r) => r.name === binaryName)) {
        statusMessage("error", `Binary "${binaryName}" not found in recipes`);
        return;
      }
    }

    // Show header and current status
    sectionHeader("Checking for Updates");

    ensureDirSync(this.binPath);
    const currentDb = this.database.read().expect("failed to read database");

    // Collect update information with parallel processing
    const recipesToCheck = this.recipes.filter((recipe) =>
      targetBinaries.size === 0 || targetBinaries.has(recipe.name)
    );

    console.log(
      `%c🔄 Checking ${recipesToCheck.length} binaries in parallel...`,
      `color: ${UIColors.primary}`,
    );
    spacer();

    const updateInfo = [];

    // Process version checks in parallel with a pool of 5 concurrent operations
    const checkResults = pooledMap(
      5,
      recipesToCheck,
      async (recipe) => {
        if (options.signal?.aborted) {
          return {
            name: recipe.name,
            status: "skipped",
            reason: "cancelled",
          };
        }
        const { name, version } = recipe;

        if (options.skip && options.skip === name) {
          return {
            name,
            status: "skipped",
            reason: "explicitly skipped",
          };
        }

        try {
          // Optimization: Use cached versions from refreshRecipes if available
          let latestVersion = recipe._latestVersion || await version();
          const currentVersion = recipe._currentVersion ||
            currentDb[name]?.version;

          // If latest is missing but we have a current version, it's not an error
          if (!latestVersion || latestVersion === "-") {
            if (currentVersion && currentVersion !== "-") {
              latestVersion = currentVersion;
              return {
                name,
                currentVersion,
                latestVersion,
                status: "up-to-date",
              };
            }
            return {
              name,
              status: "error",
              reason: "unable to get latest version",
            };
          }

          if (!options.force && currentVersion === latestVersion) {
            return {
              name,
              currentVersion,
              latestVersion,
              status: "up-to-date",
            };
          }

          return {
            name,
            currentVersion,
            latestVersion,
            status: "needs-update",
            recipe,
          };
        } catch (e) {
          return {
            name,
            status: "error",
            reason: e instanceof Error ? e.message : "unknown error",
          };
        }
      },
    );

    // Collect all results
    for await (const result of checkResults) {
      updateInfo.push(result);
    }

    spacer();

    // Show update summary table
    if (updateInfo.length > 0) {
      sectionHeader("Update Summary");

      const headers = ["Binary", "Current", "Latest", "Status"];
      const rows = updateInfo.map((info) => [
        info.name,
        info.currentVersion || "Not installed",
        info.latestVersion || "Unknown",
        this.getStatusDisplay(info.status),
      ]);

      const colors = updateInfo.map((info) => this.getStatusColor(info.status));
      printTable(headers, rows, colors);
      spacer();
    }

    // Handle dry run
    if (options.dryRun) {
      statusMessage("info", "Dry run mode - no changes will be made");
      const toUpdate = updateInfo.filter((info) =>
        info.status === "needs-update"
      );
      if (toUpdate.length > 0) {
        console.log(
          `%c${Symbols.update} Would update ${toUpdate.length} binaries:`,
          `color: ${UIColors.info}`,
        );
        toUpdate.forEach((info) => {
          listItem(
            `${info.name}: ${info.currentVersion || "Not installed"} → ${
              info.latestVersion || "Unknown"
            }`,
            1,
            UIColors.warning,
          );
        });
      }
      return;
    }

    // Perform actual updates
    const toUpdate = updateInfo.filter((info) =>
      info.status === "needs-update"
    );
    if (toUpdate.length === 0) {
      statusMessage("success", "All binaries are up to date!");
      return;
    }

    sectionHeader("Installing Updates");

    let updated = 0;
    let failed = 0;

    // Process updates sequentially
    for (const info of toUpdate) {
      if (options.signal?.aborted) {
        statusMessage("info", "Update process cancelled");
        break;
      }
      const recipe = info.recipe as Recipe;
      const latestVersion = info.latestVersion;

      // Skip if no latest version (shouldn't happen for needs-update status)
      if (!latestVersion) {
        statusMessage("error", `No version available for ${info.name}`);
        failed++;
        spacer();
        continue;
      }

      try {
        console.log(
          `%c${Symbols.download} Updating ${info.name} (${
            info.currentVersion || "Not installed"
          } → ${latestVersion})`,
          `color: ${UIColors.warning}; font-weight: bold`,
        );

        if (recipe.changeLog) {
          const changeLogUrl = recipe.changeLog({
            latestVersion,
          });
          console.log(
            `%c  ${Symbols.info} Changelog: ${changeLogUrl}`,
            `color: ${UIColors.info}`,
          );
        }

        console.log(
          `%c  ${Symbols.download} Downloading ${recipe.name}...`,
          `color: ${UIColors.muted}`,
        );
        const installInfo = await this.downloadAndInstallBinary(
          recipe,
          latestVersion,
          options.signal,
        );

        if (recipe.postInstall && !installInfo.extern) {
          console.log(
            `%c  ${Symbols.run} Running post-install...`,
            `color: ${UIColors.muted}`,
          );
          recipe.postInstall(installInfo.binaryPath);
        }

        // Automatically create desktop file if specified in recipe
        if (recipe.desktopFile && this.desktopManager && !installInfo.extern) {
          try {
            console.log(
              `%c  ${Symbols.desktop} Creating desktop entry...`,
              `color: ${UIColors.muted}`,
            );
            await this.desktopManager.create(info.name, {});
          } catch (e) {
            statusMessage(
              "warning",
              `Failed to create desktop file: ${
                e instanceof Error ? e.message : e
              }`,
            );
          }
        }

        this.database.setEntry(info.name, {
          version: latestVersion,
          dir: installInfo.destDir,
          extern: installInfo.extern,
        });
        statusMessage(
          "success",
          `${info.name} ${latestVersion} installed successfully`,
        );
        updated++;
      } catch (e) {
        statusMessage(
          "error",
          `Failed to update ${info.name}: ${
            e instanceof Error ? e.message : "unknown error"
          }`,
        );
        failed++;
      }
      spacer();
    }

    // Final summary
    spacer();
    boxText(
      `Update Complete!\n\nUpdated: ${updated}\n${
        failed > 0 ? `Failed: ${failed}` : ""
      }`,
    );
  }

  private getStatusDisplay(status: string): string {
    switch (status) {
      case "up-to-date":
        return "Up to date";
      case "needs-update":
        return "Update available";
      case "skipped":
        return "Skipped";
      case "error":
        return "Error";
      default:
        return status;
    }
  }

  private getStatusColor(status: string): string {
    switch (status) {
      case "up-to-date":
        return UIColors.success;
      case "needs-update":
        return UIColors.warning;
      case "skipped":
        return UIColors.muted;
      case "error":
        return UIColors.error;
      default:
        return UIColors.bright;
    }
  }

  /**
   * Download and install a binary
   * @returns The installation info (path to binary and directory if it's a directory install)
   */
  private async downloadAndInstallBinary(
    recipe: Recipe,
    latestVersion: string,
    signal?: AbortSignal,
  ): Promise<{ binaryPath: string; destDir?: string; extern?: string }> {
    return await runInTempDir(async () => {
      setSignal(signal);
      const tempBin = await recipe.download({ latestVersion, signal }).finally(
        () => setSignal(undefined),
      );
      const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
      const binaryPath = path.join(this.binPath, recipe.name + exeExtension);

      // Clean up old version if it was a directory install tracked in DB
      const oldEntry = this.database.getEntry(recipe.name);
      if (oldEntry?.dir) {
        try {
          const oldDir = path.join(this.binPath, oldEntry.dir);
          await Deno.remove(oldDir, { recursive: true });
        } catch {
          // Ignore errors
        }
      }

      if ("extern" in tempBin) {
        return { binaryPath: "", extern: tempBin.extern };
      } else if ("dir" in tempBin) {
        const destDirName = tempBin.dir.path === "."
          ? `${recipe.name}-dir`
          : tempBin.dir.path;
        const destDir = path.join(this.binPath, destDirName);

        // Remove old directory and symlink if they exist (additional cleanup)
        try {
          await Deno.remove(destDir, { recursive: true });
        } catch {
          // Ignore
        }
        try {
          await Deno.remove(binaryPath);
        } catch {
          // Ignore
        }

        await copyDirRecursively(
          tempBin.dir.path,
          destDir,
        );
        await Deno.symlink(
          path.join(destDir, tempBin.dir.exe),
          binaryPath,
        );
        return { binaryPath, destDir: destDirName };
      } else {
        // Remove old binary if it exists to prevent permission errors
        try {
          await Deno.remove(binaryPath);
        } catch {
          // Ignore errors when removing old binary (e.g., if it doesn't exist)
        }
        await Deno.copyFile(tempBin.exe, binaryPath);
        return { binaryPath };
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
