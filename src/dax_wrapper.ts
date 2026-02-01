import { build$ as daxBuild$ } from "@david/dax";

export type CommandStatus = {
  status: "running" | "idle";
  command?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

let statusListener: ((status: CommandStatus) => void) | undefined;

export function setStatusListener(cb: (status: CommandStatus) => void) {
  statusListener = cb;
}

// deno-lint-ignore no-explicit-any
const internal$: any = daxBuild$({
  // @ts-ignore: dax version mismatch causing type error
  // deno-lint-ignore no-explicit-any
  commandLogger: (cmd: any) => {
    if (statusListener) {
      statusListener({ status: "running", command: cmd });
    }
    console.log(`\x1b[2m$\x1b[0m ${cmd}`);
  },
});

function wrapPromise<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  return p.finally(() => {
    if (statusListener && !signal?.aborted) {
      statusListener({ status: "idle" });
    }
  });
}

/**
 * Wraps dax objects to intercept promise-returning methods
 */
// deno-lint-ignore no-explicit-any
function wrapObject(obj: any, label?: string): any {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      if (prop === "signal" || prop === "abortSignal") {
        return (sig: AbortSignal) => {
          (target as any).__chef_signal = sig;
          // Only call dax's abortSignal if it exists and we're not shadowing it too much
          // Actually, dax 0.44.2 RequestBuilder might have issues with standard AbortSignal
          // if it expects its own internal Signal type in some places.
          // Let's try to pass it and see, but most importantly we keep it in __chef_signal
          const method = (target as any).abortSignal || (target as any).signal;
          if (typeof method === "function") {
            try {
              method.call(target, sig);
            } catch (e) {
              // If dax fails to take the signal, we still want to continue
              // as we handle it ourselves in pipeToPath
              console.warn("Dax failed to accept signal:", e);
            }
          }
          return wrapObject(target, label);
        };
      }

      const value = Reflect.get(target, prop, receiver);

      if (label === "request" && prop === "pipeToPath") {
        // deno-lint-ignore no-explicit-any
        return async (...args: any[]) => {
          const signal = (target as any).__chef_signal as
            | AbortSignal
            | undefined;
          if (signal?.aborted) throw signal.reason;

          if (!statusListener) {
            return value.apply(target, args);
          }

          let path = args[0] as string | undefined;
          if (!path) {
            // deno-lint-ignore no-explicit-any
            const urlStr = (target as any).__chef_url;
            if (!urlStr) {
              throw new Error(
                "Could not determine URL. Please provide a path.",
              );
            }
            const url = new URL(urlStr);
            const segments = url.pathname.split("/");
            path = segments[segments.length - 1];
            if (!path) {
              throw new Error(
                "Could not determine file name from URL. Please provide a path.",
              );
            }
          }

          if (statusListener) {
            statusListener({
              status: "running",
              command: `Downloading to ${path}...`,
            });
          }

          // deno-lint-ignore no-explicit-any
          const response = await (target as any).fetch();
          if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
          }

          const total = parseInt(
            response.headers.get("content-length") || "0",
            10,
          );
          let loaded = 0;

          const file = await Deno.open(path, {
            write: true,
            create: true,
            truncate: true,
          });

          try {
            // deno-lint-ignore no-explicit-any
            const body = (response as any).readable ?? response.body;
            if (body) {
              const reader = body.getReader();
              while (true) {
                if (signal?.aborted) throw signal.reason;
                const { done, value } = await reader.read();
                if (done) break;

                loaded += value.length;
                await file.write(value);

                if (statusListener && total > 0) {
                  statusListener({
                    status: "running",
                    command: `Downloading to ${path}...`,
                    progress: loaded / total,
                    loaded,
                    total,
                  });
                }
              }
            }
          } finally {
            file.close();
          }

          if (statusListener) {
            statusListener({ status: "idle" });
          }
        };
      }

      if (typeof value === "function") {
        // deno-lint-ignore no-explicit-any
        return (...args: any[]) => {
          // Trigger running status for terminal methods of RequestBuilder
          const terminalMethods = [
            "json",
            "text",
            "bytes",
            "blob",
            // "pipeToPath", // Handled above
            "pipeTo",
            "response",
          ];
          if (label === "request" && terminalMethods.includes(prop as string)) {
            if (statusListener) {
              statusListener({
                status: "running",
                command: `Fetching ${target.url || "resource"}...`,
              });
            }
          }

          const result = value.apply(target, args);

          // If it returns a promise, wrap it to detect completion
          if (result instanceof Promise) {
            return wrapPromise(result, (target as any).__chef_signal);
          }

          // If it's a CommandBuilder or RequestBuilder being returned (for chaining)
          if (
            result && typeof result === "object" &&
            // deno-lint-ignore no-explicit-any
            typeof (result as any).then === "function"
          ) {
            // Keep track of what we are wrapping to provide better status messages
            const nextLabel = prop === "request" ? "request" : label;
            // Store the URL for status messages if this is a request
            if (prop === "request" && args[0]) {
              result.__chef_url = args[0].toString();
            } else if (label === "request") {
              result.__chef_url = target.__chef_url;
            }
            // Propagate signal
            result.__chef_signal = (target as any).__chef_signal;
            return wrapObject(result, nextLabel);
          }

          return result;
        };
      }
      return value;
    },
    apply(target, thisArg, argArray) {
      const result = Reflect.apply(target, thisArg, argArray);
      // This is for $`command` calls
      if (
        result && typeof result === "object" &&
        // deno-lint-ignore no-explicit-any
        typeof (result as any).then === "function"
      ) {
        // We don't need to trigger "running" here because commandLogger already did it
        return wrapObject(result);
      }
      if (result instanceof Promise) {
        return wrapPromise(result, (target as any).__chef_signal);
      }
      return result;
    },
  });
}

// deno-lint-ignore no-explicit-any
export const $: any = wrapObject(internal$);
