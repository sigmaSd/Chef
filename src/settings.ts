import { commandExists } from "./internal_utils.ts";
import type { ChefDatabase } from "./database.ts";

/**
 * Manages Chef settings stored in the database
 */
export class SettingsManager {
  #database: ChefDatabase;

  constructor(database: ChefDatabase) {
    this.#database = database;
  }

  getEditorCommand(): string {
    return this.#database.getSetting("editorCommand") || (
      Deno.build.os === "windows"
        ? "start"
        : Deno.build.os === "darwin"
        ? "open"
        : "xdg-open"
    );
  }

  setEditorCommand(command: string) {
    this.#database.setSetting("editorCommand", command);
  }

  async getTerminalCommand(): Promise<string> {
    const saved = this.#database.getSetting("terminalCommand");
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
  }

  setTerminalCommand(command: string) {
    this.#database.setSetting("terminalCommand", command);
  }

  getStayInBackground(): boolean {
    return this.#database.getSetting("stayInBackground") === "true";
  }

  setStayInBackground(stay: boolean) {
    this.#database.setSetting("stayInBackground", stay.toString());
  }

  getAutoUpdateCheck(): boolean {
    const setting = this.#database.getSetting("autoUpdateCheck");
    return setting === undefined || setting === "true";
  }

  setAutoUpdateCheck(auto: boolean) {
    this.#database.setSetting("autoUpdateCheck", auto.toString());
  }

  getBackgroundUpdateNotification(): boolean {
    const setting = this.#database.getSetting("backgroundUpdateNotification");
    return setting === undefined || setting === "true";
  }

  setBackgroundUpdateNotification(notify: boolean) {
    this.#database.setSetting(
      "backgroundUpdateNotification",
      notify.toString(),
    );
  }
}
