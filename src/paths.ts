import * as path from "@std/path";
import { getChefBasePath } from "./internal_utils.ts";

/**
 * Manages path construction for Chef
 */
export class ChefPaths {
  #scriptName: string;
  #chefPath: string;
  #basePath: string;

  constructor(
    scriptName: string,
    chefPath: string,
    basePath: string = getChefBasePath(),
  ) {
    this.#scriptName = scriptName;
    this.#chefPath = chefPath;
    this.#basePath = basePath;
  }

  get scriptDir() {
    return path.join(this.#basePath, this.#scriptName);
  }

  get binPath() {
    return path.join(this.scriptDir, "bin");
  }

  get iconsPath() {
    return path.join(this.scriptDir, "icons");
  }

  get dbPath() {
    return path.join(this.scriptDir, "db.json");
  }

  get exportsPath() {
    return path.join(this.#basePath, "exports");
  }
}
