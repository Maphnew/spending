'use strict';
const fs=require('fs'),path=require('path');
const data=path.join(__dirname,'data');
const source=JSON.parse(fs.readFileSync(path.join(data,'consolidated-report.json'),'utf8'));
const months=Array.from({length:10},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`);
const expenses=source.ledger.filter(r=>r.kind==='expense');
const dated=expenses.filter(r=>r.date&&r.date>='2026-01-01'&&r.date<'2026-11-01');
const savings=dated.filter(r=>/청약/.test(r.description));
const consumption=dated.filter(r=>!/청약/.test(r.description));
const category=r=>/곗돈/.test(r.description)?'곗돈':/보험, 곗돈/.test(r.category)?'보험':r.category||'미분류';
const sum=rs=>rs.reduce((n,r)=>n+r.amount,0);
const total=sum(consumption);
const categoryRows=[...new Set(consumption.map(category))].map(label=>{
 const rs=consumption.filter(r=>category(r)===label);
 const monthly=months.map(month=>({month,amount:sum(rs.filter(r=>r.date.startsWith(month)))}));
 const earlyAverage=monthly.slice(0,3).reduce((n,r)=>n+r.amount,0)/3;
 const recentAverage=monthly.slice(7,10).reduce((n,r)=>n+r.amount,0)/3;
 const merchants=[...new Set(rs.map(r=>r.description))].map(description=>({description,amount:sum(rs.filter(r=>r.description===description))})).sort((a,b)=>b.amount-a.amount).slice(0,5);
 return {category:label,total:sum(rs),average:sum(rs)/10,share:sum(rs)/total*100,monthly,earlyAverage,recentAverage,change:recentAverage-earlyAverage,changePercent:earlyAverage?100*(recentAverage/earlyAverage-1):null,topMerchants:merchants,largestTransactions:[...rs].sort((a,b)=>b.amount-a.amount).slice(0,3)};
}).sort((a,b)=>b.total-a.total);
const monthly=months.map(month=>({month,consumption:sum(consumption.filter(r=>r.date.startsWith(month))),savings:sum(savings.filter(r=>r.date.startsWith(month)))}));
const foodCategories=['식재료','외식','배달','기호식품','회사점심','건강식품'];
const food=categoryRows.filter(r=>foodCategories.includes(r.category)).reduce((n,r)=>n+r.total,0);
const householdFood=categoryRows.filter(r=>['식재료','외식','배달'].includes(r.category)).reduce((n,r)=>n+r.total,0);
const result={builtAt:new Date().toISOString(),sourceBuiltAt:source.builtAt,period:'2026-01~2026-10',status:source.status,consumptionTotal:total,consumptionAverage:total/10,savingsTotal:sum(savings),undatedExpenses:expenses.filter(r=>!r.date),partialNovember:sum(expenses.filter(r=>r.date&&r.date.startsWith('2026-11'))),foodTotal:food,foodAverage:food/10,householdFoodAverage:householdFood/10,monthly,categories:categoryRows};
if(total+sum(savings)!==sum(dated)||categoryRows.reduce((n,r)=>n+r.total,0)!==total)throw new Error('Category reconciliation failed');
fs.writeFileSync(path.join(data,'category-expenses.json'),JSON.stringify(result,null,2)+'\n');
const money=n=>Math.round(n).toLocaleString('en-US');
const safe=s=>String(s||'설명 없음').replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');
const tenThousands=n=>Number((n/10000).toFixed(1));
const topCategories=categoryRows.slice(0,8);
const foodComparison=['식재료','외식','기호식품'].map(label=>categoryRows.find(c=>c.category===label));
const categoryChart=[
 '```mermaid','xychart-beta',
 '    title "주요 카테고리 월평균 (2026년 1~10월)"',
 `    x-axis [${topCategories.map(c=>JSON.stringify(c.category)).join(', ')}]`,
 `    y-axis "만원/월" 0 --> ${Math.ceil(Math.max(...topCategories.map(c=>c.average))/100000)*10}`,
 `    bar [${topCategories.map(c=>tenThousands(c.average)).join(', ')}]`,'```'
];
const monthlyChart=[
 '```mermaid','xychart-beta','    title "2026년 월별 소비 지출"',
 `    x-axis [${months.map((_,i)=>JSON.stringify(`${i+1}월`)).join(', ')}]`,
 `    y-axis "만원" 0 --> ${Math.ceil(Math.max(...monthly.map(m=>m.consumption))/1000000)*100}`,
 `    line [${monthly.map(m=>tenThousands(m.consumption)).join(', ')}]`,'```'
];
const comparisonChart=[
 '```mermaid','xychart-beta','    title "먹는 비용의 초기·최근 월평균 비교"',
 `    x-axis [${foodComparison.flatMap(c=>[JSON.stringify(`${c.category} 초기`),JSON.stringify(`${c.category} 최근`)]).join(', ')}]`,
 `    y-axis "만원/월" 0 --> ${Math.ceil(Math.max(...foodComparison.flatMap(c=>[c.earlyAverage,c.recentAverage]))/100000)*10}`,
 `    bar [${foodComparison.flatMap(c=>[tenThousands(c.earlyAverage),tenThousands(c.recentAverage)]).join(', ')}]`,'```'
];
const md=['# 카테고리별 지출 분석','',`분석 기간: 2026년 1~10월. 최신 통합 시각: ${source.builtAt}`,'',
 `소비 지출 합계 **${money(total)}원**, 월평균 **${money(total/10)}원**. 청약 ${money(sum(savings))}원은 저축으로 분리했고 곗돈은 소비에 포함했습니다.`,'',
 `11월 진행 중 기록 ${money(result.partialNovember)}원과 날짜 없는 환불 ${money(sum(result.undatedExpenses))}원은 이 기간의 카테고리 합계·평균에서 제외했습니다. 기록이 없는 기간은 실제 누락일 수 있으므로 1~10월을 완전한 기록으로 보장하지 않습니다.`, '',
 '## 카테고리별 합계·월평균','',
 ...categoryChart,'',
 '금액이 큰 상위 8개 카테고리입니다. 그래프는 만원 단위 소수점 첫째 자리로 반올림했으며, 전체 카테고리와 정확한 금액은 아래 표에 표시합니다.','',
 '| 카테고리 | 합계 | 월평균(10개월) | 비중 | 1~3월 평균 | 8~10월 평균 | 월평균 차이 |',
 '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
 ...categoryRows.map(c=>`| ${c.category} | ${money(c.total)} | ${money(c.average)} | ${c.share.toFixed(1)}% | ${money(c.earlyAverage)} | ${money(c.recentAverage)} | ${c.change>=0?'+':''}${money(c.change)} |`),'',
 '## 월별 소비 합계','',
 ...monthlyChart,'',
 '| 월 | 소비 | 청약(저축) |','| --- | ---: | ---: |',...monthly.map(m=>`| ${m.month} | ${money(m.consumption)} | ${money(m.savings)} |`),'',
 '## 함께 볼 소비 묶음','',
 ...comparisonChart,'',
 '초기 = 1~3월 월평균, 최근 = 8~10월 월평균입니다. 항목별 두 막대를 비교하면 변화 폭을 볼 수 있습니다.','',
 `- 식재료·외식·배달: 월평균 ${money(householdFood/10)}원`,
 `- 위 항목 + 기호식품·회사점심·건강식품: 월평균 ${money(food/10)}원, 전체 소비의 ${(food/total*100).toFixed(1)}%`,
 '- 고정지출 예산을 이 합계에 더하면 이중 합산됩니다. 이 합계에 이미 월세·이자·보험·구독료·곗돈이 들어 있습니다.','',
 '## 주요 사용처와 큰 거래','',
 ...categoryRows.flatMap(c=>[
 `### ${c.category}`,'',
 `주요 사용처: ${c.topMerchants.map(m=>`${safe(m.description)} ${money(m.amount)}원`).join(', ')}`,'',
 '| 날짜 | 설명 | 금액 |','| --- | --- | ---: |',
 ...c.largestTransactions.map(t=>`| ${t.date} | ${safe(t.description)} | ${money(t.amount)} |`),''
 ]),
 '## 해석 시 유의점','',
 '- 원본 분류를 기본으로 유지하며 곗돈·보험만 분리했습니다. 예를 들어 네이버페이가 식재료, 코웨이가 통신 분류에 들어 있는 등 분류 정확도는 별도 검토가 필요합니다.',
 '- 같은 달·금액·이름·분류를 근거로 날짜가 다른 189건을 중복으로 추정한 통합 규칙을 이어받았습니다. 결과는 잠정 집계입니다.',
 '- 초기 3개월과 최근 3개월 비교는 기록된 금액의 비교이며, 누락·계절·일회성 지출의 영향을 받습니다. 절감 원인이나 생활 습관의 변화로 단정하지 않습니다.',
 '- 청약 분리는 기록된 내역에만 적용했습니다. 소비 합계 변경은 원본 DB와 기존 통합 보고서를 수정하지 않습니다.',''
].join('\n');
fs.writeFileSync(path.join(data,'category-expenses.md'),md);
const csv=[['category','total','monthly_average','share_percent',...months],...categoryRows.map(c=>[c.category,c.total,c.average,c.share,...c.monthly.map(m=>m.amount)])].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
fs.writeFileSync(path.join(data,'category-expenses.csv'),'\uFEFF'+csv);
console.log(JSON.stringify({...result,categories:categoryRows.map(({monthly,topMerchants,largestTransactions,...r})=>r)},null,2));
