import type { Recipe } from "../mod.ts";
import * as path from "@std/path";
import { ensureDirSync } from "@std/fs";

export interface DbEntry {
  version: string;
  dir?: string;
  extern?: string;
}

export interface ProviderEntry {
  name: string;
  command: string;
}

interface DbStructure {
  _settings?: Record<string, string>;
  _providers?: ProviderEntry[];
  [key: string]:
    | string
    | DbEntry
    | Record<string, string>
    | ProviderEntry[]
    | undefined;
}

/**
 * Manages the Chef database that stores binary versions and metadata
 */
export class ChefDatabase {
  constructor(private dbPath: string, private recipes: Recipe[]) {}

  /**
   * Read the raw database structure including settings
   */
  readRaw(): DbStructure {
    let db = "{}";
    try {
      db = Deno.readTextFileSync(this.dbPath);
    } catch {
      // Ignore
    }

    return JSON.parse(db);
  }

  /**
   * Read the database from disk.
   * Returns only binary entries (DbEntry).
   */
  read(): Record<string, DbEntry> {
    const dbParsed = this.readRaw();

    // Normalize entries to DbEntry
    const normalized: Record<string, DbEntry> = {};
    for (const [name, value] of Object.entries(dbParsed)) {
      if (name === "_settings" || name === "_providers") continue;
      if (typeof value === "string") {
        normalized[name] = { version: value };
      } else if (typeof value === "object" && value !== null) {
        const entry = value as Record<string, unknown>;
        if (typeof entry.version === "string") {
          normalized[name] = {
            version: entry.version,
            dir: typeof entry.dir === "string" ? entry.dir : undefined,
            extern: typeof entry.extern === "string" ? entry.extern : undefined,
          };
        }
      }
    }

    return normalized;
  }

  /**
   * Write the database to disk
   */
  write(db: DbStructure) {
    ensureDirSync(path.dirname(this.dbPath));
    try {
      Deno.writeTextFileSync(this.dbPath, JSON.stringify(db));
    } catch {
      throw new Error("failed to write to database");
    }
  }

  /**
   * Get all registered providers
   */
  getProviders(): ProviderEntry[] {
    const db = this.readRaw();
    return db._providers || [];
  }

  /**
   * Add a provider
   */
  addProvider(provider: ProviderEntry) {
    const db = this.readRaw();
    if (!db._providers) db._providers = [];
    // Remove if already exists with same name
    db._providers = db._providers.filter((p) => p.name !== provider.name);
    db._providers.push(provider);
    this.write(db);
  }

  /**
   * Remove a provider
   */
  removeProvider(name: string) {
    const db = this.readRaw();
    if (!db._providers) return;
    db._providers = db._providers.filter((p) => p.name !== name);
    this.write(db);
  }

  /**
   * Get a setting value
   */
  getSetting(key: string): string | undefined {
    const db = this.readRaw();
    return db._settings?.[key];
  }

  /**
   * Set a setting value
   */
  setSetting(key: string, value: string) {
    const db = this.readRaw();
    if (!db._settings) db._settings = {};
    db._settings[key] = value;
    this.write(db);
  }

  /**
   * Get the current version of a specific binary
   */
  getVersion(binaryName: string): string | undefined {
    const db = this.read();
    return db[binaryName]?.version;
  }

  /**
   * Get the entry for a specific binary
   */
  getEntry(binaryName: string): DbEntry | undefined {
    const db = this.read();
    return db[binaryName];
  }

  /**
   * Update the entry for a specific binary
   */
  setEntry(binaryName: string, entry: DbEntry) {
    const db = this.readRaw();
    db[binaryName] = entry;
    this.write(db);
  }

  /**
   * Update the version of a specific binary
   */
  setVersion(binaryName: string, version: string) {
    const db = this.readRaw();
    const entry = db[binaryName];
    if (typeof entry === "object" && entry !== null) {
      db[binaryName] = { ...(entry as Record<string, unknown>), version };
    } else {
      db[binaryName] = { version };
    }
    this.write(db);
  }

  /**
   * Get all installed binaries with their versions
   */
  getInstalledBinaries(): Record<string, DbEntry> {
    return this.read();
  }

  /**
   * Check if a binary is installed
   */
  isInstalled(binaryName: string): boolean {
    const db = this.read();
    return binaryName in db;
  }

  /**
   * Remove a binary from the database
   */
  removeBinary(binaryName: string) {
    const db = this.readRaw();
    delete db[binaryName];
    this.write(db);
  }
}
