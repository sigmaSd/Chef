import * as path from "@std/path";
import { commandExists, getChefBasePath } from "./internal_utils.ts";
import type { Recipe } from "../mod.ts";
import { ChefDatabase } from "./database.ts";
import { DesktopFileManager } from "./desktop.ts";
import { BinaryRunner } from "./binary-runner.ts";
import { BinaryUpdater } from "./binary-updater.ts";
import { type CommandHandlers, parseAndExecute } from "./commands/commands.ts";
import denoJson from "../deno.json" with { type: "json" };
import { TextLineStream } from "@std/streams/text-line-stream";

interface ProviderSession {
  process: Deno.ChildProcess;
  writer: WritableStreamDefaultWriter<string>;
  pendingRequests: Map<string, (msg: unknown) => void>;
}

interface ProviderResponse {
  type?: string;
  data?: unknown;
  success?: boolean;
  error?: string;
}

/**
 * Main internal coordinator class for Chef
 * This class coordinates between all the different components
 */
export class ChefInternal {
  chefPath: string = Deno.mainModule;
  recipes: Recipe[] = [];
  private providerSessions: Map<string, ProviderSession> = new Map();

  // Get the script name for namespacing
  private get scriptName() {
    const name = this.chefPath.startsWith("file://")
      ? path.basename(path.fromFileUrl(this.chefPath))
      : path.basename(this.chefPath);
    return name ? path.basename(name, path.extname(name)) : "default";
  }

  private readonly basePath = getChefBasePath();

  get scriptDir() {
    return path.join(this.basePath, this.scriptName);
  }

  get binPath() {
    return path.join(this.scriptDir, "bin");
  }

  get iconsPath() {
    return path.join(this.scriptDir, "icons");
  }

  get dbPath() {
    return path.join(this.scriptDir, "db.json");
  }

  get exportsPath() {
    return path.join(this.basePath, "exports");
  }

  // Lazy initialization of service classes
  private _database?: ChefDatabase;
  private get database() {
    if (this._database) return this._database;
    Deno.mkdirSync(this.scriptDir, { recursive: true });
    return this._database = new ChefDatabase(this.dbPath, this.recipes);
  }

  private _desktopManager?: DesktopFileManager;
  private get desktopManager() {
    return this._desktopManager ??= new DesktopFileManager(
      this.iconsPath,
      this.chefPath,
      this.recipes,
    );
  }

  private _binaryRunner?: BinaryRunner;
  private get binaryRunner() {
    return this._binaryRunner ??= new BinaryRunner(
      this.binPath,
      this.database,
      this.recipes,
    );
  }

  private _binaryUpdater?: BinaryUpdater;
  private get binaryUpdater() {
    return this._binaryUpdater ??= new BinaryUpdater(
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
    return this.database.getProviders();
  };

  /**
   * Get or create a persistent session with a provider
   */
  private getProviderSession(
    name: string,
    commandStr: string,
  ): ProviderSession | null {
    if (this.providerSessions.has(name)) {
      return this.providerSessions.get(name)!;
    }

    try {
      const [cmd, ...args] = commandStr.split(" ");
      const finalArgs = [...args];
      if (!finalArgs.includes("--chef")) {
        finalArgs.push("--chef");
      }

      const command = new Deno.Command(cmd, {
        args: finalArgs,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      });

      const process = command.spawn();

      // Check if process is still alive after a short delay
      // This helps catch "Module not found" or "Command not found" errors immediately
      (async () => {
        try {
          const status = await process.status;
          if (!status.success) {
            this.providerSessions.delete(name);
          }
        } catch {
          this.providerSessions.delete(name);
        }
      })();

      const encoder = new TextEncoderStream();
      encoder.readable.pipeTo(process.stdin).catch((e) => {
        // Only log if it's not a broken pipe (which is expected if process exits)
        if (!(e instanceof Deno.errors.BrokenPipe)) {
          console.error(`Provider "${name}" stdin pipe error:`, e);
        }
        this.providerSessions.delete(name);
      });
      const writer = encoder.writable.getWriter();

      const stream = process.stdout
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());

      // Also consume stderr so it doesn't block, but log it if it's not empty
      (async () => {
        try {
          const stderrStream = process.stderr
            .pipeThrough(new TextDecoderStream())
            .pipeThrough(new TextLineStream());
          for await (const line of stderrStream) {
            if (line.trim()) {
              console.error(`Provider "${name}" stderr: ${line}`);
            }
          }
        } catch {
          // Ignore
        }
      })();

      const pendingRequests = new Map<string, (msg: unknown) => void>();
      const session: ProviderSession = { process, writer, pendingRequests };
      this.providerSessions.set(name, session);

      // Start background listener
      (async () => {
        try {
          for await (const line of stream) {
            if (!line || !line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (
                typeof msg === "object" && msg !== null && "id" in msg &&
                pendingRequests.has(msg.id as string)
              ) {
                const resolve = pendingRequests.get(msg.id as string)!;
                pendingRequests.delete(msg.id as string);
                resolve(msg);
              }
            } catch {
              // Ignore non-JSON
            }
          }
        } catch (e) {
          console.error(`Provider session "${name}" reader error:`, e);
        } finally {
          this.providerSessions.delete(name);
          // Reject all pending requests
          for (const resolve of pendingRequests.values()) {
            resolve({ success: false, error: "Provider session closed" });
          }
          pendingRequests.clear();
        }
      })();

      return session;
    } catch (e) {
      console.error(`Failed to start provider session for "${name}":`, e);
      return null;
    }
  }

