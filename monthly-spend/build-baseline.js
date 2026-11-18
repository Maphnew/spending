'use strict';
const fs = require('fs');
const path = require('path');
const Database = require(require.resolve('better-sqlite3', { paths: [path.dirname(process.env.SPENDING_DB || path.resolve(__dirname, '../spending.db'))] }));
const root = __dirname;
const data = path.join(root, 'data');
const sourcePath = process.env.SPENDING_DB || path.resolve(__dirname, '../spending.db');
const stamp = new Date().toISOString();
const dateFromSerial = (s, mode) => {
  const digits = String(Number(s));
  if (/^\d{8}$/.test(digits)) {
    const iso = `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`;
    const parsed = new Date(iso+'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === iso ? iso : null;
  }
  if (!s || !Number.isFinite(Number(s)) || Number(s) < 1 || Number(s) > 100000) return null;
  return new Date(Date.UTC(mode ? 1904 : 1899, mode ? 0 : 11, mode ? 1 : 30) + Number(s) * 86400000).toISOString().slice(0, 10);
};
const localDate = at => at == null ? null : new Date(at + 9 * 3600000).toISOString().slice(0, 10);
async function main() {
  fs.mkdirSync(data, { recursive: true });
  const snapshotPath = path.join(data, 'spending-initial.db');
  if (!fs.existsSync(snapshotPath)) {
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try { await source.backup(snapshotPath); } finally { source.close(); }
  }
  const source = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  let sourceRows;
  try { sourceRows = source.prepare('SELECT * FROM transactions').all(); } finally { source.close(); }
  const snapshots = fs.readdirSync(path.join(data, 'sheets')).filter(f => f.endsWith('.json') && !f.endsWith('.error.json')).map(f => JSON.parse(fs.readFileSync(path.join(data, 'sheets', f), 'utf8')));
  const expectedIds = [...new Set([...fs.readFileSync(path.join(root, 'README.md'), 'utf8').matchAll(/https:\/\/docs.google.com\/spreadsheets\/d\/([^/]+)\//g)].map(m => m[1]))];
  const db = new Database(path.join(data, 'monthly-spend.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_snapshots (id TEXT PRIMARY KEY, captured_at TEXT, sha256 TEXT, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS raw_cells (source_id TEXT, tab TEXT, address TEXT, value TEXT, formula TEXT, PRIMARY KEY(source_id,tab,address));
    CREATE TABLE IF NOT EXISTS sheet_transactions (id TEXT PRIMARY KEY, source_id TEXT, tab TEXT, row_num INTEGER, kind TEXT, date TEXT, date_basis TEXT, amount INTEGER, description TEXT, category TEXT, review TEXT);
    CREATE TABLE IF NOT EXISTS sheet_summaries (source_id TEXT, row_num INTEGER, kind TEXT, category TEXT, planned INTEGER, actual INTEGER, PRIMARY KEY(source_id,row_num,kind));
    CREATE TABLE IF NOT EXISTS spending_transactions (id TEXT PRIMARY KEY, date TEXT, amount INTEGER, merchant TEXT, category TEXT, canceled INTEGER, payload TEXT);
    CREATE TABLE IF NOT EXISTS duplicate_candidates (sheet_id TEXT, spending_id TEXT, reason TEXT, PRIMARY KEY(sheet_id,spending_id));
    CREATE TABLE IF NOT EXISTS baseline_metadata (key TEXT PRIMARY KEY, value TEXT);
  `);
  const reports = [];
  try {
    db.transaction(() => {
      for (const table of ['source_snapshots','raw_cells','sheet_transactions','sheet_summaries','spending_transactions','duplicate_candidates','baseline_metadata']) db.prepare(`DELETE FROM ${table}`).run();
      const cellInsert = db.prepare('INSERT INTO raw_cells VALUES (?,?,?,?,?)');
      const txInsert = db.prepare('INSERT INTO sheet_transactions VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      const summaryInsert = db.prepare('INSERT INTO sheet_summaries VALUES (?,?,?,?,?,?)');
      for (const s of snapshots) {
        db.prepare('INSERT INTO source_snapshots VALUES (?,?,?,?)').run(s.spreadsheetId,s.capturedAt,s.sha256,JSON.stringify(s));
        let expense = 0, income = 0, extraIncome = 0, review = 0;
        let summaryExpense = null, summaryIncome = null;
        for (const tab of s.tabs) {
          const cells = Object.fromEntries(tab.cells.map(c => [c.address,c]));
          const value = a => cells[a] ? cells[a].value : '';
          for (const c of tab.cells) cellInsert.run(s.spreadsheetId,tab.name,c.address,c.value,c.formula);
          if (tab.name === '요약') {
            for (const side of [{kind:'expense',label:'B',plan:'D',actual:'E'}, {kind:'income',label:'H',plan:'J',actual:'K'}]) {
              for (let row = 26; row <= 100; row++) {
                const label = value(side.label+row), planned = value(side.plan+row), actual = value(side.actual+row);
                if (!label || actual === '' || !Number.isFinite(Number(actual))) continue;
                summaryInsert.run(s.spreadsheetId,row,side.kind,label,planned === '' ? null : Number(planned),Number(actual));
                if (label === '합계') { if (side.kind === 'expense') summaryExpense = Number(actual); else summaryIncome = Number(actual); }
              }
            }
          }
          if (!['거래','기타소득'].includes(tab.name)) continue;
          const sides = tab.name === '거래' ? [{kind:'expense',cols:['B','C','D','E']},{kind:'income',cols:['G','H','I','J']}] : [{kind:'extra_income',cols:['B','C','D','E']}];
          const maxRow = Math.max(0,...tab.cells.map(c => Number(c.address.match(/\d+$/)[0])));
          for (const side of sides) {
            let lastDate = null;
            for (let row = tab.name === '거래' ? 5 : 3; row <= maxRow; row++) {
              const [dc,ac,mc,cc] = side.cols;
              const rawDate = value(dc+row);
              if (rawDate) lastDate = dateFromSerial(rawDate,s.date1904);
              const amountCell = cells[ac+row];
              if (!amountCell || amountCell.formula || amountCell.value === '' || !Number.isFinite(Number(amountCell.value))) continue;
              const amount = Number(amountCell.value), description = value(mc+row), category = value(cc+row);
              const date = rawDate ? dateFromSerial(rawDate,s.date1904) : lastDate;
              const basis = rawDate && date ? 'explicit' : date ? 'previous_row_candidate' : 'missing';
              const issues = [];
              if (basis !== 'explicit') issues.push('date_needs_review');
              if (rawDate && !date) issues.push('invalid_date');
              if (!Number.isSafeInteger(amount)) issues.push('invalid_integer_amount');
              if (!category) issues.push('missing_category');
              if (/카드.*(대금|납부)|이체/.test(description)) issues.push('possible_transfer');
              if (issues.length) review++;
              txInsert.run(`${s.spreadsheetId}:${tab.name}:${side.kind}:${row}`,s.spreadsheetId,tab.name,row,side.kind,date,basis,amount,description,category,issues.join(','));
              if (side.kind === 'expense') expense += amount; else if (side.kind === 'income') income += amount; else extraIncome += amount;
            }
          }
        }
        const months = db.prepare("SELECT substr(date,1,7) AS month,COUNT(*) AS count FROM sheet_transactions WHERE source_id=? AND kind='expense' AND date_basis='explicit' GROUP BY month ORDER BY count DESC,month").all(s.spreadsheetId);
        const period = months.length ? months[0].month : null;
        const periodLabel = period ? `${period.slice(0,4)}년 ${Number(period.slice(5))}월` : '기간 미확인';
        reports.push({source:s.spreadsheetId,period,periodLabel,expenseMonths:months,expense,income,extraIncome,summaryExpense,summaryIncome,expenseDifference:summaryExpense == null ? null : expense-summaryExpense,incomeDifference:summaryIncome == null ? null : income-summaryIncome,review});
      }
      const insertSpending = db.prepare('INSERT INTO spending_transactions VALUES (?,?,?,?,?,?,?)');
      for (const r of sourceRows) insertSpending.run(r.id,localDate(r.at),r.amount,r.merchant,r.category,r.canceled,JSON.stringify(r));
      db.exec(`INSERT INTO duplicate_candidates SELECT s.id,d.id,'same_kst_date_and_amount_review_required' FROM sheet_transactions s JOIN spending_transactions d ON s.date=d.date AND s.amount=d.amount WHERE s.kind='expense' AND d.canceled=0 AND s.date IS NOT NULL`);
      db.prepare('INSERT INTO baseline_metadata VALUES (?,?)').run('built_at',stamp);
      db.prepare('INSERT INTO baseline_metadata VALUES (?,?)').run('source_db',sourcePath);
      db.prepare('INSERT INTO baseline_metadata VALUES (?,?)').run('status','review_required');
    })();
    const counts = {
      sheets:snapshots.length,expectedSheets:expectedIds.length,spending:sourceRows.length,
      sheetTransactions:db.prepare('SELECT kind,COUNT(*) count FROM sheet_transactions GROUP BY kind').all(),
      duplicatePairs:db.prepare('SELECT count(*) count FROM duplicate_candidates').get().count,
      duplicateSheetRows:db.prepare('SELECT count(DISTINCT sheet_id) count FROM duplicate_candidates').get().count,
      spendingMissingDates:sourceRows.filter(r=>r.at == null).length,
      spendingCanceled:sourceRows.filter(r=>r.canceled).length,
      sheetDateRange:db.prepare('SELECT min(date) first,max(date) last FROM sheet_transactions').get(),
      spendingDateRange:db.prepare('SELECT min(date) first,max(date) last FROM spending_transactions').get()
    };
    if (db.pragma('integrity_check', {simple:true}) !== 'ok') throw new Error('SQLite integrity check failed');
    const report = {builtAt:stamp,status:'review_required',missingSheets:expectedIds.filter(id=>!snapshots.some(s=>s.spreadsheetId===id)),counts,sheets:reports,notes:['Dates filled from a previous row are candidates and require review.','Duplicate candidates use KST date and amount only; no automatic exclusion or combined spending total.','Extra income is separate from regular income.','Summary rows are comparison data and must not be added to transactions.']};
    fs.writeFileSync(path.join(data,'baseline-report.json'),JSON.stringify(report,null,2)+'\n');
    const invalidDates = db.prepare("SELECT source_id,tab,row_num FROM sheet_transactions WHERE review LIKE '%invalid_date%'").all();
    const markdown = [
      '# 최초 수집 결과', '', `생성 시각: ${stamp}`, '',
      `시트 ${counts.sheets}/${counts.expectedSheets}개, DB 거래 ${counts.spending}건을 분석용 DB에 저장했습니다. 원본 DB는 수정하지 않았습니다.`, '',
      ...counts.sheetTransactions.map(r=>`- 시트 ${r.kind}: ${r.count}건`),
      `- 날짜·금액이 같은 DB 중복 후보가 있는 시트 지출: ${counts.duplicateSheetRows}건 (${counts.duplicatePairs}개 조합)`,
      `- DB 날짜 누락: ${counts.spendingMissingDates}건, 취소 표시: ${counts.spendingCanceled}건`,
      `- 시트 날짜 범위(앞 행 날짜 추정 포함): ${counts.sheetDateRange.first} ~ ${counts.sheetDateRange.last}`,
      `- DB 날짜 범위(한국 시간): ${counts.spendingDateRange.first} ~ ${counts.spendingDateRange.last}`, '',
      '## 원본 요약표와 지출 거래 합계 비교', '',
      '| 연월 | 거래 합계 | 요약표 합계 | 차이(거래−요약) | 검토 거래 수 |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...[...reports].sort((a,b)=>(a.period || '').localeCompare(b.period || '')).map(r=>`| ${r.periodLabel} | ${r.expense.toLocaleString('en-US')} | ${r.summaryExpense == null ? '없음' : r.summaryExpense.toLocaleString('en-US')} | ${r.expenseDifference} | ${r.review} |`), '',
      '연월은 명시된 지출 날짜 중 거래 건수가 가장 많은 달을 기준으로 표시했습니다. 다른 달의 거래도 원본대로 유지합니다.', '',
      ...reports.filter(r=>r.expenseMonths.length>1).map(r=>`- ${r.periodLabel} 시트에는 ${r.expenseMonths.slice(1).map(m=>`${m.month} 거래 ${m.count}건`).join(', ')}도 포함되어 있습니다.`), '',
      '## 검토 사항', '',
      '- 중복 후보는 날짜와 금액만 비교한 결과입니다. 설명과 분할 결제 여부를 검토하기 전에는 자동 제외하지 않았습니다.',
      '- 날짜가 비어 있으면 앞 행 날짜를 후보로 저장했습니다. 확정 날짜와 구분합니다.',
      '- 시트 요약표는 대조용이며 거래 합계에 더하지 않습니다. 차이가 있는 시트는 수식 범위·분류·수기 수정 여부를 확인해야 합니다.',
      '- 기타소득 탭 3건은 일반 수입과 별도로 보관합니다. 합계 수식 행은 거래에서 제외했습니다.',
      ...invalidDates.map(r=>`- 유효하지 않은 원본 날짜: ${reports.find(s=>s.source===r.source_id).periodLabel} 시트, ${r.tab} 탭 ${r.row_num}행. 원본 셀을 유지하고 날짜는 미확정으로 저장했습니다.`),
      '- 현재 상태는 검토 필요입니다. 전체 수집은 완료했으며, 중복과 원본 불일치를 해결하기 전에는 통합 지출 합계를 확정하지 않습니다.', '',
      '원본 XLSX·셀 JSON: `data/sheets/`, 최초 DB 사본: `data/spending-initial.db`, 분석용 DB: `data/monthly-spend.db`, 상세 결과: `data/baseline-report.json`.', ''
    ].join('\n');
    fs.writeFileSync(path.join(data,'baseline-report.md'),markdown);
    console.log(JSON.stringify(report,null,2));
  } finally { db.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
