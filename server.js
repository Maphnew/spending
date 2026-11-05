'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
require('./insights')(app);

const rowToTx = (row) => ({
  id: row.id,
  at: row.at,
  amount: row.amount,
  merchant: row.merchant,
  card: row.card,
  running: row.running,
  category: row.category,
  canceled: !!row.canceled,
  manual: !!row.manual,
});

const learnedMap = () => Object.fromEntries(
  db.prepare('SELECT merchant, category FROM learned').all().map((r) => [r.merchant, r.category]),
);

/** 같은 결제인가? app.js의 isSameTx와 동일한 규칙(일시·금액·가맹점, 둘 다 누적을 알면 그것까지). */
function isSameTx(a, b) {
  if (a.merchant !== b.merchant || a.amount !== b.amount || a.at !== b.at) return false;
  if (a.running != null && b.running != null) return a.running === b.running;
  return true;
}

const insertTx = db.prepare(`
  INSERT INTO transactions (id, at, amount, merchant, card, running, category, canceled, manual)
  VALUES (@id, @at, @amount, @merchant, @card, @running, @category, @canceled, @manual)
`);

app.get('/api/state', (req, res) => {
  const transactions = db.prepare('SELECT * FROM transactions').all().map(rowToTx);
  const cards = db.prepare('SELECT name FROM cards ORDER BY name').all().map((r) => r.name);
  res.json({ transactions, learned: learnedMap(), cards });
});

/** 문자 파싱 · 표 붙여넣기 · 직접 입력 결과를 배치로 저장한다(중복은 건너뜀, manual은 그대로 담음). */
app.post('/api/transactions', (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const existing = db.prepare('SELECT * FROM transactions').all().map(rowToTx);
  const added = [];

  const insertMany = db.transaction((items) => {
    for (const tx of items) {
      if (!tx.manual && existing.some((t) => isSameTx(t, tx))) continue;
      const row = {
        id: tx.id || crypto.randomUUID(),
        at: tx.at ?? null,
        amount: tx.amount,
        merchant: tx.merchant,
        card: tx.card,
        running: tx.running ?? null,
        category: tx.category,
        canceled: tx.canceled ? 1 : 0,
        manual: tx.manual ? 1 : 0,
      };
      insertTx.run(row);
      existing.push(rowToTx(row));
      added.push(rowToTx(row));
    }
  });
  insertMany(list);

  res.json({ added });
});

/** 일시·가맹점·카드·금액·분류 중 바뀐 것만 담아 보낸다.
    분류는 같은 가맹점 전체와 learned에도 반영되므로, 영향받은 행을 모두 돌려준다. */
app.patch('/api/transactions/:id', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).end();

  const fields = req.body || {};
  let affectedIds = [tx.id];

  if ('category' in fields) {
    db.prepare('UPDATE transactions SET category = ? WHERE merchant = ?').run(fields.category, tx.merchant);
    db.prepare(`
      INSERT INTO learned (merchant, category) VALUES (?, ?)
      ON CONFLICT(merchant) DO UPDATE SET category = excluded.category
    `).run(tx.merchant, fields.category);
    affectedIds = db.prepare('SELECT id FROM transactions WHERE merchant = ?').all(tx.merchant).map((r) => r.id);
  } else {
    const next = {
      id: tx.id,
      at: 'at' in fields ? fields.at : tx.at,
      merchant: 'merchant' in fields ? fields.merchant : tx.merchant,
      card: 'card' in fields ? fields.card : tx.card,
      amount: 'amount' in fields ? fields.amount : tx.amount,
      category: tx.category,
    };
    next.canceled = 'amount' in fields ? (fields.amount < 0 ? 1 : 0) : tx.canceled;
    db.prepare(`
      UPDATE transactions SET at=@at, merchant=@merchant, card=@card, amount=@amount, canceled=@canceled
      WHERE id=@id
    `).run(next);
  }

  const placeholders = affectedIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM transactions WHERE id IN (${placeholders})`).all(...affectedIds);
  res.json({ transactions: rows.map(rowToTx), learned: learnedMap() });
});

app.delete('/api/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.delete('/api/transactions', (req, res) => {
  db.exec('DELETE FROM transactions; DELETE FROM learned;');
  res.status(204).end();
});

app.post('/api/cards', (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).end();
  db.prepare('INSERT OR IGNORE INTO cards (name) VALUES (?)').run(name);
  res.json({ cards: db.prepare('SELECT name FROM cards ORDER BY name').all().map((r) => r.name) });
});

app.delete('/api/cards/:name', (req, res) => {
  db.prepare('DELETE FROM cards WHERE name = ?').run(req.params.name);
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`소비 정리 서버 실행 중: http://localhost:${PORT}`);
  console.log('같은 네트워크의 다른 기기에서는 이 컴퓨터의 LAN IP로 접속하세요 (예: http://192.168.0.10:3000)');
});