  /**
   * Send a command to a provider and wait for response
   */
  private async callProvider(
    name: string,
    command: string,
    payload: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const provider = this.getProviders().find((p) => p.name === name);
    if (!provider) throw new Error(`Provider "${name}" not found`);

    const session = this.getProviderSession(provider.name, provider.command);
    if (!session) throw new Error(`Could not start provider "${name}"`);

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const id = crypto.randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    session.pendingRequests.set(id, resolve);

    const onAbort = () => {
      session.pendingRequests.delete(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);

    try {
      // Check if session is still alive before writing
      if (!this.providerSessions.has(name)) {
        throw new Error("Provider session closed");
      }
      await session.writer.write(
        JSON.stringify({ id, command, ...payload }) + "\n",
      );
      const result = await promise;
      return result;
    } catch (e) {
      session.pendingRequests.delete(id);
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        this.providerSessions.delete(name);
      }
      throw e;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Fetch recipes from all registered providers
   */
  getProviderRecipes = async (): Promise<Recipe[]> => {
    const providers = this.getProviders();
    const providerRecipes: Recipe[] = [];

    for (const provider of providers) {
      try {
        interface ProviderApp {
          name: string;
          group?: string;
          version: string;
          latestVersion: string;
          description?: string;
        }

        const msg = await this.callProvider(
          provider.name,
          "list",
        ) as ProviderResponse;

        if (msg.success === false) {
          console.error(
            `Failed to fetch recipes from provider "${provider.name}": ${
              msg.error || "Unknown error"
            }`,
          );
          continue;
        }

        if (msg.type !== "list") {
          console.error(`Unexpected response type from provider: ${msg.type}`);
          continue;
        }

        const apps: ProviderApp[] = msg.data as ProviderApp[];

        for (const app of apps) {
          providerRecipes.push(
            {
              name: app.name,
              provider: provider.name,
              description: app.description,
              _dynamic: true,
              _group: app.group,
              version: () => Promise.resolve(app.latestVersion),
              download: async ({ signal: _signal }) => {
                const msg = await this.callProvider(provider.name, "update", {
                  name: app.name,
                }) as ProviderResponse;

                if (!msg.success) {
                  throw new Error(`Update failed for ${app.name}`);
                }
                return { extern: app.name };
              },
              _currentVersion: app.version,
              _latestVersion: app.latestVersion,
            } as Recipe,
          );
        }
      } catch (error) {
        console.error(
          `Failed to fetch recipes from provider "${provider.name}":`,
          error,
        );
      }
    }

    return providerRecipes;
  };

  /**
   * Install or update a single binary
   */
  installOrUpdate = async (
    name: string,
    options: { force?: boolean; signal?: AbortSignal; dryRun?: boolean } = {},
  ) => {
    await this.binaryUpdater.update({
      force: options.force,
      binary: [name],
      signal: options.signal,
      dryRun: options.dryRun,
    });
    if (!options.dryRun) {
      await this.refreshRecipes();
    }
  };

  /**
   * Update all binaries
   */
  updateAll = async (
    options: { force?: boolean; signal?: AbortSignal; dryRun?: boolean } = {},
  ) => {
    await this.binaryUpdater.update(options);
    if (!options.dryRun) {
      await this.refreshRecipes();
    }
  };

  /**
   * Run a binary
   */
  runBin = (name: string, args: string[]) => {
    return this.binaryRunner.run(name, args);
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

    const terminalCommand = await this.getTerminalCommand();

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
   * Fetch recipes from all registered providers and add them to internal list
   */
  refreshRecipes = async () => {
    // Remove old provider recipes that were dynamically discovered
    const nativeRecipes = this.recipes.filter((r) =>
      !(r.provider && r._dynamic)
    );
    const providerRecipes = await this.getProviderRecipes();

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
  };

  /**
   * Check if a binary is installed
   */
  isInstalled = (name: string) => {
    const recipe = this.recipes.find((r) => r.name === name);
    if (recipe?.provider) {
      const r = recipe as Recipe & { _currentVersion?: string };
      return !!r._currentVersion && r._currentVersion !== "-";
    }
    return this.database.isInstalled(name);
  };

  /**
   * Get the installed version of a binary
   */
  getVersion = (name: string) => {
    const recipe = this.recipes.find((r) => r.name === name);
    if (recipe?.provider) {
      const r = recipe as Recipe & { _currentVersion?: string };
      return r._currentVersion;
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
      // Provider recipes are special
      const r = recipe as Recipe & {
        _currentVersion?: string;
        _latestVersion?: string;
      };
      const hasLatest = r._latestVersion && r._latestVersion !== "-";
      return {
        needsUpdate: !!(hasLatest && r._currentVersion !== r._latestVersion),
        currentVersion: r._currentVersion,
        latestVersion: r._latestVersion,
      };
    }

    return await this.binaryUpdater.needsUpdate(recipe);
  };

  /**
   * Main entry point - parse arguments and execute commands
   * Now throws parsing errors for caller to handle (exit or test)
   */
  start = async (args: string[]) => {
    const handlers: CommandHandlers = {
      run: async (name: string, binArgs: string[]) => {
        await this.refreshRecipes();
        const process = await this.binaryRunner.run(name, binArgs);
        if (process instanceof Deno.ChildProcess) {
          await process.status;
        }
      },
      list: async () => {
        await this.refreshRecipes();
        this.binaryRunner.list();
      },
      update: async (options) => {
        await this.refreshRecipes();
        if (options.only || (options.binary && options.binary.length > 0)) {
          const binaries = options.only ? [options.only] : options.binary!;
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
    for (const [name, session] of this.providerSessions) {
      try {
        await session.writer.close();
        await session.process.status;
      } catch (e) {
        console.error(`Error closing provider session "${name}":`, e);
      }
    }
    this.providerSessions.clear();
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
        const msg = await this.callProvider(
          recipe.provider,
          "remove",
          {
            name: name,
          },
          options.signal,
        ) as ProviderResponse;

        if (msg.success) {
          console.log(`✅ Successfully uninstalled "${name}"`);
          await this.refreshRecipes();
        } else {
          console.error(`❌ Failed to uninstall "${name}"`);
        }
      } catch (e) {
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

  /**
   * Get the configured editor command or default
   */
  getEditorCommand = (): string => {
    return this.database.getSetting("editorCommand") || (
      Deno.build.os === "windows"
        ? "start"
        : Deno.build.os === "darwin"
        ? "open"
        : "xdg-open"
    );
  };

  /**
   * Set the editor command
   */
  setEditorCommand = (command: string) => {
    this.database.setSetting("editorCommand", command);
  };

  /**
   * Get the configured terminal command or default
   */
  getTerminalCommand = async (): Promise<string> => {
    const saved = this.database.getSetting("terminalCommand");
    if (saved) return saved;

    if (Deno.build.os === "windows") return "cmd /c start";
    if (Deno.build.os === "darwin") return "open -a Terminal";

    const envTerminal = Deno.env.get("TERMINAL");
    if (envTerminal) return `${envTerminal} -e`;

    const commonTerminals = [
      { bin: "kgx", args: "--" },
      { bin: "gnome-terminal", args: "--" },
      { bin: "xfce4-terminal", args: "-e" },
      { bin: "konsole", args: "-e" },
      { bin: "x-terminal-emulator", args: "-e" },
      { bin: "alacritty", args: "-e" },
      { bin: "kitty", args: "" },
      { bin: "xterm", args: "-e" },
    ];

    for (const { bin, args } of commonTerminals) {
      if (await commandExists(bin)) {
        return `${bin} ${args}`.trim();
      }
    }

    return "xterm -e";
  };

  /**
   * Set the terminal command
   */
  setTerminalCommand = (command: string) => {
    this.database.setSetting("terminalCommand", command);
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
