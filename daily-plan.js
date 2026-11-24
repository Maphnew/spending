'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const db = require('./db');

const router = express.Router();
const list = db.prepare('SELECT * FROM daily_plans WHERE date = ? ORDER BY rowid');
const insert = db.prepare('INSERT INTO daily_plans (id, date, name, amount) VALUES (@id, @date, @name, @amount)');
const update = db.prepare('UPDATE daily_plans SET date = @date, name = @name, amount = @amount WHERE id = @id');
const remove = db.prepare('DELETE FROM daily_plans WHERE id = ?');

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) return false;
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function readItem(req, res, next) {
  const { date, name, amount } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!validDate(date) || !trimmedName || trimmedName.length > 120 || !Number.isSafeInteger(amount) || amount < 0) {
    return res.status(400).json({ error: '날짜, 항목명, 예정 금액을 확인해 주세요.' });
  }
  req.planItem = { date, name: trimmedName, amount };
  next();
}

router.get('/', (req, res) => {
  if (!validDate(req.query.date)) return res.status(400).json({ error: '날짜를 확인해 주세요.' });
  res.json(list.all(req.query.date));
});

router.post('/', readItem, (req, res) => {
  const item = { id: randomUUID(), ...req.planItem };
  insert.run(item);
  res.status(201).json(item);
});

router.put('/:id', readItem, (req, res) => {
  const item = { id: req.params.id, ...req.planItem };
  if (!update.run(item).changes) return res.sendStatus(404);
  res.json(item);
});

router.delete('/:id', (req, res) => {
  if (!remove.run(req.params.id).changes) return res.sendStatus(404);
  res.status(204).end();
});

module.exports = router;
