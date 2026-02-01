import {
  build$ as daxBuild$,
  CommandBuilder,
  KillController,
  RequestBuilder,
} from "@david/dax";
import type { $Type, RequestResponse } from "@david/dax";

export type CommandStatus = {
  status: "running" | "idle";
  command?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

/**
 * Bridges standard AbortSignal to dax's KillController.
 */
function abortSignalToKillSignal(signal: AbortSignal) {
  const controller = new KillController();
  if (signal.aborted) {
    controller.kill();
  } else {
    signal.addEventListener("abort", () => controller.kill(), { once: true });
  }
  return controller.signal;
}

// Map to track signals and metadata associated with builders without monkey-patching
const builderContext = new WeakMap<
  object,
  { signal?: AbortSignal; url?: string }
>();

/**
 * Encapsulates the state for a Chef execution context.
 */
export class ChefContext {
  private statusListener?: (status: CommandStatus) => void;
  private currentSignal?: AbortSignal;

  setStatusListener = (cb: (status: CommandStatus) => void) => {
    this.statusListener = cb;
  };

  setSignal = (signal: AbortSignal | undefined) => {
    this.currentSignal = signal;
  };

  getSignal = () => {
    return this.currentSignal;
  };

  get $(): $Type {
    const internal$ = daxBuild$({
      commandBuilder: (b) => {
        b.setPrintCommandLogger((cmd: string) => {
          if (this.statusListener) {
            this.statusListener({ status: "running", command: cmd });
          }
          console.log(`\x1b[2m$\x1b[0m ${cmd}`);
        });
        return b;
      },
    });

    return createProxy(internal$, this);
  }

  // Internal helpers for the proxy to notify the listener
  _notifyRunning(command?: string) {
    if (this.statusListener) {
      this.statusListener({ status: "running", command });
    }
  }

  _notifyIdle() {
    if (this.statusListener) {
      this.statusListener({ status: "idle" });
    }
  }

  _notifyProgress(command: string, loaded: number, total: number) {
    if (this.statusListener) {
      this.statusListener({
        status: "running",
        command,
        progress: loaded / total,
        loaded,
        total,
      });
    }
  }
}

const defaultContext = new ChefContext();

export const setStatusListener = defaultContext.setStatusListener;
export const setSignal = defaultContext.setSignal;
export const getSignal = defaultContext.getSignal;

/**
 * Creates a type-safe proxy around dax objects to intercept terminal methods
 * and propagate signals.
 */
// deno-lint-ignore no-explicit-any
function createProxy(target: any, context: ChefContext): any {
  return new Proxy(target, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // Special handling for the .request() method to track the URL
      if (prop === "request") {
        return (url: string | URL) => {
          const result = value.call(target, url);
          builderContext.set(result, {
            signal: context.getSignal(),
            url: url.toString(),
          });
          return createProxy(result, context);
        };
      }

      // Intercept fetch on RequestBuilder to apply signal
      if (prop === "fetch" && target instanceof RequestBuilder) {
        return async () => {
          const res = (await value.call(target)) as RequestResponse;
          const signal = builderContext.get(target)?.signal;
          if (signal) {
            if (signal.aborted) {
              res.abort();
              throw signal.reason;
            }
            signal.addEventListener("abort", () => res.abort(), {
              once: true,
            });
          }
          return res;
        };
      }

      // Custom implementation of pipeToPath with progress reporting
      if (prop === "pipeToPath") {
        return async (path?: string) => {
          const ctx = builderContext.get(target);
          const signal = ctx?.signal;

          if (signal?.aborted) throw signal.reason;

          let finalPath = path;
          if (!finalPath) {
            const urlStr = ctx?.url;
            if (!urlStr) {
              throw new Error(
                "Could not determine URL. Please provide a path.",
              );
            }
            const url = new URL(urlStr);
            finalPath = url.pathname.split("/").pop();
            if (!finalPath) {
              throw new Error(
                "Could not determine file name from URL. Please provide a path.",
              );
            }
          }

          context._notifyRunning(`Downloading to ${finalPath}...`);

          try {
            const response = await (target as RequestBuilder).fetch();
            if (!response.ok) {
              throw new Error(`Request failed with status ${response.status}`);
            }

            if (signal) {
              if (signal.aborted) {
                response.abort();
                throw signal.reason;
              }
              signal.addEventListener("abort", () => response.abort(), {
                once: true,
              });
            }

            const total = parseInt(
              response.headers.get("content-length") || "0",
              10,
            );
            let loaded = 0;

            const file = await Deno.open(finalPath, {
              write: true,
              create: true,
              truncate: true,
            });

            try {
              const body = response.readable;
              if (body) {
                const reader = body.getReader();
                while (true) {
                  if (signal?.aborted) {
                    response.abort();
                    throw signal.reason;
                  }
                  const { done, value } = await reader.read();
                  if (done) break;

                  loaded += value.length;
                  await file.write(value);

                  if (total > 0) {
                    context._notifyProgress(
                      `Downloading to ${finalPath}...`,
                      loaded,
                      total,
                    );
                  }
                }
              }
            } finally {
              file.close();
            }
          } finally {
            context._notifyIdle();
          }
        };
      }

      if (typeof value === "function") {
        return (...args: unknown[]) => {
          // Terminal methods that return a Promise
          const terminalMethods = [
            "json",
            "text",
            "bytes",
            "blob",
            "pipeTo",
            "response",
          ];
          const isTerminal = terminalMethods.includes(prop as string) ||
            prop === "then";

          if (isTerminal && prop !== "then") {
            // Trigger status for RequestBuilder methods (CommandBuilder uses logger)
            if (target instanceof RequestBuilder) {
              context._notifyRunning(
                `Fetching ${builderContext.get(target)?.url || "resource"}...`,
              );
            }
          }

          // Apply signal to the builder before execution
          if (target instanceof CommandBuilder) {
            const signal = builderContext.get(target)?.signal;
            if (signal) {
              target.signal(abortSignalToKillSignal(signal));
            }
          }

          const result = value.apply(target, args);

          // Wrap promises to handle "idle" status
          if (result instanceof Promise) {
            return result.finally(() => context._notifyIdle());
          }

          // Wrap returned builders for chaining
          if (
            result && typeof result === "object" &&
            (result instanceof CommandBuilder ||
              result instanceof RequestBuilder)
          ) {
            const parentCtx = builderContext.get(target);
            builderContext.set(result, {
              signal: parentCtx?.signal || context.getSignal(),
              url: parentCtx?.url,
            });
            return createProxy(result, context);
          }

          return result;
        };
      }

      return value;
    },
    apply(target, thisArg, argArray) {
      const result = Reflect.apply(target, thisArg, argArray);
      // This handles the template literal call: $`command`
      if (result instanceof CommandBuilder) {
        builderContext.set(result, { signal: context.getSignal() });
        return createProxy(result, context);
      }
      return result;
    },
  });
}

/**
 * The proxied dax instance exported for general use.
 */
export const $: $Type = defaultContext.$;
