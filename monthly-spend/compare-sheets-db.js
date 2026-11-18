'use strict';
const fs = require('fs');
const path = require('path');
const sourcePath = process.env.SPENDING_DB || path.resolve(__dirname, '../spending.db');
const Database = require(require.resolve('better-sqlite3',{paths:[path.dirname(sourcePath)]}));
const data = path.join(__dirname,'data');
const source = new Database(sourcePath,{readonly:true,fileMustExist:true});
const analysis = new Database(path.join(data,'monthly-spend.db'),{readonly:true,fileMustExist:true});
try {
  const rows = source.prepare('SELECT * FROM transactions').all();
  const sheets = analysis.prepare("SELECT * FROM sheet_transactions WHERE kind='expense' ORDER BY CASE date_basis WHEN 'explicit' THEN 0 ELSE 1 END,source_id,row_num").all();
  const metadata = JSON.parse(fs.readFileSync(path.join(data,'baseline-report.json'),'utf8'));
  const periods = Object.fromEntries(metadata.sheets.map(s=>[s.source,s.periodLabel]));
  const normalize = s=>s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
  const date = r=>r.at == null ? null : new Date(r.at+9*3600000).toISOString().slice(0,10);
  const byDateAmount = new Map();
  for (const r of rows) {
    if (r.canceled || r.at == null) continue;
    const key = `${date(r)}:${r.amount}`;
    if (!byDateAmount.has(key)) byDateAmount.set(key,[]);
    byDateAmount.get(key).push(r);
  }
  const used = new Set();
  const results = [];
  // Match each DB transaction at most once. Explicit dates take precedence.
  for (const s of sheets) {
    const candidates = s.date == null ? [] : byDateAmount.get(`${s.date}:${s.amount}`) || [];
    const sameName = candidates.filter(r=>normalize(s.description) && normalize(s.description)===normalize(r.merchant));
    const available = sameName.filter(r=>!used.has(r.id));
    let status = s.date == null ? 'missing_date' : 'no_date_amount_match';
    let match = null;
    if (available.length) {
      match=available[0];
      used.add(match.id);
      status=s.date_basis==='explicit' ? 'exact_match' : 'inferred_date_match';
    } else if (sameName.length) status='same_name_db_already_matched';
    else if (candidates.length) status='date_amount_only';
    results.push({period:periods[s.source_id],sheetId:s.id,sourceId:s.source_id,row:s.row_num,date:s.date,dateBasis:s.date_basis,amount:s.amount,description:s.description,category:s.category,status,dbId:match ? match.id : null,dbCategory:match ? match.category : null,candidates:candidates.map(r=>({id:r.id,merchant:r.merchant,category:r.category,alreadyMatched:false}))});
  }
  for (const r of results) for (const c of r.candidates) c.alreadyMatched=used.has(c.id);
  const statuses = ['exact_match','inferred_date_match','same_name_db_already_matched','date_amount_only','no_date_amount_match','missing_date'];
  const summarize = list=>Object.fromEntries(statuses.map(status=>[status,list.filter(r=>r.status===status).length]));
  const summary=summarize(results);
  const monthly=metadata.sheets.map(s=>({period:s.period,periodLabel:s.periodLabel,...summarize(results.filter(r=>r.sourceId===s.source))})).sort((a,b)=>a.period.localeCompare(b.period));
  const report={comparedAt:new Date().toISOString(),sourceDb:sourcePath,sourceCount:rows.length,sheetExpenseCount:sheets.length,summary,monthly,exactMatchedAmount:results.filter(r=>r.status==='exact_match').reduce((n,r)=>n+r.amount,0),categoryDifferences:results.filter(r=>r.status==='exact_match'&&r.category!==r.dbCategory).length,results};
  fs.writeFileSync(path.join(data,'cross-source-duplicates.json'),JSON.stringify(report,null,2)+'\n');
  const money=n=>n.toLocaleString('en-US');
  const safe=s=>String(s || '').replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');
  const md=[
    '# DB와 시트 간 중복 비교','',`비교 시각: ${report.comparedAt}`,'',
    `최신 spending DB ${rows.length}건과 시트 지출 ${sheets.length}건을 읽기 전용으로 비교했습니다. 취소 거래는 일치 대상에서 제외했습니다.`,'',
    `- 날짜·금액·가맹점/설명 일치: ${summary.exact_match}건, ${money(report.exactMatchedAmount)}원`,
    `- 앞 행에서 추정한 날짜·금액·가맹점/설명 일치: ${summary.inferred_date_match}건`,
    `- 같은 내용의 DB 거래가 이미 다른 시트 행과 대응됨: ${summary.same_name_db_already_matched}건`,
    `- 날짜·금액만 일치하고 가맹점/설명이 다름: ${summary.date_amount_only}건`,
    `- 날짜·금액 일치 없음: ${summary.no_date_amount_match}건`,
    `- 시트 날짜 미확정: ${summary.missing_date}건`,
    `- 날짜·금액·이름 일치 거래 중 분류가 다른 경우: ${report.categoryDifferences}건`,'',
    '## 월별 결과','',
    '| 연월 | 날짜·금액·이름 일치 | 추정 날짜 일치 | DB 이미 대응 | 날짜·금액만 일치 | 날짜·금액 일치 없음 | 날짜 미확정 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...monthly.map(r=>`| ${r.periodLabel} | ${statuses.map(s=>r[s]).join(' | ')} |`),'',
    '## 판단 기준','',
    '날짜는 한국 시간 기준이며 시트의 실제 거래 날짜를 사용합니다. 연월 표시는 시트의 대표 월입니다. 이름 비교 시 공백·문장부호·기호와 영문 대소문자 차이를 무시합니다. 한 DB 거래를 여러 시트 거래와 중복 대응하지 않습니다. 동일한 이름의 후보가 여러 개인 경우 어떤 ID를 대응하는지는 확정 근거가 아닙니다.','',
    '날짜·금액·이름이 일치한 건은 출처 간 중복 가능성이 높습니다. 시트와 DB가 같은 결제를 나타낸다면 분석 시 DB 거래를 남기고 시트 거래는 합산에서 제외할 수 있습니다. 원본 DB에서 해당 거래를 삭제하는 방식은 사용하지 않습니다. 실제 반복 결제, 항목별 분할, 날짜 추정 및 분류 차이는 별도 검토가 필요합니다. 이번 비교는 원본 및 분석용 DB를 변경하지 않았습니다.','',
    '## 일치 사례 (최대 10건)','',
    '| 연월 | 날짜 | 설명 | 금액 | 시트 행 |',
    '| --- | --- | --- | ---: | ---: |',
    ...results.filter(r=>r.status==='exact_match').slice(0,10).map(r=>`| ${r.period} | ${r.date} | ${safe(r.description)} | ${money(r.amount)} | ${r.row} |`),'',
    '## 추가 검토 거래','',
    '| 연월 | 날짜 | 시트 설명 | 금액 | 시트 행 | 상태 | DB 후보 설명 |',
    '| --- | --- | --- | ---: | ---: | --- | --- |',
    ...results.filter(r=>!['exact_match','no_date_amount_match'].includes(r.status)).map(r=>`| ${r.period} | ${r.date || '미확정'} | ${safe(r.description)} | ${money(r.amount)} | ${r.row} | ${r.status} | ${safe([...new Set(r.candidates.map(c=>c.merchant))].join(', '))} |`),'',
    '전체 비교 내역과 거래 ID는 `cross-source-duplicates.json`에 저장했습니다.',''
  ].join('\n');
  fs.writeFileSync(path.join(data,'cross-source-duplicates.md'),md);
  if (Object.values(summary).reduce((n,v)=>n+v,0)!==sheets.length || used.size!==summary.exact_match+summary.inferred_date_match) throw new Error('Comparison count mismatch');
  console.log(JSON.stringify({sourceCount:rows.length,sheetExpenseCount:sheets.length,summary,monthly,exactMatchedAmount:report.exactMatchedAmount,categoryDifferences:report.categoryDifferences},null,2));
} finally {source.close();analysis.close();}
