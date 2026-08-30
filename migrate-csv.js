'use strict';

/* 브라우저 localStorage 시절 데이터를 옮기기 위한 1회성 스크립트.
   앱의 "CSV 내보내기"로 뽑은 파일(날짜,금액,설명,카테고리)을 그대로 읽어 DB에 넣는다.
   사용법: node migrate-csv.js <csv 경로>
   설명 칸은 "가맹점 (카드)" 형식이므로 맨 끝 괄호를 카드로, 나머지를 가맹점으로 되돌린다. */

const fs = require('node:fs');
const crypto = require('node:crypto');
const db = require('./db');

const UNKNOWN_CARD = '카드 미상';

const file = process.argv[2];
if (!file) {
  console.error('사용법: node migrate-csv.js <csv 경로>');
  process.exit(1);
}

/** 이 프로젝트가 내보내는 "필드","필드" 형식(따옴표 안 ""로 이스케이프)만 다루는 최소 CSV 파서. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); if (row.some((f) => f !== '')) rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
    }
  }
  if (field || row.length) endRow();
  return rows;
}

const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
const [header, ...data] = parseCsv(text);
if (!header || header.join(',') !== '날짜,금액,설명,카테고리') {
  console.warn('헤더가 예상(날짜,금액,설명,카테고리)과 다르지만, 열 순서대로 그대로 진행합니다:', header && header.join(','));
}

const insertTx = db.prepare(`
  INSERT INTO transactions (id, at, amount, merchant, card, running, category, canceled, manual)
  VALUES (@id, @at, @amount, @merchant, @card, @running, @category, @canceled, @manual)
`);
const insertCard = db.prepare('INSERT OR IGNORE INTO cards (name) VALUES (?)');

let imported = 0;
let skipped = 0;

const run = db.transaction((rows) => {
  for (const [dateStr, amountStr, desc, category] of rows) {
    const amount = Number(amountStr);
    if (!desc || !Number.isFinite(amount) || amount === 0) { skipped++; continue; }

    const match = desc.match(/^(.*) \(([^()]*)\)$/);
    const merchant = (match ? match[1] : desc).trim();
    const card = match ? match[2].trim() : UNKNOWN_CARD;
    const at = dateStr ? new Date(`${dateStr}T00:00:00`).getTime() : null;

    insertTx.run({
      id: crypto.randomUUID(),
      at: Number.isFinite(at) ? at : null,
      amount,
      merchant,
      card: card || UNKNOWN_CARD,
      running: null,
      category: category || '기타',
      canceled: amount < 0 ? 1 : 0,
      manual: 1, // 중복 검사 없이 그대로 담는다 — 마이그레이션은 한 번만 돌리는 걸 전제로 함
    });
    if (card && card !== UNKNOWN_CARD) insertCard.run(card);
    imported++;
  }
});
run(data);

console.log(`${imported}건을 가져왔습니다${skipped ? ` (건너뜀 ${skipped}건)` : ''}.`);
