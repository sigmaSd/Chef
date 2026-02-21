import * as path from "@std/path";
import { ensureDirSync } from "@std/fs";
import type { Recipe } from "../mod.ts";
import { Colors, getExt } from "./internal_utils.ts";
import { expect, isUrl } from "./utils.ts";

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
      Deno.env.get("HOME") ?? expect("HOME env var not set"),
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
        recipe.desktopFile?.iconPath ?? expect("icon path missing");
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
   * Install Chef GUI as a desktop application
   */
  async installGui() {
    const appId = "io.github.sigmasd.chef";
    const desktopDir = path.join(
      Deno.env.get("HOME") ?? expect("HOME env var not set"),
      ".local/share/applications",
    );
    const iconDir = path.join(
      Deno.env.get("HOME") ?? expect("HOME env var not set"),
      ".local/share/icons/hicolor/scalable/apps",
    );
    ensureDirSync(desktopDir);
    ensureDirSync(iconDir);

    let iconValue = "package-x-generic";

    // Try to find and copy the chef icon
    try {
      const svgUrl = new URL(`../distro/${appId}.svg`, import.meta.url);
      const destIconPath = path.join(iconDir, `${appId}.svg`);

      const response = await fetch(svgUrl);
      if (response.ok) {
        const bytes = await response.bytes();
        await Deno.writeFile(destIconPath, bytes);
        iconValue = appId;
      }
    } catch {
      // Fallback to generic icon if icon not found
    }

    const desktopPath = path.join(desktopDir, `${appId}.desktop`);
    const content = `[Desktop Entry]
Name=Chef
Exec=deno run ${this.getConfigArg()}-A ${this.chefPath} gui
Type=Application
Terminal=false
Comment=Personal Package Manager
Categories=System;
Icon=${iconValue}`;

    Deno.writeTextFileSync(desktopPath, content);
    Deno.chmodSync(desktopPath, 0o755);
    console.log(
      `%cChef GUI installed as a desktop application`,
      `color: ${Colors.lightGreen}`,
    );
    console.log(
      `%cDesktop file: ${desktopPath}`,
      `color: ${Colors.blueMarine}`,
    );
  }

  private getConfigArg(): string {
    if (!import.meta.url.startsWith("file://")) {
      return "";
    }

    try {
      const configUrl = new URL("../deno.json", import.meta.url);
      const configPath = path.fromFileUrl(configUrl);
      Deno.statSync(configPath);
      return `--config ${configPath} `;
    } catch {
      return "";
    }
  }

  /**
   * Uninstall Chef GUI desktop application
   */
  uninstallGui() {
    const appId = "io.github.sigmasd.chef";
    const desktopPath = path.join(
      Deno.env.get("HOME") ?? expect("HOME env var not set"),
      ".local/share/applications",
      `${appId}.desktop`,
    );

    // Remove icon if it exists
    try {
      const iconPath = path.join(
        Deno.env.get("HOME") ?? expect("HOME env var not set"),
        ".local/share/icons/hicolor/scalable/apps",
        `${appId}.svg`,
      );
      Deno.removeSync(iconPath);
    } catch {
      // Ignore
    }

    try {
      Deno.removeSync(desktopPath);
      console.log(
        `%cChef GUI uninstalled successfully`,
        `color: ${Colors.lightGreen}`,
      );
    } catch {
      console.error(
        `%cChef GUI is not installed as a desktop application`,
        `color: ${Colors.lightRed}`,
      );
    }
  }

  /**
   * Remove a desktop file for a binary
   */
  remove(name: string, options: { silent?: boolean } = {}) {
    const desktopPath = path.join(
      Deno.env.get("HOME") ?? expect("HOME env var not set"),
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
    const exec = recipe.provider
      ? `${recipe.name}`
      : `deno run ${this.getConfigArg()}-A ${this.chefPath} run ${recipe.name}`;
    return `[Desktop Entry]
Name=${recipe.desktopFile?.name ?? name}
Exec=${exec}
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
      Deno.env.get("HOME") ?? expect("HOME env var not set"),
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
