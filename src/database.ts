import { Err, Ok, Result } from "@sigmasd/rust-types/result";
import type { Recipe } from "../mod.ts";

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
  readRaw(): Result<DbStructure, unknown> {
    const db = Result
      .wrap(() => Deno.readTextFileSync(this.dbPath))
      .unwrapOr("{}");

    const dbParsed = Result.wrap(() => JSON.parse(db) as DbStructure);
    if (dbParsed.isErr()) return Err(dbParsed.err);
    return Ok(dbParsed.ok);
  }

  /**
   * Read the database from disk and filter out recipes that no longer exist.
   * Returns only binary entries (DbEntry).
   */
  read(): Result<Record<string, DbEntry>, unknown> {
    const dbParsed = this.readRaw();
    if (dbParsed.isErr()) return Err(dbParsed.err);

    // Normalize entries to DbEntry and filter out entries for recipes that no longer exist
    const normalized: Record<string, DbEntry> = {};
    for (const [name, value] of Object.entries(dbParsed.ok)) {
      if (name === "_settings" || name === "_providers") continue;
      if (this.recipes.find((r) => r.name === name)) {
        if (typeof value === "string") {
          normalized[name] = { version: value };
        } else if (typeof value === "object" && value !== null) {
          normalized[name] = value as DbEntry;
        }
      }
    }

    return Ok(normalized);
  }

  /**
   * Write the database to disk
   */
  write(db: DbStructure) {
    Result.wrap(() => Deno.writeTextFileSync(this.dbPath, JSON.stringify(db)))
      .expect("failed to write to database");
  }

  /**
   * Get all registered providers
   */
  getProviders(): ProviderEntry[] {
    const db = this.readRaw().expect("failed to read database");
    return db._providers || [];
  }

  /**
   * Add a provider
   */
  addProvider(provider: ProviderEntry) {
    const db = this.readRaw().expect("failed to read database");
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
    const db = this.readRaw().expect("failed to read database");
    if (!db._providers) return;
    db._providers = db._providers.filter((p) => p.name !== name);
    this.write(db);
  }

  /**
   * Get a setting value
   */
  getSetting(key: string): string | undefined {
    const db = this.readRaw().expect("failed to read database");
    return db._settings?.[key];
  }

  /**
   * Set a setting value
   */
  setSetting(key: string, value: string) {
    const db = this.readRaw().expect("failed to read database");
    if (!db._settings) db._settings = {};
    db._settings[key] = value;
    this.write(db);
  }

  /**
   * Get the current version of a specific binary
   */
  getVersion(binaryName: string): string | undefined {
    const db = this.read().expect("failed to read database");
    return db[binaryName]?.version;
  }

  /**
   * Get the entry for a specific binary
   */
  getEntry(binaryName: string): DbEntry | undefined {
    const db = this.read().expect("failed to read database");
    return db[binaryName];
  }

  /**
   * Update the entry for a specific binary
   */
  setEntry(binaryName: string, entry: DbEntry) {
    const db = this.readRaw().expect("failed to read database");
    db[binaryName] = entry;
    this.write(db);
  }

  /**
   * Update the version of a specific binary
   */
  setVersion(binaryName: string, version: string) {
    const db = this.readRaw().expect("failed to read database");
    const entry = db[binaryName] as DbEntry | undefined;
    db[binaryName] = { ...entry, version };
    this.write(db);
  }

  /**
   * Get all installed binaries with their versions
   */
  getInstalledBinaries(): Record<string, DbEntry> {
    return this.read().expect("failed to read database");
  }

  /**
   * Check if a binary is installed
   */
  isInstalled(binaryName: string): boolean {
    const db = this.read().expect("failed to read database");
    return binaryName in db;
  }

  /**
   * Remove a binary from the database
   */
  removeBinary(binaryName: string) {
    const db = this.readRaw().expect("failed to read database");
    delete db[binaryName];
    this.write(db);
  }
}
