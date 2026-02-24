/**
 * # Chef
 *
 * Personal package manager
 *
 * ## Quick Start (No Config)
 *
 * Install Chef globally and use it immediately:
 *
 * ```bash
 * deno install -gA jsr:@sigmasd/chef
 *
 * # Start the GUI
 * chef gui
 *
 * # Install Chef as a desktop application
 * chef gui --install
 * ```
 *
 * ## Custom Recipes
 *
 * Create a file (e.g., **chef.ts**) to define your own binaries:
 *
 * ```ts
 * import { Chef, $ } from "jsr:@sigmasd/chef";
 * import { getLatestGithubRelease } from "jsr:@sigmasd/chef/utils";
 *
 * const chef = new Chef();
 *
 * chef.add({
 *   name: "irust",
 *   download: async ({ latestVersion }) => {
 *     await $.request(
 *       `https://github.com/sigmaSd/IRust/releases/download/${latestVersion}/irust-x86_64-unknown-linux-gnu`,
 *     ).showProgress().pipeToPath();
 *     await Deno.chmod("./irust-x86_64-unknown-linux-gnu", 0o555);
 *     return {
 *       exe: "./irust-x86_64-unknown-linux-gnu",
 *     };
 *   },
 *   version: () => getLatestGithubRelease("sigmaSd/IRust"),
 * });
 *
 * // The import.meta.url namespaces artifacts for this script
 * await chef.start(import.meta.url);
 * ```
 *
 * For a better experience, install your script globally:
 *
 * `deno install -gA -n chef chef.ts`
 *
 * ## Features
 *
 * - **Zero Config**: Works out of the box with a default recipes file.
 * - **GUI**: Modern GTK4 interface for visual management.
 * - **Desktop Integration**: Automatically creates `.desktop` files for your binaries.
 * - **External Providers**: Support for external package managers and custom binary sources.
 * - **Portable**: Recipes are just TypeScript files.
 *
 * @module
 */
import { isParseError } from "@sigma/parse";
import { ChefInternal } from "./src/lib.ts";

export { $ } from "./src/dax_wrapper.ts";

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
} | {
  /**
   * The name of the external application.
   * This app is managed externally and won't be run with chef run.
   */
  extern: string;
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
  download: (
    { latestVersion, signal, force }: {
      latestVersion: string;
      signal?: AbortSignal;
      force?: boolean;
    },
  ) => Promise<App>;
  /**
   * Retrieves the version of the binary.
   * @returns A promise that resolves to the version of the binary, if available.
   */
  version?: () => Promise<string | undefined>;
  /**
   * Retrieves all available versions of the binary.
   * @param options - Options for version retrieval (e.g. pagination).
   * @returns A promise that resolves to an array of available versions.
   */
  versions?: (options?: { page?: number }) => Promise<string[]>;
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
   * The name of the provider if this recipe comes from an external integration.
   */
  provider?: string;
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
    /** Icon path or url, it will be automaticlly fetched and set as Icon field in the desktop entry */
    iconPath?: string;
    /** Terminal field in the desktop entry */
    terminal?: boolean;
  };
  /** Description of the binary */
  description?: string;
  /** @internal */
  _dynamic?: boolean;
  /** @internal */
  _group?: string;
  /** @internal */
  _currentVersion?: string;
  /** @internal */
  _latestVersion?: string;
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
    } finally {
      await this.#chefInternal.cleanup();
    }
  };
}

if (import.meta.main) {
  if (Deno.build.standalone) {
    console.error(
      "Error: The Chef library (mod.ts) cannot be compiled directly.",
    );
    console.error(
      "To create a compiled binary, you should compile your recipe script (e.g., 'deno compile -A chef.ts')",
    );
    Deno.exit(1);
  }

  const { ensureDefaultChefFile } = await import("./src/internal_utils.ts");
  const path = await import("@std/path");

  const libUrl = import.meta.url;
  const utilsUrl = new URL("./src/utils.ts", libUrl).toString();

  const defaultChefPath = await ensureDefaultChefFile(libUrl, utilsUrl);

  const args = ["run", "-A"];

  // If running locally, pass the config file to the sub-process
  if (import.meta.url.startsWith("file://")) {
    const configPath = path.join(
      path.dirname(path.fromFileUrl(import.meta.url)),
      "deno.json",
    );
    try {
      await Deno.stat(configPath);
      args.push("--config", configPath);
    } catch {
      // Ignore
    }
  }

  args.push(defaultChefPath, ...Deno.args);

  const command = new Deno.Command(Deno.execPath(), {
    args,
  });

  const status = await command.spawn().status;
  Deno.exit(status.code);
}
