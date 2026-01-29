import * as path from "@std/path";
import { Option } from "@sigmasd/rust-types/option";
import type { Recipe } from "../mod.ts";
import { cacheDir } from "./internal_utils.ts";
import { ChefDatabase } from "./database.ts";
import { DesktopFileManager } from "./desktop.ts";
import { BinaryRunner } from "./binary-runner.ts";
import { BinaryUpdater } from "./binary-updater.ts";
import { type CommandHandlers, parseAndExecute } from "./commands/commands.ts";

/**
 * Main internal coordinator class for Chef
 * This class coordinates between all the different components
 */
export class ChefInternal {
  chefPath: string | undefined;
  recipes: Recipe[] = [];

  // Get the script name for namespacing
  private get scriptName() {
    return this.chefPath
      ? path.basename(this.chefPath, path.extname(this.chefPath))
      : "default";
  }

  private readonly basePath = path.join(
    Option.wrap(cacheDir()).expect("cache dir not found"),
    "chef",
  );

  get binPath() {
    return path.join(this.basePath, "bin", this.scriptName);
  }

  get iconsPath() {
    return path.join(this.basePath, "icons", this.scriptName);
  }

  get dbPath() {
    return path.join(this.basePath, `db_${this.scriptName}.json`);
  }

  get exportsPath() {
    return path.join(this.basePath, "exports");
  }

  // Lazy initialization of service classes
  private get database() {
    return new ChefDatabase(this.dbPath, this.recipes);
  }

  private get desktopManager() {
    return new DesktopFileManager(this.iconsPath, this.chefPath, this.recipes);
  }

  private get binaryRunner() {
    return new BinaryRunner(this.binPath, this.database, this.recipes);
  }

  private get binaryUpdater() {
    return new BinaryUpdater(
      this.binPath,
      this.database,
      this.recipes,
      this.desktopManager,
    );
  }

  /**
   * Add multiple recipes at once
   */
  addMany = (recipes: Recipe[]) => {
    for (const recipe of recipes) this.add(recipe);
  };

  /**
   * Add a single recipe
   */
  add = (recipe: Recipe) => {
    this.recipes.push(recipe);
  };

  /**
   * Main entry point - parse arguments and execute commands
   * Now throws parsing errors for caller to handle (exit or test)
   */
  start = async (args: string[]) => {
    const handlers: CommandHandlers = {
      run: async (name: string, binArgs: string[]) => {
        await this.binaryRunner.run(name, binArgs);
      },
      list: () => {
        this.binaryRunner.list();
      },
      update: async (options) => {
        await this.binaryUpdater.update(options);
      },
      uninstall: async (binary) => {
        for (const name of binary) {
          await this.uninstall(name);
        }
      },
      edit: () => {
        return this.edit();
      },
      createDesktop: async (name: string, options) => {
        await this.desktopManager.create(name, options);
      },
      removeDesktop: (name: string) => {
        this.desktopManager.remove(name);
      },
      link: async (name: string) => {
        await this.link(name);
      },
      unlink: async (name: string) => {
        await this.unlink(name);
      },
    };

    await parseAndExecute(args, handlers);
  };

  /**
   * Uninstall a binary
   */
  uninstall = async (name: string) => {
    const entry = this.database.getEntry(name);
    if (!entry) {
      console.error(`Binary "${name}" is not installed.`);
      return;
    }

    console.log(`🗑️ Uninstalling "${name}"...`);

    // Remove desktop file
    this.desktopManager.remove(name, { silent: true });

    // Remove symlink from exports
    await this.unlink(name, { silent: true });

    // Remove binary file
    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    const binaryPath = path.join(this.binPath, name + exeExtension);
    try {
      await Deno.remove(binaryPath);
    } catch {
      // Ignore
    }

    // Remove directory if it was a directory install
    if (entry.dir) {
      try {
        const dirPath = path.join(this.binPath, entry.dir);
        await Deno.remove(dirPath, { recursive: true });
      } catch {
        // Ignore
      }
    }

    // Remove from database
    this.database.removeBinary(name);

    console.log(`✅ Successfully uninstalled "${name}"`);
  };

  /**
   * Get the path to the chef script for editing
   */
  edit = () => {
    const stack = new Error().stack;

    const chef = stack
      ?.split("\n")
      .findLast((line) => line.includes("file:///"));

    if (!chef) return;

    // at file:///path/example.ts:126:1
    // at async file:///path/example.ts:126:1
    let chefPath = chef.split("at ")[1];
    if (chefPath.startsWith("async")) chefPath = chefPath.split("async ")[1];

    chefPath = chefPath.slice(
      0,
      chefPath.lastIndexOf(":", chefPath.lastIndexOf(":") - 1),
    );
    return chefPath;
  };

  /**
   * Create a symlink to a binary in the exports directory
   */
  link = async (name: string) => {
    const recipe = this.recipes.find((r) => r.name === name);
    if (!recipe) {
      console.error(`Recipe "${name}" not found`);
      return;
    }

    const db = this.database;
    if (!db.isInstalled(name)) {
      console.error(
        `Binary "${name}" is not installed. Run 'chef update' first.`,
      );
      return;
    }

    // Ensure exports directory exists
    await Deno.mkdir(this.exportsPath, { recursive: true });

    // Find the binary path
    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    const binaryPath = path.join(this.binPath, name + exeExtension);
    const linkPath = path.join(this.exportsPath, name + exeExtension);

    try {
      // Remove existing symlink if it exists
      try {
        await Deno.remove(linkPath);
      } catch {
        // Ignore if file doesn't exist
      }

      // Create symlink
      await Deno.symlink(binaryPath, linkPath);

      console.log(`✅ Created symlink for "${name}"`);
      console.log(`📂 Exports directory: ${this.exportsPath}`);
      console.log(`🔗 Symlink created: ${linkPath} -> ${binaryPath}`);
      console.log();
      console.log(
        `💡 To use "${name}" from anywhere, add exports to your PATH:`,
      );
      console.log(`   export PATH="${this.exportsPath}:$PATH"`);
      console.log();
      console.log(`📝 Add this line to your shell config file:`);
      console.log(`   ~/.bashrc, ~/.zshrc, ~/.config/fish/config.fish, etc.`);
    } catch (error) {
      console.error(`Failed to create symlink: ${error}`);
    }
  };

  /**
   * Remove a symlink from the exports directory
   */
  unlink = async (name: string, options: { silent?: boolean } = {}) => {
    const recipe = this.recipes.find((r) => r.name === name);
    if (!recipe) {
      if (!options.silent) console.error(`Recipe "${name}" not found`);
      return;
    }

    const exeExtension = Deno.build.os === "windows" ? ".exe" : "";
    const linkPath = path.join(this.exportsPath, name + exeExtension);

    try {
      // Check if the symlink exists
      const stat = await Deno.lstat(linkPath);
      if (!stat.isSymlink) {
        if (!options.silent) {
          console.error(`"${name}" exists but is not a symlink`);
        }
        return;
      }

      // Remove the symlink
      await Deno.remove(linkPath);

      if (!options.silent) {
        console.log(`✅ Removed symlink for "${name}"`);
        console.log(`📂 From: ${this.exportsPath}`);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        if (!options.silent) {
          console.error(`Symlink for "${name}" does not exist`);
        }
      } else {
        if (!options.silent) {
          console.error(`Failed to remove symlink: ${error}`);
        }
      }
    }
  };
}
