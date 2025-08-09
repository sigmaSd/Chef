/**
 * # Chef
 *
 * Personal package manager
 *
 * ## Why it exists
 *
 * This is useful for those binaries that are not packaged by a distro.
 *
 * With chef you can:
 *
 * - Install a random binary
 * - Keep it up-to-date
 * - Run it
 * - Create desktop files for installed binaries
 *
 * ## Usage
 *
 * Create a file for example **chef.ts** with:
 *
 * ```typescript
 * import { Chef } from "jsr:@sigmasd/chef";
 *
 * const chef = new Chef();
 *
 * chef.add({
 *   name: "binary1",
 *   download: () => {
 *     // a fuction that downloads the binary and return its relative path
 *   },
 *   version: () => {
 *     // a function that returns the latest version of the binary
 *   },
 * });
 *
 * // The import.meta.url helps to namespace this script artifacts in its seprate path
 * // If not specifed it will use a default path
 * await chef.start(import.meta.url);
 * ```
 *
 * For a better experience install it with deno install (make sure `~/.deno/bin` is
 * in your path):
 *
 * `deno install -A -n chef chef.ts`
 *
 * You can now use:
 *
 * - `chef update` to update all binaries (or install it if it doesn't exist yet)
 * - `chef list` to list currently binaries
 * - `chef run ${binary} $args` to run one of the installed binaries
 * - `chef desktop-file create ${binary} [--terminal] [--icon path or url]` to create a desktop file
 * - `chef desktop-file remove ${binary}` to remove a desktop file
 *
 * Checkout `bin` direcotry for more examples.
 *
 * @example
 * ```ts
 * import { $ } from "jsr:@david/dax@0.39.2";
 * import { Chef } from "jsr:@sigmasd/chef";
 * import {
 *   getLatestGithubRelease,
 *   getLatestNpmVersion,
 * } from "jsr:@sigmasd/chef/utils";
 *
 * if (import.meta.main) {
 *   const chef = new Chef();
 *   chef.addMany(
 *     [
 *       {
 *         name: "slint-lsp",
 *         download: async () => {
 *           await $.request(
 *             "https://github.com/slint-ui/slint/releases/download/v1.5.1/slint-lsp-linux.tar.gz",
 *           ).pipeToPath();
 *           await $`tar -xzf slint-lsp-linux.tar.gz`;
 *           return {
 *             exe: "./slint-lsp/slint-lsp",
 *           };
 *         },
 *         version: () => getLatestGithubRelease("slint-ui/slint"),
 *       },
 *       {
 *         name: "typescript-language-server",
 *         download: async () => {
 *           await $`npm install typescript-language-server`;
 *           return {
 *             dir: {
 *               path: ".",
 *               exe: "./node_modules/typescript-language-server/lib/cli.mjs"
 *             }
 *           };
 *         },
 *         version: () => getLatestNpmVersion("typescript-language-server"),
 *       },
 *     ],
 *   );
 *   await chef.start(import.meta.url);
 * }
 *
 * ```
 * @module
 */
import { isParseError } from "@sigma/parse";
import { ChefInternal } from "./src/lib.ts";

/**
 * Represents an application.
 */
export type App = {
  /** The path of the executable. */
  exe: string;
} | {
  /**
   * Contains directory path and executable path
   * Useful when the binary needs its parent directory
   */
  dir: {
    /** The path to the directory */
    path: string;
    /** The path to the executable relative to the directory */
    exe: string;
  };
};

/**
 * Represents a recipe for managing binaries.
 */
export interface Recipe {
  /** Name of the binary */
  name: string;
  /**
   * Downloads the binary.
   * @param latestVersion - The latest version of the binary.
   * @returns A promise that resolves to the downloaded App.
   */
  download: ({ latestVersion }: { latestVersion: string }) => Promise<App>;
  /**
   * Retrieves the version of the binary.
   * @returns A promise that resolves to the version of the binary, if available.
   */
  version: () => Promise<string | undefined>;
  /**
   * Performs actions after installing the binary.
   * @param binPath - The path to the installed binary.
   */
  postInstall?: (binPath: string) => void;
  /**
   * Pre-defined arguments, the user CLI args will be appended after these.
   */
  cmdArgs?: string[];
  /**
   * Pre-defined environment variables
   */
  cmdEnv?: Record<string, string>;
  /** Change log URL */
  changeLog?: ({ latestVersion }: { latestVersion: string }) => string;
  /**
   * Desktop file configuration
   */
  desktopFile?: {
    /** Name field in the desktop entry */
    name?: string;
    /** Comment field in the desktop entry */
    comment?: string;
    /** Categories field in the desktop entry */
    categories?: string;
    /** Icon field in the desktop entry */
    icon?: string;
  };
}

/**
 * Main class to manage binaries
 */
export class Chef {
  #chefInternal: ChefInternal;
  constructor() {
    this.#chefInternal = new ChefInternal();
  }

  /**
   * Adds a recipe to manage a binary.
   * @param recipe - The recipe to add.
   */
  add = (recipe: Recipe): void => this.#chefInternal.add(recipe);
  /**
   * Adds multiple recipes to manage binaries.
   * @param recipes - The recipes to add.
   */
  addMany = (recipes: Recipe[]): void => this.#chefInternal.addMany(recipes);
  /**
   * Starts the Chef command-line interface.
   */
  start = async (chefPath?: string): Promise<void> => {
    if (chefPath) {
      this.#chefInternal.chefPath = chefPath;
    }

    try {
      await this.#chefInternal.start(Deno.args);
    } catch (error) {
      // Handle parsing errors with proper exit codes
      if (isParseError(error)) {
        // ParseError has proper exit codes (0 for help, 1+ for errors)
        console.error(`Chef: ${error.message}`);
        Deno.exit(error.exitCode);
      }
      // Handle other unexpected errors
      if (error instanceof Error) {
        console.error(`Chef failed: ${error.message}`);
      } else {
        console.error("Chef failed with unknown error:", error);
      }
      Deno.exit(1);
    }
  };
}
