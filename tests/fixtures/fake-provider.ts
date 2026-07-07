import { runChefProvider } from "../../src/sdk.ts";

const args = Deno.args;
const delayIdx = args.indexOf("--delay");
const delayMs = delayIdx >= 0 ? Number(args[delayIdx + 1]) : 0;
const nameIdx = args.indexOf("--name");
const providerName = nameIdx >= 0 ? String(args[nameIdx + 1]) : "fake";
const appIdx = args.indexOf("--app");
const appName = appIdx >= 0 ? String(args[appIdx + 1]) : "fake-app";

await runChefProvider({
  list: async (_signal) => {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    return [{
      name: appName,
      version: "1.0.0",
      latestVersion: "1.0.0",
      description: `From ${providerName}`,
    }];
  },
  update: () => Promise.resolve(true),
  remove: () => Promise.resolve(true),
});
