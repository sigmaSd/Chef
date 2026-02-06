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
 * - Automatically create desktop files for installed binaries when specified in recipes
 *
 * ## Usage
 *
 * Create a file for example **chef.ts** with:
 *
 * ```ts ignore
 * import { Chef } from "jsr:@sigmasd/chef";
 *
 * const chef = new Chef();
 *
 * chef.add({
 *   name: "binary1",
 *   download: async ({ latestVersion }) => {
 *     // a fuction that downloads the binary and return its relative path
 *     // Example: download and extract the binary, then return the path
 *     return { exe: "./path/to/binary" };
 *   },
 *   version: async () => {
 *     // a function that returns the latest version of the binary
 *     // Example: fetch version from GitHub releases, npm, etc.
 *     return "1.0.0";
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
 * - `chef link ${binary}` to create a symlink in the exports directory for easy PATH access
 * - Desktop files are created automatically during installation if specified in the recipe
 * - `chef desktop-file create ${binary} [--terminal] [--icon path or url]` to manually create or update a desktop file
 * - `chef desktop-file remove ${binary}` to remove a desktop file
 *
 * Checkout `bin` direcotry for more examples.
 *
 * @example
 * ```ts ignore
 * import { $, Chef } from "jsr:@sigmasd/chef";
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
    { latestVersion, signal }: { latestVersion: string; signal?: AbortSignal },
  ) => Promise<App>;
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
    /** Icon path or url, it will be automaticlly fetched and set as Icon field in the desktop entry */
    iconPath?: string;
    /** Terminal field in the desktop entry */
    terminal?: boolean;
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

if (import.meta.main) {
  const { printBanner, statusMessage, spacer, UIColors } = await import(
    "./src/ui.ts"
  );

  if (Deno.args.length === 0) {
    try {
      await Deno.stat("chef.ts");
      console.log(
        "%cchef.ts%c already exists in the current directory.",
        "color: yellow",
        "color: inherit",
      );
      console.log(
        "Run it with: %cdeno run -A chef.ts%c",
        "color: green",
        "color: inherit",
      );
      Deno.exit(0);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        throw err;
      }
    }

    printBanner();
    console.log(
      "%cChef: Personal Package Manager",
      `color: ${UIColors.primary}; font-weight: bold`,
    );
    console.log(
      "Chef helps you manage binaries that are not packaged by your distro.",
    );
    spacer();

    console.log(
      "To get started, you usually create a %cchef.ts%c file with your recipes.",
      "color: yellow",
      "color: inherit",
    );
    spacer();

    const shouldCreate = confirm(
      "Would you like to create a template chef.ts file in the current directory?",
    );

    if (shouldCreate) {
      const template = `
import { Chef, $ } from "jsr:@sigmasd/chef";
import { getLatestGithubRelease } from "jsr:@sigmasd/chef/utils";

const chef = new Chef();

chef.add({
  name: "irust",
  download: async ({ latestVersion }) => {
    await $.request(
      \`https://github.com/sigmaSd/IRust/releases/download/\${latestVersion}/irust-x86_64-unknown-linux-gnu\`,
    ).showProgress().pipeToPath();
    await Deno.chmod("./irust-x86_64-unknown-linux-gnu", 0o555);
    return {
      exe: "./irust-x86_64-unknown-linux-gnu",
    };
  },
  version: () => getLatestGithubRelease("sigmaSd/IRust"),
});

await chef.start(import.meta.url);
`.trim();

      try {
        await Deno.writeTextFile("chef.ts", template);
        statusMessage("success", "Created chef.ts");
        console.log(
          "You can now run it with: %cdeno run -A chef.ts%c",
          "color: green",
          "color: inherit",
        );
        spacer();
        console.log(
          "Recommended: Install it globally to use the 'chef' command:",
        );
        console.log(
          "%cdeno install -gA -n chef chef.ts%c",
          "color: cyan",
          "color: inherit",
        );
      } catch (err) {
        if (err instanceof Error) {
          statusMessage("error", `Failed to create chef.ts: ${err.message}`);
        }
      }
    } else {
      console.log(
        "Check out the documentation at: https://jsr.io/@sigmasd/chef",
      );
    }
  } else {
    const chef = new Chef();
    await chef.start();
  }
}
