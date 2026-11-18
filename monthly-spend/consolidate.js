'use strict';
const fs=require('fs'),path=require('path');
const sourcePath=process.env.SPENDING_DB || path.resolve(__dirname, '../spending.db');
const Database=require(require.resolve('better-sqlite3',{paths:[path.dirname(sourcePath)]}));
const data=path.join(__dirname,'data');
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const name=s=>norm(String(s||'').replace(/\s+\([^()]*(?:카드|coway)[^()]*\)\s*$/i,'')).replace(/^모바일티머니충전$/,'티머니충전');
const day=at=>at==null?null:new Date(at+32400000).toISOString().slice(0,10);
const sum=rs=>rs.reduce((n,r)=>n+r.amount,0);
async function main(){
 const run=new Date().toISOString().replace(/[:.]/g,'-');
 const snapshot=path.join(data,'snapshots',`spending-${run}.db`);
 fs.mkdirSync(path.dirname(snapshot),{recursive:true});
 const live=new Database(sourcePath,{readonly:true,fileMustExist:true});
 try{await live.backup(snapshot);}finally{live.close();}
 const db=new Database(snapshot,{readonly:true,fileMustExist:true});
 const base=new Database(path.join(data,'monthly-spend.db'),{readonly:true,fileMustExist:true});
 let raw,ss,rawCells;
 try{raw=db.prepare('SELECT * FROM transactions ORDER BY rowid').all();ss=base.prepare('SELECT * FROM sheet_transactions').all();rawCells=base.prepare("SELECT * FROM raw_cells WHERE tab='거래'").all();}finally{db.close();base.close();}
 const cells=new Map(rawCells.map(r=>[`${r.source_id}:${r.address}`,r.value]));
 const baseline=JSON.parse(fs.readFileSync(path.join(data,'baseline-report.json'),'utf8'));
 const periods=Object.fromEntries(baseline.sheets.map(s=>[s.source,s.period]));
 const exclusions=[],reviews=[],links=[],ledger=[],seenDb=new Map();
 for(const r of raw){
   const key=JSON.stringify([r.at,r.amount,name(r.merchant),norm(r.card),r.running,r.category,r.canceled,r.manual]);
   if(r.at!=null&&seenDb.has(key)){exclusions.push({source:'db',id:r.id,keptId:seenDb.get(key),amount:r.amount,reason:'all_fields_equal_after_name_normalization'});continue;}
   if(r.at!=null)seenDb.set(key,r.id);
   ledger.push({id:`db:${r.id}`,source:'db',originalId:r.id,kind:'expense',date:day(r.at),dateBasis:r.at==null?'missing':'explicit',amount:r.amount,description:r.merchant,category:r.category,sourcePeriod:null,canceled:r.canceled});
 }
 const dbRows=[...ledger],used=new Set(),seenSheet=new Map();
 const byKey=new Map();
 for(const r of dbRows){if(!r.date)continue;const k=`${r.date}:${r.amount}:${name(r.description)}`;if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(r);}
 // Prefer explicit sheet dates when matching an individual DB transaction.
 ss.sort((a,b)=>(a.date_basis==='explicit'?0:1)-(b.date_basis==='explicit'?0:1)||a.id.localeCompare(b.id));
 for(const s of ss){
   let date=s.date,basis=s.date_basis;
   if(!date){
     const v=cells.get(`${s.source_id}:B${s.row_num}`)||'';
     const m=v.match(/^(\d{4})[년녀]\s*(\d{1,2})월\s*(\d{1,2})일$/);
     if(m){const candidate=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;const d=new Date(candidate+'T00:00:00Z');if(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===candidate){date=candidate;basis='corrected_date_typo';reviews.push({id:s.id,reason:'date_typo_corrected',original:v,date});}}
   }
   const kind=s.kind==='expense'?'expense':'income';
   const key=JSON.stringify([s.source_id,kind,date,s.amount,name(s.description),s.category]);
   if(date&&seenSheet.has(key)){exclusions.push({source:'sheet',id:s.id,keptId:seenSheet.get(key),amount:s.amount,reason:'duplicate_sheet_row'});continue;}
   if(date)seenSheet.set(key,s.id);
   const matches=kind==='expense'&&date?(byKey.get(`${date}:${s.amount}:${name(s.description)}`)||[]).filter(r=>!used.has(r.id)):[];
   if(matches.length){
     const match=matches[0];used.add(match.id);
     exclusions.push({source:'sheet',id:s.id,keptId:match.id,amount:s.amount,reason:'same_date_amount_normalized_name',dateBasis:basis});
     links.push({sheetId:s.id,dbId:match.id,date,amount:s.amount,dateBasis:basis,sheetDescription:s.description,dbDescription:match.description,sheetCategory:s.category,dbCategory:match.category});
     continue;
   }
   const row={id:`sheet:${s.id}`,source:'sheet',originalId:s.id,kind,date,dateBasis:basis,amount:s.amount,description:s.description,category:s.category,sourcePeriod:periods[s.source_id],canceled:0,incomeType:s.kind==='extra_income'?'extra':'regular'};
   ledger.push(row);
   if(kind==='expense'){
     const candidates=dbRows.filter(r=>date&&r.date===date&&r.amount===s.amount);
     if(candidates.length)reviews.push({id:s.id,reason:'same_date_amount_different_name',date,amount:s.amount,description:s.description,candidates:candidates.map(r=>({id:r.id,description:r.description,category:r.category,alreadyMatched:used.has(r.id)}))});
   }
 }
 // Historical imports contain shifted dates. Match residual same-month/name/amount/category
 // one-to-one as an explicit assumption, while retaining both dates in the audit trail.
 const inferredMatches=[];
 const residual=ledger.filter(r=>r.source==='sheet'&&r.kind==='expense'&&r.date&&r.amount!==0);
 for(const s of residual){
   const candidates=dbRows.filter(d=>!used.has(d.id)&&d.date&&d.date.slice(0,7)===s.date.slice(0,7)&&d.amount===s.amount&&name(d.description)===name(s.description)&&d.category===s.category);
   candidates.sort((a,b)=>Math.abs(new Date(a.date)-new Date(s.date))-Math.abs(new Date(b.date)-new Date(s.date))||a.id.localeCompare(b.id));
   if(!candidates.length)continue;
   const d=candidates[0];used.add(d.id);
   ledger.splice(ledger.indexOf(s),1);
   const link={sheetId:s.originalId,dbId:d.id,date:s.date,dbDate:d.date,amount:s.amount,dateBasis:s.dateBasis,sheetDescription:s.description,dbDescription:d.description,sheetCategory:s.category,dbCategory:d.category,reason:'assumed_same_month_amount_name_category',candidateCount:candidates.length};
   inferredMatches.push(link);links.push(link);
   exclusions.push({source:'sheet',id:s.originalId,keptId:d.id,amount:s.amount,reason:link.reason,sheetDate:s.date,dbDate:d.date,candidateCount:candidates.length});
 }
 // Keep review candidates only for rows that still contribute to the total.
 const retained=new Set(ledger.filter(r=>r.source==='sheet').map(r=>r.originalId));
 for(let i=reviews.length-1;i>=0;i--)if(reviews[i].reason==='same_date_amount_different_name'&&!retained.has(reviews[i].id))reviews.splice(i,1);
 const expenses=ledger.filter(r=>r.kind==='expense'),incomes=ledger.filter(r=>r.kind==='income');
 const months=[...new Set(ledger.filter(r=>r.date).map(r=>r.date.slice(0,7)))].sort();
 const monthly=months.map(month=>{
   const es=expenses.filter(r=>r.date&&r.date.startsWith(month)),ins=incomes.filter(r=>r.date&&r.date.startsWith(month));
   const covered=Object.values(periods).includes(month);
   return {month,expense:sum(es),expenseCount:es.length,dbExpense:sum(es.filter(r=>r.source==='db')),sheetAddedExpense:sum(es.filter(r=>r.source==='sheet')),regularIncome:covered?sum(ins.filter(r=>r.incomeType==='regular')):null,extraIncome:covered?sum(ins.filter(r=>r.incomeType==='extra')):null,recordedBalance:covered?sum(ins)-sum(es):null,partialMonth:month===months[months.length-1]};
 });
 const categories=[...new Set(expenses.map(r=>r.category))].map(category=>({category,amount:sum(expenses.filter(r=>r.category===category)),count:expenses.filter(r=>r.category===category).length})).sort((a,b)=>b.amount-a.amount);
 const dbExcluded=exclusions.filter(r=>r.source==='db'),sheetExcluded=exclusions.filter(r=>r.source==='sheet');
 const totals={dbOriginalRows:raw.length,dbNormalizedDuplicates:dbExcluded.length,sheetOriginalExpenses:ss.filter(r=>r.kind==='expense').length,sheetCrossSourceDuplicates:links.length,sameMonthAssumedDuplicates:inferredMatches.length,sameMonthAssumedAmount:sum(inferredMatches),sheetInternalDuplicates:sheetExcluded.filter(r=>r.reason==='duplicate_sheet_row').length,sheetAddedExpenses:expenses.filter(r=>r.source==='sheet').length,expenseCount:expenses.length,netExpense:sum(expenses),datedExpense:sum(expenses.filter(r=>r.date)),undatedExpense:sum(expenses.filter(r=>!r.date)),regularIncome:sum(incomes.filter(r=>r.incomeType==='regular')),extraIncome:sum(incomes.filter(r=>r.incomeType==='extra')),unresolvedCandidates:reviews.filter(r=>r.reason==='same_date_amount_different_name').length};
 const expected=sum(raw)-sum(dbExcluded)+sum(ss.filter(r=>r.kind==='expense'))-sum(sheetExcluded);
 if(expected!==totals.netExpense||monthly.reduce((n,m)=>n+m.expense,0)+totals.undatedExpense!==totals.netExpense)throw new Error('Expense reconciliation failed');
 const out=new Database(path.join(data,'consolidated.db'));
 try{
   out.exec('CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,source TEXT,kind TEXT,date TEXT,amount INTEGER,description TEXT,category TEXT,payload TEXT);CREATE TABLE IF NOT EXISTS exclusions(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT);');
   out.transaction(()=>{out.exec('DELETE FROM ledger;DELETE FROM exclusions;DELETE FROM metadata;');const insert=out.prepare('INSERT INTO ledger VALUES (?,?,?,?,?,?,?,?)');for(const r of ledger)insert.run(r.id,r.source,r.kind,r.date,r.amount,r.description,r.category,JSON.stringify(r));for(const r of exclusions)out.prepare('INSERT INTO exclusions VALUES (?,?)').run(`${r.source}:${r.id}`,JSON.stringify(r));out.prepare('INSERT INTO metadata VALUES (?,?)').run('snapshot',snapshot);})();// Review decisions live in the report; source and baseline DBs remain unchanged.
   if(out.pragma('integrity_check',{simple:true})!=='ok')throw new Error('Consolidated integrity failed');
 }finally{out.close();}
 const report={builtAt:new Date().toISOString(),sourceSnapshot:snapshot,status:totals.unresolvedCandidates||inferredMatches.length?'provisional_with_review_items':'deduplicated',totals,monthly,categories,exclusions,links,reviews,ledger};
 fs.writeFileSync(path.join(data,'consolidated-report.json'),JSON.stringify(report,null,2)+'\n');
 const money=n=>n==null?'미수집':n.toLocaleString('en-US');
 const md=['# DB·시트 통합 지출','',`생성 시각: ${report.builtAt}`,'',
 `중복 제외 후 순지출 합계: **${money(totals.netExpense)}원** (${totals.expenseCount}건). 환불은 음수로 차감했습니다.`,
 `날짜 확정·추정 거래 합계 ${money(totals.datedExpense)}원, 날짜 없는 거래 ${money(totals.undatedExpense)}원.`, '',
 '## 통합 기준','',
 '- 최신 DB를 우선합니다. 시트의 같은 날짜·금액·정규화한 이름 거래를 일대일 대응하고 시트 쪽을 합산에서 제외합니다.',
 '- 카드명 접미사, 공백·기호·영문 대소문자 차이를 제거합니다. 모바일티머니충전과 티머니충전은 같은 이름으로 취급합니다.',
 '- 날짜가 달라도 같은 달·금액·이름·분류가 같은 미대응 거래는 중복으로 추정해 일대일 대응합니다. 후보가 여러 개면 날짜가 가까운 거래를 우선합니다. DB 날짜를 집계 기준으로 유지하며 양쪽 날짜와 후보 수를 기록합니다. 실제 반복 결제인 경우와 구분이 필요하므로 이 기준의 결과는 잠정입니다.',
 '- DB의 모든 필드가 같은 거래는 이름 표기를 정규화한 뒤 분석에서 한 건만 남깁니다. 실제 원본 DB는 수정하지 않았습니다.',
 '- 동일 시트의 같은 날짜·금액·이름·분류 반복 행은 한 건으로 처리합니다. 앞 행에서 이어 받은 날짜 9건은 추정임을 보존합니다.',
 '- 2026녀1월9일은 2026-01-09로 정리했습니다. 변경 전 원본은 유지하며 상세 보고서에 기록했습니다.',
 '- 음수 취소 내역은 순지출에서 차감합니다. 날짜 없는 환불은 월별 합계에 배정하지 않습니다. 양수 취소 표시가 있더라도 금액 부호를 임의로 바꾸지 않습니다.',
 '- 요약표의 계획·실제 합계는 거래에 더하지 않습니다. 월은 시트 대표 월이 아니라 실제 거래 날짜 기준입니다.',
 '- 분류가 다른 중복 거래는 DB 분류를 사용합니다. 과거 시트의 수입과 기타소득은 별도로 표시하며, 수입이 없는 기간을 0원으로 가정하지 않습니다.','',
 '## 제외 및 추가 건수','',
 `- DB 표기 차이 중복 제외: ${totals.dbNormalizedDuplicates}건`,
 `- 시트 내부 중복 제외: ${totals.sheetInternalDuplicates}건`,
 `- DB와 시트 사이 중복 제외: ${totals.sheetCrossSourceDuplicates}건`,
 `- 위 중 같은 달 기준 추정 중복: ${totals.sameMonthAssumedDuplicates}건, ${money(totals.sameMonthAssumedAmount)}원 (확정 중복과 구분)`,
 `- DB에 추가한 시트 지출: ${totals.sheetAddedExpenses}건 (분석용 통합 데이터에만 추가)`,'',
 '## 월별 내역 (원)','',
 '| 연월 | DB 지출 | 시트 추가 지출 | 통합 순지출 | 기록된 일반 수입 | 기타소득 | 기록상 수입−지출 |',
 '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
 ...monthly.map(m=>`| ${m.month}${m.partialMonth?' (진행 중)':''} | ${money(m.dbExpense)} | ${money(m.sheetAddedExpense)} | ${money(m.expense)} | ${money(m.regularIncome)} | ${money(m.extraIncome)} | ${money(m.recordedBalance)} |`),'',
 '수입−지출은 확보된 기록만의 차액입니다. 실제 잔고·저축액을 뜻하지 않으며, 미수집 수입 기간은 계산하지 않습니다. 마지막 달은 마지막 기록일까지 집계했습니다.','',
 '## 분류별 순지출 (전체 확보 기간)','',
 '| 분류 | 금액 | 거래 수 |','| --- | ---: | ---: |',...categories.map(c=>`| ${c.category} | ${money(c.amount)} | ${c.count} |`),'',
 '## 검토가 남은 항목','',
 `날짜·금액은 같지만 이름이 다른 ${totals.unresolvedCandidates}건은 중복이라고 확정하지 않고 각각 포함했습니다. 따라서 이 합계는 확인된 중복을 제외한 잠정 합계입니다.`, '',
 '| 날짜 | 시트 설명 | 금액 | DB 후보 설명 |','| --- | --- | ---: | --- |',
 ...reviews.filter(r=>r.reason==='same_date_amount_different_name').map(r=>`| ${r.date} | ${r.description} | ${money(r.amount)} | ${r.candidates.map(c=>c.description).join(', ')} |`),'',
 '## 시트에서 보충한 지출','',
 '| 날짜 | 설명 | 분류 | 금액 |','| --- | --- | --- | ---: |',
 ...expenses.filter(r=>r.source==='sheet').map(r=>`| ${r.date || '미확정'} | ${r.description || '설명 없음'} | ${r.category || '미분류'} | ${money(r.amount)} |`),'',
 '## 날짜가 달라 중복으로 추정한 거래','',
 `아래 ${inferredMatches.length}건, ${money(sum(inferredMatches))}원은 같은 달·금액·이름·분류 및 일대일 대응을 기준으로 중복이라고 가정했습니다. 확정 전에는 잠정 합계로 사용해야 합니다.`, '',
 '| 시트 날짜 | DB 날짜 | 설명 | 금액 | 매칭 시 후보 수 |','| --- | --- | --- | ---: | ---: |',
 ...inferredMatches.map(r=>`| ${r.date} | ${r.dbDate} | ${r.sheetDescription.replace(/\|/g,'\\|')} | ${money(r.amount)} | ${r.candidateCount} |`),'',
 '기존 시트 요약표와 거래 합계의 차이는 원본 거래를 우선해 처리했습니다. 누락된 거래가 있는지는 별도 확인이 필요합니다. 매칭된 거래의 분류 차이, 추정 날짜, 미확정 후보는 consolidated-report.json에 보존했습니다.','',
 '통합 DB: `consolidated.db`, 거래·출처·제외 사유·매칭 이력: `consolidated-report.json`.',''
 ].join('\n');
 fs.writeFileSync(path.join(data,'consolidated-report.md'),md);
 console.log(JSON.stringify({totals,monthly,categories:categories.slice(0,7)},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
