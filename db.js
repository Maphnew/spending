'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'spending.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id       TEXT PRIMARY KEY,
    at       INTEGER,
    amount   INTEGER NOT NULL,
    merchant TEXT NOT NULL,
    card     TEXT NOT NULL,
    running  INTEGER,
    category TEXT NOT NULL,
    canceled INTEGER NOT NULL DEFAULT 0,
    manual   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS learned (
    merchant TEXT PRIMARY KEY,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    name TEXT PRIMARY KEY
  );
`);

module.exports = db;
