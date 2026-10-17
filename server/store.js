// Tiny JSON-file "database" in ./data/db.json, created with demo data on first run.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeed } from './seed.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

let db;

export async function load() {
  if (db) return db;
  if (existsSync(DB_PATH)) {
    db = JSON.parse(await readFile(DB_PATH, 'utf8'));
  } else {
    db = createSeed();
    await save();
  }
  return db;
}

export async function save() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

export async function reset() {
  db = createSeed();
  await save();
  return db;
}
