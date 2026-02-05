import * as path from "@std/path";
import { ensureDirSync } from "@std/fs";
import type { Recipe } from "../mod.ts";
import { Colors, getExt } from "./internal_utils.ts";
import { isUrl } from "./utils.ts";

/**
 * Manages desktop file creation and removal for installed binaries
 */
export class DesktopFileManager {
  constructor(
    private iconsPath: string,
    private chefPath: string,
    private recipes: Recipe[],
  ) {}

  /**
   * Create a desktop file for a binary
   */
  async create(
    name: string,
    options: {
      terminal?: boolean;
      icon?: string;
    },
  ) {
    const recipe = this.recipes.find((r) => r.name === name);
    if (!recipe) {
      console.error(
        `%cBinary ${name} is not installed`,
        `color: ${Colors.lightRed}`,
      );
      return;
    }

    const desktopDir = path.join(
      Deno.env.get("HOME")!,
      ".local/share/applications",
    );
    ensureDirSync(desktopDir);
    ensureDirSync(this.iconsPath);

    // Handle icon
    let finalIcon = recipe.desktopFile?.icon ?? recipe.desktopFile?.iconPath;
    if (
      options.icon || recipe.desktopFile?.icon || recipe.desktopFile?.iconPath
    ) {
      const iconProvidedPath = options.icon ?? recipe.desktopFile?.icon ??
        recipe.desktopFile?.iconPath!;
      const iconExt = await getExt(iconProvidedPath);
      const iconFileName = `${name}-icon${iconExt}`;
      const iconPath = path.join(this.iconsPath, iconFileName);

      try {
        await fetch(
          isUrl(iconProvidedPath)
            ? iconProvidedPath
            : `file://${iconProvidedPath}`,
        )
          .then((r) => r.bytes())
          .then((bytes) => Deno.writeFileSync(iconPath, bytes));
        finalIcon = iconPath;
      } catch (e) {
        console.error(
          `%cFailed to copy icon file: ${e instanceof Error ? e.message : e}`,
          `color: ${Colors.lightRed}`,
        );
        finalIcon = recipe.desktopFile?.icon ?? recipe.desktopFile?.iconPath;
      }
    }

    const desktopFile = this.generateDesktopFileContent(
      name,
      recipe,
      recipe.desktopFile?.terminal ?? options.terminal ?? false,
      finalIcon,
    );

    const desktopPath = path.join(desktopDir, `${name}.desktop`);
    Deno.writeTextFileSync(desktopPath, desktopFile);
    Deno.chmodSync(desktopPath, 0o755);
    console.log(
      `%cCreated desktop file for ${name}`,
      `color: ${Colors.lightGreen}`,
    );
  }

  /**
   * Remove a desktop file for a binary
   */
  remove(name: string, options: { silent?: boolean } = {}) {
    const desktopPath = path.join(
      Deno.env.get("HOME")!,
      ".local/share/applications",
      `${name}.desktop`,
    );

    // Remove icon if it exists
    this.removeIcon(name);

    try {
      Deno.removeSync(desktopPath);
      if (!options.silent) {
        console.log(
          `%cRemoved desktop file for ${name}`,
          `color: ${Colors.lightGreen}`,
        );
      }
    } catch {
      if (!options.silent) {
        console.error(
          `%cNo desktop file found for ${name}`,
          `color: ${Colors.lightRed}`,
        );
      }
    }
  }

  /**
   * Generate desktop file content
   */
  private generateDesktopFileContent(
    name: string,
    recipe: Recipe,
    terminal: boolean,
    icon?: string,
  ): string {
    return `[Desktop Entry]
Name=${recipe.desktopFile?.name ?? name}
Exec=deno run -A ${this.chefPath} run ${recipe.name}
Type=Application
Terminal=${terminal}
${recipe.desktopFile?.comment ? `Comment=${recipe.desktopFile.comment}` : ""}
${
      recipe.desktopFile?.categories
        ? `Categories=${recipe.desktopFile.categories}`
        : ""
    }
${icon ? `Icon=${icon}` : ""}`;
  }

  /**
   * Remove icon file for a binary
   */
  private removeIcon(name: string) {
    const iconBasePath = path.join(this.iconsPath, `${name}-icon`);
    for (const ext of [".png", ".jpg", ".jpeg", ".svg", ".ico"]) {
      try {
        Deno.removeSync(iconBasePath + ext);
        break;
      } catch {
        continue;
      }
    }
  }

  /**
   * Check if a desktop file exists for a binary
   */
  exists(name: string): boolean {
    const desktopPath = path.join(
      Deno.env.get("HOME")!,
      ".local/share/applications",
      `${name}.desktop`,
    );
    try {
      Deno.statSync(desktopPath);
      return true;
    } catch {
      return false;
    }
  }
}
