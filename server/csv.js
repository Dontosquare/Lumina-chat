// Bank statement import: parse a CSV export, find its columns and guess categories.
// Pure functions, no I/O, so the API can show a preview before anything is saved.
import { toISODate } from './finance.js';

/** Split CSV text into rows of trimmed cells. The delimiter is guessed from the first line. */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const count = (d) => firstLine.split(d).length;
  const delimiter = [';', '\t', ','].reduce((best, d) => (count(d) > count(best) ? d : best));

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') cell += text[i++];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.map((r) => r.map((s) => s.trim())).filter((r) => r.some(Boolean));
}

/** "-1.234,56", "1,234.56", "-45,00 kr." → number, or null. Danish banks use a decimal comma. */
export function parseAmount(raw) {
  let s = String(raw ?? '').replace(/\s|kr\.?|dkk/gi, '').replace('−', '-');
  if (!/^[-+]?(\d|[.,]\d)[\d.,]*$/.test(s)) return null;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma > dot) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else if (comma !== -1) s = s.replace(/,/g, ''); // 1,234.56
  else if (s.split('.').length > 2) s = s.replace(/\./g, ''); // 1.234.567
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "24.10.2026", "24-10-26", "2026-10-24" → "2026-10-24", or null. Day comes before month, as in Denmark. */
export function parseDate(raw) {
  const s = String(raw ?? '').trim();
  let y, m, d;
  let match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) [, y, m, d] = match.map(Number);
  else if ((match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/))) [, d, m, y] = match.map(Number);
  else return null;
  if (y < 100) y += 2000;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? toISODate(date) : null;
}

const HEADERS = {
  date: /^(bogf|dato|date|posteringsdato|transaktionsdato|posting)/i,
  amount: /^(beløb|beloeb|amount|værdi)/i,
  text: /(tekst|beskrivelse|text|description|navn|modtager|meddelelse)/i,
};

/** Which column holds the date, amount and text. Header names first, then what the values look like. */
export function detectColumns(table) {
  const header = table[0];
  const sample = table.slice(1, 51);
  const width = Math.max(...table.map((r) => r.length));
  const cols = [...Array(width).keys()];
  const share = (i, parse) => sample.filter((r) => parse(r[i]) !== null).length / Math.max(sample.length, 1);
  const named = (re) => header.findIndex((h) => re.test(h) && !/saldo|balance/i.test(h));

  let date = named(HEADERS.date);
  if (date < 0) date = cols.find((i) => share(i, parseDate) > 0.8) ?? -1;
  let amount = named(HEADERS.amount);
  if (amount < 0) amount = cols.find((i) => i !== date && share(i, parseAmount) > 0.8) ?? -1;
  // Banks often have several text-like columns (Nordea: Navn, Beskrivelse), some mostly empty.
  // Take the one with the most real words, preferring columns whose header sounds like text.
  const rest = cols.filter((i) => i !== date && i !== amount);
  const textual = rest.filter((i) => HEADERS.text.test(header[i] || ''));
  const words = (i) => sample.reduce((sum, r) => sum + (r[i] && parseAmount(r[i]) === null ? r[i].length : 0), 0);
  const text = (textual.length ? textual : rest).sort((a, b) => words(b) - words(a))[0] ?? -1;
  return { date, amount, text };
}

// Common Danish merchants and words. The first match wins, so the order matters.
const RULES = [
  ['housing', /husleje|boligforening|ejendom|grundejer|realkredit|ejerforening|andelsbolig|boliglån/],
  ['groceries', /netto|føtex|fotex|bilka|rema ?1000|lidl|aldi|coop|irma|meny|\bspar\b|kvickly|brugsen|365 ?discount|løvbjerg|købmand|supermarked|bager/],
  ['subscriptions', /netflix|spotify|hbo|viaplay|disney|apple\.com|itunes|google (one|play|storage)|youtube|tv ?2 ?play|icloud|adobe|microsoft|chatgpt|openai|patreon|abonnement|fitness|\bsats\b/],
  ['utilities', /ørsted|orsted|andel ?energi|norlys|ewii|hofor|vandværk|forsyning|fjernvarme|telia|yousee|telenor|\btdc\b|hiper|fastspeed|\bcbb\b|lebara|oister|internet/],
  ['transport', /\bdsb\b|rejsekort|metro|movia|arriva|midttrafik|circle ?k|\bq8\b|shell|\bok\b|ingo|uno-?x|parkering|easypark|apcoa|taxa|taxi|uber|bolt|brobizz|benzin/],
  ['dining', /restaurant|café|cafe|mcdonald|burger ?king|sunset|joe & the juice|espresso house|starbucks|wolt|just ?eat|pizza|sushi|kebab|bistro|baresso|lagkagehuset|7-?eleven/],
  ['entertainment', /biograf|nordisk film|kino|cinema|tivoli|billetlugen|ticketmaster|billetto|koncert|steam|playstation|xbox|nintendo|bowling|museum/],
  ['travel', /\bsas\b|norwegian|ryanair|easyjet|lufthansa|hotel|booking\.com|airbnb|hostel|expedia|lufthavn|airport/],
  ['shopping', /zalando|h&m|magasin|ikea|elgiganten|power|amazon|matas|normal|jysk|søstrene|boozt|zara|apotek|tiger/],
];

