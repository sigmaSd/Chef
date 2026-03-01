import { TextLineStream } from "@std/streams/text-line-stream";
import { expect } from "./utils.ts";
import type { Recipe } from "../mod.ts";
import type { ChefDatabase } from "./database.ts";

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
 * Manages external provider sessions and communications
 */
export class ProviderManager {
  #sessions: Map<string, ProviderSession> = new Map();
  #database: ChefDatabase;
  #recipes: Recipe[];

  constructor(
    database: ChefDatabase,
    recipes: Recipe[],
  ) {
    this.#database = database;
    this.#recipes = recipes;
  }

  /**
   * List all registered providers from database
   */
  getProviders() {
    return this.#database.getProviders();
  }

  /**
   * Get or create a persistent session with a provider
   */
  #getSession(
    name: string,
    commandStr: string,
  ): ProviderSession | null {
    if (this.#sessions.has(name)) {
      return this.#sessions.get(name) ?? expect("session not found");
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
      void (async () => {
        try {
          const status = await process.status;
          if (!status.success) {
            this.#sessions.delete(name);
          }
        } catch {
          this.#sessions.delete(name);
        }
      })();

      const encoder = new TextEncoderStream();
      void encoder.readable.pipeTo(process.stdin).catch((e) => {
        if (!(e instanceof Deno.errors.BrokenPipe)) {
          console.error(`Provider "${name}" stdin pipe error:`, e);
        }
        this.#sessions.delete(name);
      });
      const writer = encoder.writable.getWriter();

      const stream = process.stdout
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());

      void (async () => {
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
      this.#sessions.set(name, session);

      // Start background listener
      void (async () => {
        try {
          for await (const line of stream) {
            if (!line || !line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (
                typeof msg === "object" && msg !== null && "id" in msg &&
                pendingRequests.has(msg.id as unknown as string)
              ) {
                const resolve =
                  pendingRequests.get(msg.id as unknown as string) ??
                    expect("request not found");
                pendingRequests.delete(msg.id as unknown as string);
                resolve(msg);
              }
            } catch {
              // Ignore non-JSON
            }
          }
        } catch (e) {
          console.error(`Provider session "${name}" reader error:`, e);
        } finally {
          this.#sessions.delete(name);
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
  async callProvider(
    name: string,
    command: string,
    payload: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const provider = this.getProviders().find((p) => p.name === name);
    if (!provider) throw new Error(`Provider "${name}" not found`);

    const session = this.#getSession(provider.name, provider.command);
    if (!session) throw new Error(`Could not start provider "${name}"`);

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const id = crypto.randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    session.pendingRequests.set(id, resolve);

    const onAbort = () => {
      session.pendingRequests.delete(id);
      if (this.#sessions.has(name)) {
        session.writer.write(
          JSON.stringify({
            id: crypto.randomUUID(),
            command: "cancel",
            targetId: id,
          }) + "\n",
        ).catch(() => {});
      }
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);

    try {
      if (!this.#sessions.has(name)) {
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
        this.#sessions.delete(name);
      }
      throw e;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Fetch recipes from all registered providers
   */
  async getProviderRecipes(
    getVersionsFn: (
      name: string,
      options: { page?: number },
    ) => Promise<string[]>,
    signal?: AbortSignal,
  ): Promise<Recipe[]> {
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
          hasVersions?: boolean;
        }

        const msg = await this.callProvider(
          provider.name,
          "list",
          {},
          signal,
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
          const currentVersion = app.version ?? "-";
          const latestVersion = app.latestVersion ?? "-";

          const recipe: Recipe = {
            name: app.name,
            provider: provider.name,
            description: app.description,
            _dynamic: true,
            _group: app.group,
            version: () => Promise.resolve(latestVersion),
            download: async ({ latestVersion, signal, force }) => {
              const msg = await this.callProvider(provider.name, "update", {
                name: app.name,
                version: latestVersion,
                force,
              }, signal) as ProviderResponse;

              if (!msg.success) {
                throw new Error(
                  `Update failed for ${app.name}: ${
                    msg.error || "Unknown error"
                  }`,
                );
              }
              return { extern: app.name };
            },
            _currentVersion: currentVersion,
            _latestVersion: latestVersion,
          };

          if (app.hasVersions) {
            recipe.versions = (options) =>
              getVersionsFn(app.name, { page: options?.page });
          }

          providerRecipes.push(recipe);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        console.error(
          `Failed to fetch recipes from provider "${provider.name}":`,
          error,
        );
      }
    }

    return providerRecipes;
  }

  async cleanup() {
    for (const [name, session] of this.#sessions) {
      try {
        await session.writer.close();
        await session.process.status;
      } catch (e) {
        console.error(`Error closing provider session "${name}":`, e);
      }
    }
    this.#sessions.clear();
  }
}
