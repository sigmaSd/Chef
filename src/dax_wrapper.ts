import {
  build$ as daxBuild$,
  CommandBuilder,
  RequestBuilder,
} from "@david/dax";
import type { $Type } from "@david/dax";

export type CommandStatus = {
  status: "running" | "idle";
  command?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

// Map to track metadata associated with builders without monkey-patching
const builderContext = new WeakMap<
  object,
  { url?: string }
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

    return createProxy(internal$, this) as $Type;
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

      // Special handling for the .request() method to track the URL and apply signal
      if (prop === "request") {
        return (url: string | URL) => {
          let result = value.call(target, url) as RequestBuilder;
          const signal = context.getSignal();
          if (signal) {
            result = result.signal(signal);
          }
          builderContext.set(result, {
            url: url.toString(),
          });
          return createProxy(result, context);
        };
      }

      // Custom implementation of pipeToPath with progress reporting
      if (prop === "pipeToPath") {
        return async (path?: string) => {
          const ctx = builderContext.get(target);

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
            // target is RequestBuilder. It already has the signal applied in .request()
            const response = await (target as RequestBuilder).fetch();
            if (!response.ok) {
              throw new Error(`Request failed with status ${response.status}`);
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
        const boundValue = value.bind(target);
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

          const result = boundValue(...args);

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
      let result = Reflect.apply(target, thisArg, argArray);
      // This handles the template literal call: $`command`
      if (result instanceof CommandBuilder) {
        const signal = context.getSignal();
        if (signal) {
          result = result.signal(signal);
        }
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