// Card numbers and dates in bank texts change on every purchase; drop them before comparing.
const textKey = (s) => s.toLowerCase().replace(/[\d.,/*:-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The category for a bank text: how you filed the same text before, else a merchant rule. */
function guessCategory(text, history, budgetIds) {
  const key = textKey(text);
  // Bank texts wrap the merchant ("Dankort-køb Kaffe Kompagniet 1234"), so also look for a
  // known text inside this one, the longest first.
  const known =
    history.get(key) ??
    [...history].filter(([k]) => k.length >= 4 && ` ${key} `.includes(` ${k} `)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  if (known) return { category: known, source: 'history' };
  const lower = text.toLowerCase();
  const rule = RULES.find(([id, re]) => budgetIds.has(id) && re.test(lower));
  if (rule) return { category: rule[0], source: 'rule' };
  return { category: budgetIds.has('shopping') ? 'shopping' : [...budgetIds][0], source: null };
}

/**
 * Everything the import screen needs, without changing `db`.
 * Only spending is imported: if the file has negative amounts, those are the expenses
 * and positive ones (salary, refunds) are skipped.
 */
export function previewImport(text, db, mapping) {
  const table = parseCSV(String(text || ''));
  if (!table.length) throw new Error('Filen er tom');
  const cols = mapping ?? detectColumns(table);
  const hasHeader = parseDate(table[0][cols.date]) === null;
  const columns = table[0].map((h, i) => (hasHeader && h ? h : `Kolonne ${i + 1}`));
  const result = { columns, mapping: cols, rows: [], skipped: { income: 0, invalid: 0 } };
  if (cols.date < 0 || cols.amount < 0) return result;

  const parsed = (hasHeader ? table.slice(1) : table).map((r) => ({
    date: parseDate(r[cols.date]),
    amount: parseAmount(r[cols.amount]),
    note: (r[cols.text] || '').replace(/\s+/g, ' ').trim().slice(0, 80),
  }));
  const valid = parsed.filter((r) => r.date && r.amount);
  const negative = valid.some((r) => r.amount < 0);
  const expenses = valid.filter((r) => (negative ? r.amount < 0 : r.amount > 0));
  result.skipped = { income: valid.length - expenses.length, invalid: parsed.length - valid.length };

  // Transactions are newest first, so the latest way you filed a text wins.
  const history = new Map();
  for (const t of db.transactions) if (t.note && !history.has(textKey(t.note))) history.set(textKey(t.note), t.category);
  const budgetIds = new Set(db.budgets.map((b) => b.id));

  // Count each existing transaction once, so re-importing the same file flags every row,
  // while two identical coffees on the same day in a new file still both count.
  const existing = new Map();
  const dupKey = (t) => `${t.date}|${t.amount.toFixed(2)}|${t.note.toLowerCase()}`;
  for (const t of db.transactions) existing.set(dupKey(t), (existing.get(dupKey(t)) || 0) + 1);

  result.rows = expenses.map((r) => {
    const row = { date: r.date, note: r.note, amount: Math.round(Math.abs(r.amount) * 100) / 100 };
    const left = existing.get(dupKey(row)) || 0;
    if (left) existing.set(dupKey(row), left - 1);
    return { ...row, ...guessCategory(r.note, history, budgetIds), duplicate: left > 0 };
  });
  return result;
}
