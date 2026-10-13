import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath = resolve("data/app.sqlite");

mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);

// Enforce relational integrity.
db.pragma("foreign_keys = ON");

// Improve read/write concurrency.
db.pragma("journal_mode = WAL");

// Initialize the schema.
db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    network TEXT NOT NULL,
    address TEXT NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    encryption_salt TEXT NOT NULL,
    encryption_iv TEXT NOT NULL,
    encryption_auth_tag TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (network, address)
  );
`);
