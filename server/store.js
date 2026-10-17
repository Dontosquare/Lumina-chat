// Tiny JSON-file "database" in ./data/db.json, created with demo data on first run.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeed } from './seed.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

let db;

// Data saved before the app was translated keeps its English demo names.
// Rename those (only exact old defaults, so names you typed yourself are left alone).
const DANISH = {
  Housing: 'Bolig', Groceries: 'Dagligvarer', Utilities: 'Forsyning', 'Dining out': 'Restaurant og café',
  Entertainment: 'Underholdning', Subscriptions: 'Abonnementer', Travel: 'Rejser',
  'Emergency fund': 'Nødopsparing', 'Japan trip': 'Rejse til Japan', 'House down payment': 'Udbetaling til bolig',
  Rent: 'Husleje', Supermarket: 'Supermarked', 'Farmers market': 'Torvehal', 'Bulk store': 'Grossist',
  'Corner shop': 'Kiosk', Electricity: 'El', Water: 'Vand', 'Transit pass': 'Rejsekort', Fuel: 'Benzin',
  Rideshare: 'Taxa', 'Ramen bar': 'Ramenbar', Coffee: 'Kaffe', 'Pizza night': 'Pizzaaften', Clothing: 'Tøj',
  'Home goods': 'Boligudstyr', Electronics: 'Elektronik', Books: 'Bøger', Cinema: 'Biograf', Concert: 'Koncert',
  Music: 'Musik', 'Cloud storage': 'Cloudlager', 'Weekend train trip': 'Weekendtur med tog', 'Hotel night': 'Hotelovernatning',
};

function translateOldNames(data) {
  let changed = false;
  const fix = (obj, key) => {
    if (DANISH[obj[key]]) {
      obj[key] = DANISH[obj[key]];
      changed = true;
    }
  };
  data.budgets.forEach((b) => fix(b, 'name'));
  data.goals.forEach((g) => fix(g, 'name'));
  data.transactions.forEach((t) => fix(t, 'note'));
  if (changed) data.lastRun = null; // its suggestions quote the old English names
  return changed;
}

export async function load() {
  if (db) return db;
  if (existsSync(DB_PATH)) {
    db = JSON.parse(await readFile(DB_PATH, 'utf8'));
    if (translateOldNames(db)) await save();
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

/** Clean start: keep the budget categories, zero every number and remove goals and transactions. */
export async function clear() {
  const fresh = createSeed();
  db = {
    income: 0,
    budgets: fresh.budgets.map((b) => ({ ...b, monthly: 0 })),
    goals: [],
    transactions: [],
    lastRun: null,
  };
  await save();
  return db;
}

export async function reset() {
  db = createSeed();
  await save();
  return db;
}
