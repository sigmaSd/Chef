/**
 * SDK for building Chef providers.
 *
 * This module provides the {@link ChefProvider} interface and the {@link runChefProvider}
 * function to help you build applications that can be integrated with Chef as external providers.
 *
 * @example
 * ```ts
 * import { runChefProvider } from "jsr:@sigmasd/chef/sdk";
 *
 * await runChefProvider({
 *   list: async () => [{ name: "my-app", version: "1.0.0" }],
 *   update: async ({ name, version }) => {
 *     console.error(`Installing ${name}@${version}`);
 *     return true;
 *   },
 *   remove: async (name) => {
 *     console.error(`Removing ${name}`);
 *     return true;
 *   },
 * });
 * ```
 *
 * @module
 */

import { TextLineStream } from "@std/streams/text-line-stream";

/**
 * Represents an application provided by an external provider.
 */
export interface ProviderApp {
  /** The name of the application. */
  name: string;
  /** Optional group name for categorizing applications. */
  group?: string;
  /** The currently installed version, or "-" if not installed. */
  version: string;
  /** The latest available version. */
  latestVersion?: string;
  /** A short description of the application. */
  description?: string;
  /** Whether the application supports listing multiple versions. */
  hasVersions?: boolean;
}

/**
 * Interface for implementing a Chef provider.
 */
export interface ChefProvider {
  /**
   * Lists all available applications from this provider.
   * @param signal - AbortSignal to cancel the request.
   */
  list: (signal: AbortSignal) => Promise<ProviderApp[]>;
  /**
   * Updates or installs an application.
   * @param options - Update options including name, version, and force flag.
   */
  update: (options: {
    name: string;
    version: string;
    force?: boolean;
    signal: AbortSignal;
  }) => Promise<boolean>;
  /**
   * Removes an application.
   * @param name - The name of the application to remove.
   * @param signal - AbortSignal to cancel the request.
   */
  remove: (name: string, signal: AbortSignal) => Promise<boolean>;
  /**
   * Optional: Retrieves all available versions of an application.
   * @param name - The name of the application.
   * @param page - Page number for pagination.
   * @param signal - AbortSignal to cancel the request.
   */
  versions?: (
    name: string,
    page: number,
    signal: AbortSignal,
  ) => Promise<string[]>;
}

/**
 * Runs the chef provider mode, which allows a CLI to act as a provider for chef.
 * Chef protocol is based on JSON messages over stdin/stdout.
 *
 * @param provider - The provider implementation.
 * @param options - Optional streams for testing.
 *
 * @example
 * ```ts
 * import { runChefProvider } from "jsr:@sigmasd/chef/sdk";
 *
 * await runChefProvider({
 *   list: async (signal) => {
 *     return [{ name: "my-app", version: "1.0.0", latestVersion: "1.1.0" }];
 *   },
 *   update: async ({ name, version, force, signal }) => {
 *     console.error(`Updating ${name} to ${version}`);
 *     return true;
 *   },
 *   remove: async (name, signal) => {
 *     console.error(`Removing ${name}`);
 *     return true;
 *   }
 * });
 * ```
 */
export async function runChefProvider(
  provider: ChefProvider,
  options: {
    stdin?: ReadableStream<Uint8Array>;
    stdout?: WritableStream<Uint8Array>;
  } = {},
): Promise<void> {
  const stdin = options.stdin ?? Deno.stdin.readable;
  const stdout = options.stdout ?? Deno.stdout.writable;
  const writer = stdout.getWriter();

  const lines = stdin
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());

  const activeRequests = new Map<string, AbortController>();

  const send = async (msg: unknown) => {
    await writer.write(new TextEncoder().encode(JSON.stringify(msg) + "\n"));
  };

  for await (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);
      const id = msg.id;

      if (msg.command === "cancel") {
        const targetId = msg.targetId;
        activeRequests.get(targetId)?.abort();
        continue;
      }

      // Process commands concurrently so we can receive "cancel" messages
      void (async () => {
        const controller = new AbortController();
        activeRequests.set(id, controller);
        const signal = controller.signal;

        try {
          if (msg.command === "list") {
            const data = await provider.list(signal);
            await send({ id, type: "list", data, success: true });
          } else if (msg.command === "update") {
            const success = await provider.update({
              name: msg.name,
              version: msg.version,
              force: msg.force,
              signal,
            });
            await send({ id, success });
          } else if (msg.command === "remove") {
            const success = await provider.remove(msg.name, signal);
            await send({ id, success });
          } else if (msg.command === "versions") {
            if (provider.versions) {
              const data = await provider.versions(
                msg.name,
                msg.page ?? 1,
                signal,
              );
              await send({ id, success: true, data });
            } else {
              await send({
                id,
                success: false,
                error: "versions command not supported",
              });
            }
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            // Silently ignore cancellation
          } else {
            console.error(`Chef SDK: Error processing ${msg.command}:`, e);
            await send({ id, success: false, error: String(e) });
          }
        } finally {
          activeRequests.delete(id);
        }
      })();
    } catch (e) {
      console.error("Chef SDK: Protocol error:", e);
    }
  }
}
