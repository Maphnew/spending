'use strict';
const fs = require('fs');
const path = require('path');
const sourcePath = process.env.SPENDING_DB || path.resolve(__dirname, '../spending.db');
const Database = require(require.resolve('better-sqlite3', { paths: [path.dirname(sourcePath)] }));
const fields = ['at','amount','merchant','card','running','category','canceled','manual'];
function plan(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.at == null) continue;
    const key = JSON.stringify(fields.map(f=>row[f]));
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups.values()].filter(g=>g.length>1).map(g=>({keep:g[0],remove:g.slice(1)}));
}
async function main() {
  const source = new Database(sourcePath,{readonly:true,fileMustExist:true});
  const before = source.prepare('SELECT * FROM transactions ORDER BY rowid').all();
  const groups = plan(before);
  const removed = groups.flatMap(g=>g.remove);
  const report = {sourcePath,createdAt:new Date().toISOString(),rule:'All stored fields except id are identical; null dates excluded',before:before.length,after:before.length-removed.length,removedAmount:removed.reduce((n,r)=>n+(r.canceled?0:r.amount),0),groups,applied:false};
  if (!process.argv.includes('--apply') || !removed.length) {
    source.close();
    console.log(JSON.stringify(report,null,2));
    return;
  }
  const dir = path.join(__dirname,'data','cleanup',new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(dir,{recursive:true});
  const backup = path.join(dir,'spending-before.db');
  try { await source.backup(backup); } finally { source.close(); }
  const check = new Database(backup,{readonly:true,fileMustExist:true});
  try {
    if (check.pragma('integrity_check',{simple:true}) !== 'ok') throw new Error('Backup integrity check failed');
    if (JSON.stringify(check.prepare('SELECT * FROM transactions ORDER BY rowid').all()) !== JSON.stringify(before)) throw new Error('Source changed during backup; retry cleanup');
  } finally { check.close(); }
  report.backup=backup;
  const audit=path.join(dir,'cleanup-report.json');
  fs.writeFileSync(audit,JSON.stringify(report,null,2)+'\n');
  const db=new Database(sourcePath,{fileMustExist:true});
  db.pragma('busy_timeout=5000');
  try {
    db.transaction(()=>{
      const current=db.prepare('SELECT * FROM transactions ORDER BY rowid').all();
      if (JSON.stringify(current)!==JSON.stringify(before)) throw new Error('Source changed since planning; retry cleanup');
      const del=db.prepare('DELETE FROM transactions WHERE id=?');
      for (const r of removed) if (del.run(r.id).changes !== 1) throw new Error('Unexpected delete count');
      if (db.prepare('SELECT count(*) n FROM transactions').get().n!==report.after) throw new Error('Unexpected row count');
      if (plan(db.prepare('SELECT * FROM transactions ORDER BY rowid').all()).length) throw new Error('Exact duplicate groups remain');
      if (db.pragma('integrity_check',{simple:true}) !== 'ok') throw new Error('Database integrity check failed');
    }).immediate();
    report.applied=true;
    fs.writeFileSync(audit,JSON.stringify(report,null,2)+'\n');
    const day=at=>new Date(at+9*3600000).toISOString().slice(0,10);
    fs.writeFileSync(path.join(dir,'cleanup-report.md'),[
      '# spending DB 중복 정리', '', `처리 시각: ${report.createdAt}`, '',
      `거래 ${report.before}건 → ${report.after}건. ID를 제외한 모든 필드가 같은 거래 ${removed.length}건을 제거했습니다.`,
      `취소 제외 지출 합계 감소: ${report.removedAmount.toLocaleString('en-US')}원.`, '',
      '| 날짜(한국 시간) | 가맹점 | 제거 금액 | 남긴 ID | 제거 ID |',
      '| --- | --- | ---: | --- | --- |',
      ...groups.flatMap(g=>g.remove.map(r=>`| ${day(r.at)} | ${r.merchant} | ${r.amount} | ${g.keep.id} | ${r.id} |`)), '',
      '수기 입력의 날짜는 실제 결제 시각을 보장하지 않습니다. 같은 날 같은 금액의 실제 반복 결제인 경우를 구분할 근거는 없으며, 이번 정리는 전체 저장값 일치를 기준으로 했습니다.', '',
      '누적금액이 다른 거래와 날짜가 없는 거래는 자동 삭제하지 않았습니다. 시트 원본 및 최초 분석용 스냅샷은 유지했습니다.', '',
      `삭제 전 전체 DB 백업: ${backup}`, '',
      '개별 복구가 필요하면 cleanup-report.json의 groups[].remove에 전체 원본 행이 있습니다. 전체 DB 복구는 이후 신규 입력을 덮어쓸 수 있으므로 해당 행만 복원하는 방식을 우선합니다.', ''
    ].join('\n'));
    console.log(JSON.stringify({...report,audit},null,2));
  } finally { db.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
