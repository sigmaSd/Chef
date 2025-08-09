/**
 * Main lib.ts file that coordinates all Chef components
 * This file imports from the split files and provides a clean interface
 */

// Export all the main classes for external use
export { ChefInternal } from "./chef-internal.ts";
export { ChefDatabase } from "./database.ts";
export { DesktopFileManager } from "./desktop.ts";
export { BinaryRunner } from "./binary-runner.ts";
export { BinaryUpdater } from "./binary-updater.ts";

// Export command functions for testing and advanced usage
export { type CommandHandlers, parseAndExecute } from "./commands/commands.ts";

// Re-export utilities for convenience
export {
  cacheDir,
  Colors,
  copyDirRecursively,
  getExt,
  runInTempDir,
} from "./internal_utils.ts";
export { getLatestGithubRelease, getLatestNpmVersion, isUrl } from "./utils.ts";
