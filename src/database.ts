import { Err, Ok, Result } from "@sigmasd/rust-types/result";
import type { Recipe } from "../mod.ts";

export interface DbEntry {
  version: string;
  dir?: string;
}

/**
 * Manages the Chef database that stores binary versions and metadata
 */
export class ChefDatabase {
  constructor(private dbPath: string, private recipes: Recipe[]) {}

  /**
   * Read the database from disk and filter out recipes that no longer exist
   */
  read(): Result<Record<string, DbEntry>, unknown> {
    const db = Result
      .wrap(() => Deno.readTextFileSync(this.dbPath))
      .unwrapOr("{}");

    const dbParsed = Result.wrap(() =>
      JSON.parse(db) as Record<string, string | DbEntry>
    );
    if (dbParsed.isErr()) return Err(dbParsed.err);

    // Normalize entries to DbEntry and filter out entries for recipes that no longer exist
    const normalized: Record<string, DbEntry> = {};
    for (const [name, value] of Object.entries(dbParsed.ok)) {
      if (this.recipes.find((r) => r.name === name)) {
        if (typeof value === "string") {
          normalized[name] = { version: value };
        } else {
          normalized[name] = value;
        }
      }
    }

    return Ok(normalized);
  }

  /**
   * Write the database to disk
   */
  write(db: Record<string, DbEntry>) {
    Result.wrap(() => Deno.writeTextFileSync(this.dbPath, JSON.stringify(db)))
      .expect("failed to write to database");
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
   * Update the version of a specific binary
   */
  setVersion(binaryName: string, version: string) {
    const db = this.read().expect("failed to read database");
    db[binaryName] = { ...db[binaryName], version };
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
    const db = this.read().expect("failed to read database");
    delete db[binaryName];
    this.write(db);
  }
}
