import * as path from "@std/path";
import { getChefBasePath } from "./internal_utils.ts";
import type { Recipe } from "../mod.ts";
import { ChefDatabase } from "./database.ts";
import { DesktopFileManager } from "./desktop.ts";
import { BinaryRunner } from "./binary-runner.ts";
import { BinaryUpdater } from "./binary-updater.ts";
import { type CommandHandlers, parseAndExecute } from "./commands/commands.ts";
import denoJson from "../deno.json" with { type: "json" };
import { ChefPaths } from "./paths.ts";
import { SettingsManager } from "./settings.ts";
import { ProviderManager } from "./providers.ts";

/**
 * Main internal coordinator class for Chef
 * This class coordinates between all the different components
 */
export class ChefInternal {
  chefPath: string = Deno.mainModule;
  recipes: Recipe[] = [];
  isBusy = false;

  #scriptName: string | null = null;
  #paths?: ChefPaths;
  #settings?: SettingsManager;
  #providers?: ProviderManager;

  async init(options: { paths?: ChefPaths } = {}) {
    if (this.#scriptName) return;

    const fullPath = this.chefPath.startsWith("file://")
      ? path.fromFileUrl(this.chefPath)
      : this.chefPath;

    const name = path.basename(fullPath, path.extname(fullPath)) || "default";

    // Use a hash of the full path to ensure uniqueness
    const data = new TextEncoder().encode(fullPath);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .slice(0, 4) // Use first 4 bytes for a short hash
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    this.#scriptName = `${name}-${hashHex}`;
    this.#paths = options.paths ??
      new ChefPaths(this.#scriptName, this.chefPath);
    this.#settings = new SettingsManager(this.database);
    this.#providers = new ProviderManager(this.database, this.recipes);
  }

  // Getters for extracted managers
  get paths(): ChefPaths {
    if (!this.#paths) throw new Error("ChefInternal not initialized");
    return this.#paths;
  }

  get settings(): SettingsManager {
    if (!this.#settings) throw new Error("ChefInternal not initialized");
    return this.#settings;
  }

  get providers(): ProviderManager {
    if (!this.#providers) throw new Error("ChefInternal not initialized");
    return this.#providers;
  }

  // Get the script name for namespacing
  get scriptName() {
    if (!this.#scriptName) {
      throw new Error("ChefInternal not initialized. Call init() first.");
    }
    return this.#scriptName;
  }

  /**
   * Get a valid appId for GTK based on the script name
   */
  getAppId = () => {
    const sanitized = this.scriptName
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^([0-9])/, "n$1");
    return `io.github.sigmasd.chef.${sanitized}`;
  };

  // Re-map path properties for backward compatibility within this class
  get scriptDir() {
    return this.paths.scriptDir;
  }
  get binPath() {
    return this.paths.binPath;
  }
  get iconsPath() {
    return this.paths.iconsPath;
  }
  get dbPath() {
    return this.paths.dbPath;
  }
  get exportsPath() {
    return this.paths.exportsPath;
  }

  // Lazy initialization of service classes
  #database?: ChefDatabase;
  private get database() {
    if (this.#database) return this.#database;
    const dbPath = this.#paths ? this.#paths.dbPath : path.join(
      getChefBasePath(),
      this.#scriptName || "default",
      "db.json",
    );
    Deno.mkdirSync(path.dirname(dbPath), { recursive: true });
    return this.#database = new ChefDatabase(dbPath, this.recipes);
  }

  #desktopManager?: DesktopFileManager;
  private get desktopManager() {
    return this.#desktopManager ??= new DesktopFileManager(
      this.iconsPath,
      this.chefPath,
      this.recipes,
      this.getAppId(),
      this.scriptName,
    );
  }

  #binaryRunner?: BinaryRunner;
  private get binaryRunner() {
    return this.#binaryRunner ??= new BinaryRunner(
      this.binPath,
      this.database,
      this.recipes,
    );
  }

  #binaryUpdater?: BinaryUpdater;
  private get binaryUpdater() {
    return this.#binaryUpdater ??= new BinaryUpdater(
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
    if (this.recipes.some((r) => r.name === recipe.name)) {
      throw new Error(`Recipe with name "${recipe.name}" already exists.`);
    }
    this.recipes.push(recipe);
  };

  /**
   * Add an external provider
   */
  addProvider = (name: string, command: string) => {
    this.database.addProvider({ name, command });
  };

  /**
   * Remove an external provider
   */
  removeProvider = (name: string) => {
    this.database.removeProvider(name);
  };

  /**
   * List all registered providers
   */
  getProviders = () => {
    return this.providers.getProviders();
  };

  /**
   * Fetch recipes from all registered providers and add them to internal list
   */
  refreshRecipes = async (signal?: AbortSignal) => {
    try {
      const nativeRecipes = this.recipes.filter((r) =>
        !(r.provider && r._dynamic)
      );
      const providerRecipes = await this.providers.getProviderRecipes(
        (name, opts) => this.getVersions(name, opts),
        signal,
      );

      // Name de-duplication: Native recipes always keep their name.
      // Provider recipes are prefixed if they collide with native or previous provider recipes.
      const seenNames = new Set(nativeRecipes.map((r) => r.name));
      for (const recipe of providerRecipes) {
        if (seenNames.has(recipe.name)) {
          const originalName = recipe.name;
          // Use - as separator for cross-platform compatibility
          recipe.name = `${recipe.provider}-${originalName}`;

          // Extreme edge case: what if the prefixed name also collides?
          let counter = 1;
          const basePrefixedName = recipe.name;
          while (seenNames.has(recipe.name)) {
            recipe.name = `${basePrefixedName}-${counter}`;
            counter++;
          }
          console.warn(
            `⚠️ Name collision: renamed provider app "${originalName}" to "${recipe.name}"`,
          );
        }
        seenNames.add(recipe.name);
      }

      this.recipes.splice(
        0,
        this.recipes.length,
        ...nativeRecipes,
        ...providerRecipes,
      );
      this.recipes.sort((a, b) => a.name.localeCompare(b.name));

      if (providerRecipes.length > 0) {
        console.log(
          `📡 Refreshed recipes: found ${providerRecipes.length} from providers`,
        );
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return;
      }
      throw e;
    }
  };

  /**
   * Install or update a single binary
   */
  installOrUpdate = async (
    name: string,
    options: {
      force?: boolean;
      signal?: AbortSignal;
      dryRun?: boolean;
      version?: string;
    } = {},
  ) => {
    await this.binaryUpdater.update({
      force: options.force,
      binary: [name],
      signal: options.signal,
      dryRun: options.dryRun,
      only: name,
      version: options.version,
    });
    if (!options.dryRun) {
      await this.refreshRecipes(options.signal);
    }
  };

  /**
   * Get all available versions of a binary
   */
  getVersions = async (
    name: string,
    options: { page?: number; signal?: AbortSignal } = {},
  ): Promise<string[]> => {
    const recipe = this.recipes.find((r) => r.name === name);
    if (!recipe) return [];

    if (recipe.provider) {
      try {
        const msg = await this.providers.callProvider(
          recipe.provider,
          "versions",
          {
            name: name,
            page: options.page,
          },
          options.signal,
        ) as { success: boolean; data: unknown };

        if (msg.success && Array.isArray(msg.data)) {
          return msg.data as string[];
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        console.error(
          `Failed to fetch versions from provider "${recipe.provider}":`,
          error,
        );
      }
      return [];
    }

    if (recipe.versions) {
      return await recipe.versions(options);
    }

    const latest = await recipe.version?.();
    return latest ? [latest] : [];
  };

  /**
   * Update all binaries
   */
  updateAll = async (
    options: { force?: boolean; signal?: AbortSignal; dryRun?: boolean } = {},
  ) => {
    await this.binaryUpdater.update(options);
    if (!options.dryRun) {
      await this.refreshRecipes(options.signal);
    }
  };

  /**
   * Run a binary
   */
  runBin = async (name: string, args: string[]) => {
    return await this.binaryRunner.run(name, args);
  };

  /**
   * Run a binary in a terminal
   */
  runInTerminal = async (name: string, args: string[]) => {
    const binPath = await this.binaryRunner.getBinaryPath(name);
    if (!binPath) return;

    const recipe = this.recipes.find((r) => r.name === name);
    let finalArgs = recipe?.cmdArgs ? [...recipe.cmdArgs] : [];
    finalArgs = finalArgs.concat(args);

    const terminalCommand = await this.settings.getTerminalCommand();
    const [termBin, ...termArgs] = terminalCommand.split(" ");

    try {
      const process = new Deno.Command(termBin, {
        args: [...termArgs, binPath, ...finalArgs],
      }).spawn();

      this.binaryRunner.trackProcess(name, process);
      return process;
    } catch (e) {
      console.error(`Failed to run in terminal: ${e}`);
    }
  };

  /**
   * Kill all running instances of a binary
   */
  killAll = (name: string) => {
    this.binaryRunner.killAll(name);
  };

  /**
   * Set a listener for binary status changes
   */
  setBinaryStatusListener = (
    listener: (name: string, running: boolean) => void,
  ) => {
    this.binaryRunner.setStatusListener(listener);
  };

  /**
   * Check if a binary is installed
   */
  isInstalled = (name: string) => {
    const recipe = this.recipes.find((r) => r.name === name);
    if (recipe?.provider) {
      return !!recipe._currentVersion && recipe._currentVersion !== "-";
    }
    return this.database.isInstalled(name);
  };

  /**
   * Get the installed version of a binary
   */
  getVersion = (name: string) => {
    const recipe = this.recipes.find((r) => r.name === name);
    if (recipe?.provider) {
      return recipe._currentVersion;
    }
    return this.database.getVersion(name);
  };

  /**
   * Check if a binary needs updating
   */
  checkUpdate = async (name: string) => {
    const recipe = this.recipes.find((r) => r.name === name);
    if (!recipe) return { needsUpdate: false };

    if (recipe.provider) {
      const current = recipe._currentVersion;
      const latest = recipe._latestVersion;
      const hasLatest = latest && latest !== "-";

      return {
        needsUpdate: !!(hasLatest && current !== latest),
        currentVersion: current ?? "-",
        latestVersion: latest ?? "-",
      };
    }

    const currentVersion = this.database.getVersion(recipe.name);
    try {
      let latestVersion = await recipe.version?.();

      if (!latestVersion && recipe.versions) {
        const all = await recipe.versions({ page: 1 });
        latestVersion = all[0];
      }

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
  };

  /**
   * Main entry point - parse arguments and execute commands
   */
  start = async (args: string[]) => {
    await this.init();
    const handlers: CommandHandlers = {
      run: async (name: string, binArgs: string[]) => {
        const isNative = this.recipes.some((r) => r.name === name);
        if (name && !isNative && !this.database.isInstalled(name)) {
          await this.refreshRecipes();
        }

        const process = await this.binaryRunner.run(name, binArgs);
        if (process instanceof Deno.ChildProcess) {
          await process.status;
        }
      },
      list: async () => {
        await this.refreshRecipes();
        await this.binaryRunner.list();
      },
      update: async (options) => {
        await this.refreshRecipes();
        if (options.only || (options.binary && options.binary.length > 0)) {
          const binaries = options.only ? [options.only] : options.binary ?? [];
          for (const name of binaries) {
            await this.installOrUpdate(name, {
              force: options.force,
              dryRun: options.dryRun,
            });
          }
        } else {
          await this.updateAll({
            force: options.force,
            dryRun: options.dryRun,
          });
        }
      },
      uninstall: async (binary) => {
        for (const name of binary) {
          await this.uninstall(name);
        }
      },
      edit: () => {
        return this.edit();
      },
      gui: async (options) => {
        if (options?.install) {
          await this.desktopManager.installGui();
          await this.cleanup();
          Deno.exit(0);
        }
        if (options?.uninstall) {
          this.desktopManager.uninstallGui();
          await this.cleanup();
          Deno.exit(0);
        }
        const { startGui } = await import("./gui.ts");
        await startGui(this);
        await this.cleanup();
        Deno.exit(0);
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
      providerAdd: (name, command) => {
        this.addProvider(name, command);
        console.log(`✅ Added provider "${name}"`);
      },
      providerRemove: (name) => {
        this.removeProvider(name);
        console.log(`✅ Removed provider "${name}"`);
      },
      providerList: () => {
        const providers = this.getProviders();
        if (providers.length === 0) {
          console.log("No providers registered.");
          return;
        }
        console.log("Registered Providers:");
        for (const p of providers) {
          console.log(`- ${p.name}: ${p.command}`);
        }
      },
    };

    await parseAndExecute(args, handlers);
  };

  /**
   * Close all provider sessions
   */
  cleanup = async () => {
    if (this.#providers) {
      await this.#providers.cleanup();
    }
  };

  /**
   * Uninstall a binary
   */
  uninstall = async (
    name: string,
    options: { signal?: AbortSignal } = {},
  ) => {
    const recipe = this.recipes.find((r) => r.name === name);
    if (recipe?.provider) {
      console.log(`🗑️ Uninstalling "${name}" (via ${recipe.provider})...`);
      try {
        const msg = await this.providers.callProvider(
          recipe.provider,
          "remove",
          {
            name: name,
          },
          options.signal,
        ) as { success: boolean };

        if (msg.success) {
          console.log(`✅ Successfully uninstalled "${name}"`);
          await this.refreshRecipes(options.signal);
        } else {
          console.error(`❌ Failed to uninstall "${name}"`);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        console.error(`Failed to uninstall ${name}:`, e);
      }
      return;
    }

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

    if (!entry.extern) {
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
    }

    // Remove from database
    this.database.removeBinary(name);

    console.log(`✅ Successfully uninstalled "${name}"`);
  };

  /**
   * Get the version of the Chef library being used
   */
  get chefVersion(): string {
    return denoJson.version;
  }

  /**
   * Get the path to the chef script for editing
   */
  edit = () => {
    if (this.chefPath.startsWith("file://")) {
      return path.fromFileUrl(this.chefPath);
    }
    return this.chefPath;
  };

  // Redirect settings methods to SettingsManager
  getEditorCommand = () => this.settings.getEditorCommand();
  setEditorCommand = (command: string) =>
    this.settings.setEditorCommand(command);
  getTerminalCommand = () => this.settings.getTerminalCommand();
  setTerminalCommand = (command: string) =>
    this.settings.setTerminalCommand(command);
  getStayInBackground = () => this.settings.getStayInBackground();
  setStayInBackground = (stay: boolean) =>
    this.settings.setStayInBackground(stay);
  getAutoUpdateCheck = () => this.settings.getAutoUpdateCheck();
  setAutoUpdateCheck = (auto: boolean) =>
    this.settings.setAutoUpdateCheck(auto);
  getBackgroundUpdateNotification = () =>
    this.settings.getBackgroundUpdateNotification();
  setBackgroundUpdateNotification = (notify: boolean) =>
    this.settings.setBackgroundUpdateNotification(notify);

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
      try {
        await Deno.remove(linkPath);
      } catch {
        // Ignore
      }

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
      const stat = await Deno.lstat(linkPath);
      if (!stat.isSymlink) {
        if (!options.silent) {
          console.error(`"${name}" exists but is not a symlink`);
        }
        return;
      }

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
