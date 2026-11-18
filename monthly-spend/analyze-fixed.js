'use strict';
const fs=require('fs'),path=require('path');
const data=path.join(__dirname,'data');
const report=JSON.parse(fs.readFileSync(path.join(data,'consolidated-report.json'),'utf8'));
const rows=report.ledger.filter(r=>r.kind==='expense'&&r.date&&r.date>='2026-01-01'&&r.date<'2026-11-01'&&r.amount>0);
const definitions=[
 {name:'월세',match:/월세/,budget:261000,note:'9월 261,000원. 8월 260,980원 2회는 납부일 이월 가능성; 청구월 미확인.'},
 {name:'대출이자',match:/대출이자|이자\(신한은행\)|LH자동이체 이자/,budget:290000,note:'9월 290,000원, 8월 290,460원. 금리·일수에 따라 변동.'},
 {name:'관리비',match:/관리비/,budget:262110,note:'9월 262,110원을 임시 기준으로 사용. 관측 185,650~300,090원으로 변동.'},
 {name:'휴대전화',match:/통신비|통신요금|폰요금|핸드폰|세븐모바일/,budget:89600,note:'사용자 확인: 2회선. 최근 44,800원씩 기준. 9월 3회 기록은 추가 납부 또는 중복 여부 미확정.'},
 {name:'인터넷',match:/^인터넷$|SK브로드밴드|SK Broadband/i,budget:34100,note:'표기가 달라도 34,100원 반복. 10월까지 관측.'},
 {name:'iCloud·APPLE',match:/^icloud$|^APPLE$/i,budget:11100,note:'11,100원 반복. 9·10월 APPLE을 같은 구독으로 추정; 영수증 확인 필요.'},
 {name:'코웨이',match:/^코웨이$/,budget:30500,note:'30,500원으로 7개월 관측, 마지막 9월. 계약 유지 여부 확인.'},
 {name:'예지 보험',match:/예지\s*보험/,budget:102140,note:'기존 93,980원, 10월 102,140원. 5월 25,260+68,720원은 합계 93,980원.'},
 {name:'유주 보험·KB손해보험',match:/유주\s*보험|KB손해보험|케이비손해보험/i,budget:17340,note:'13,000원과 4,340원이 별도 보험이라는 가정. 10월 각각 관측. 계약 구분 확인.'},
 {name:'운전자보험',match:/운전자보험/,budget:10760,note:'10월 10,760원. 과거 10,750~11,000원.'},
 {name:'화재보험 추정',match:/화재보험|나이스마이홈/,budget:900,note:'900원 반복. 나이스마이홈은 같은 보험이라는 가정; 마지막 7월.'},
 {name:'어린이집 교육회비',match:/교육회비/,budget:77000,note:'사용자 확인: 월납. 최근 관측 금액 77,000원 기준.'},
 {name:'쿠팡 멤버십',match:/쿠팡.*멤버|^쿠팡$/ ,budget:7890,note:'사용자 확인: 유지 중. 마지막 명시된 기록인 7월 7,890원을 잠정 적용하며 현재 청구액은 별도 확인. 쿠팡 일반 결제는 제외.',filter:r=>/멤버/.test(r.description)},
 {name:'멜론',match:/^멜론$/,budget:8690,note:'사용자 확인: 유지 중. 관측 금액 8,690원 기준; 현재 청구액은 별도 확인.'},
 {name:'기타 멤버십',match:/캔바|네이버플러스|똑닥멤버/,optional:true,budget:null,note:'각 1회 기록. 연간 결제 가능성이 있어 월 비용으로 환산하지 않음.'},
 {name:'자동차 보험 월 적립',match:/자동차 보험/,budget:37388,reserve:true,note:'사용자 확인: 3회 합계 448,650원이 연간 납부액. 12개월로 나누어 월 37,387.5원, 예산은 37,388원. 매월 실제 청구되는 금액은 아님.'},
 {name:'곗돈',match:/곗돈/,budget:120000,note:'가족 곗돈 100,000원 + 예지 곗돈 20,000원을 월 기준으로 잠정 반영. 예지 곗돈은 2·3·4·5·10월 20,000원 관측. 1월 40,000원과 5월 같은 날 20,000원 2회는 별도 확인이 필요하며 월 기준액에 중복 추가하지 않음.'},
 {name:'청약',match:/청약/,transfer:true,budget:20000,note:'사용자 확인: 소비와 구분하는 저축. 계좌별 납입 확인 전 월 20,000~40,000원 현금 유출로 별도 관리. 과거 통합 보고서의 지출에는 포함되어 있어 소비만 볼 때 차감해야 함.'}
];
const groups=definitions.map(d=>{
 const ts=rows.filter(r=>d.match.test(r.description)&&(!d.filter||d.filter(r))).sort((a,b)=>a.date.localeCompare(b.date));
 const monthly={};for(const t of ts){const m=t.date.slice(0,7);monthly[m]=(monthly[m]||0)+t.amount;}
 return {name:d.name,budget:d.budget,optional:!!d.optional,transfer:!!d.transfer,reserve:!!d.reserve,note:d.note,months:Object.keys(monthly).length,monthly,total:ts.reduce((n,t)=>n+t.amount,0),transactions:ts};
});
const core=groups.filter(g=>!g.optional&&!g.transfer);
const estimate=core.reduce((n,g)=>n+g.budget,0);
const recurringSubtotal=core.filter(g=>!g.reserve).reduce((n,g)=>n+g.budget,0);
const confirmed={phoneLines:2,educationFeeCadence:'monthly',coupangActive:true,melonActive:true,canvaStatus:'unknown',annualCarInsurance:448650,gyeClassification:'consumption',housingSubscriptionClassification:'savings'};
const result={analyzedAt:new Date().toISOString(),dataBuiltAt:report.builtAt,period:'2026-01~2026-10',status:'gye_amount_and_other_assumptions_require_confirmation',userConfirmed:confirmed,recurringMonthlySubtotal:recurringSubtotal,annualReserveMonthly:estimate-recurringSubtotal,coreMonthlyEstimate:estimate,excludedFromSubtotal:['캔바 등 유지 여부 미확정 구독','청약: 저축'],groups};
fs.writeFileSync(path.join(data,'fixed-expenses.json'),JSON.stringify(result,null,2)+'\n');
const money=x=>x==null?'미확정':x.toLocaleString('en-US');
const topItems=[...core].sort((a,b)=>b.budget-a.budget).slice(0,8);
const budgetGroups=[
 {label:'주거 (월세·이자·관리비)',names:['월세','대출이자','관리비']},
 {label:'보험 (자동차보험 제외)',names:['예지 보험','유주 보험·KB손해보험','운전자보험','화재보험 추정']},
 {label:'통신 (휴대전화·인터넷)',names:['휴대전화','인터넷']},
 {label:'곗돈',names:['곗돈']},
 {label:'어린이집',names:['어린이집 교육회비']},
 {label:'자동차보험 적립',names:['자동차 보험 월 적립']},
 {label:'코웨이',names:['코웨이']},
 {label:'구독 (iCloud·쿠팡·멜론)',names:['iCloud·APPLE','쿠팡 멤버십','멜론']}
].map(g=>({...g,amount:core.filter(c=>g.names.includes(c.name)).reduce((n,c)=>n+c.budget,0)}));
if(budgetGroups.reduce((n,g)=>n+g.amount,0)!==estimate)throw new Error('Chart budget totals do not reconcile');
const itemChart=[
 '```mermaid','xychart-beta','    title "주요 항목별 월 예산"',
 `    x-axis [${topItems.map(g=>JSON.stringify(g.name)).join(', ')}]`,
 `    y-axis "만원/월" 0 --> ${Math.ceil(Math.max(...topItems.map(g=>g.budget))/100000)*10}`,
 `    bar [${topItems.map(g=>Number((g.budget/10000).toFixed(2))).join(', ')}]`,'```'
];
const compositionChart=[
 '```mermaid',
 '%%{init: {"theme": "base", "themeVariables": {"pie1": "#2563EB", "pie2": "#F97316", "pie3": "#16A34A", "pie4": "#DC2626", "pie5": "#9333EA", "pie6": "#EAB308", "pie7": "#0891B2", "pie8": "#DB2777", "pieStrokeColor": "#FFFFFF", "pieStrokeWidth": "3px", "pieOpacity": "1", "pieSectionTextColor": "#111827", "pieLegendTextColor": "#111827"}}}%%',
 'pie showData',`    title 월 예산 구성 (원, 합계 ${estimate.toLocaleString('en-US')}원)`,
 ...budgetGroups.map(g=>`    "${g.label}" : ${g.amount}`),'```'
];
const md=['# 고정지출 분석','',`대상: 2026년 1~10월 통합 내역 (원본 통합 시각 ${report.builtAt})`,'',
 `월 반복 지출 소계: **${money(recurringSubtotal)}원**. 자동차보험 월 적립 ${money(estimate-recurringSubtotal)}원을 더한 **월 예산 합계는 ${money(estimate)}원**입니다.`, '',
 '사용자 확인을 반영했습니다: 휴대전화 2회선, 어린이집 회비 월납, 쿠팡·멜론 유지, 자동차보험 연간 448,650원, 곗돈 소비, 청약 저축. 곗돈은 가족 100,000원과 기록상 예지 20,000원을 합쳐 월 120,000원으로 잠정 반영했습니다. 캔바는 확인 전입니다.','',
 '실제 월평균이 아니라 최근 관측 금액을 바탕으로 한 예산 시나리오입니다. 관리비·이자는 변동하며 구독의 현재 청구액과 보험 계약 구분은 추가 확인이 필요합니다. 반복 식료품·교통·점심 결제는 고정비에 포함하지 않았습니다.','',
 '## 월 예산 그래프','',
 ...itemChart,'',
 '월 기준액이 큰 상위 8개 항목입니다. 단위는 만원이며, 정확한 금액은 아래 상세 표에 표시했습니다.','',
 ...compositionChart,'',
 '구성 그래프는 자동차보험 월 적립을 포함한 전체 예산입니다. 곗돈 월 120,000원은 잠정 기준이며 청약·미확인 구독은 제외했습니다. 실제 납부액의 월평균과 구분해서 봐주세요.','',
 '## 항목별 월 예산 및 합계','',
 '| 항목 | 월 기준액 | 관측 월 수 | 근거·확인 사항 |','| --- | ---: | ---: | --- |',
 ...core.filter(g=>!g.reserve).map(g=>`| ${g.name} | ${money(g.budget)} | ${g.months} | ${g.note} |`),
 '| **월 반복 지출 소계** | **'+money(recurringSubtotal)+'** | — | 자동차보험 적립 제외 |',
 '| **자동차보험 월 적립** | **'+money(estimate-recurringSubtotal)+'** | — | 연간 보험료 ÷ 12, 원 단위 올림 |',
 '| **월 예산 합계** | **'+money(estimate)+'** | — | 곗돈 포함, 청약·미확인 구독 제외 |','',
 '## 별도 확인 항목','',
 ...groups.filter(g=>g.optional||g.transfer).map(g=>`- **${g.name}**: ${g.note}`),'',
 '## 관측된 월별 금액','',
 '| 항목 | 1월 | 2월 | 3월 | 4월 | 5월 | 6월 | 7월 | 8월 | 9월 | 10월 |','| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
 ...groups.map(g=>`| ${g.name} | ${Array.from({length:10},(_,i)=>{const k=`2026-${String(i+1).padStart(2,'0')}`;return g.monthly[k]==null?'기록 없음':money(g.monthly[k]);}).join(' | ')} |`),'',
 '기록 없음은 미납·해지·0원을 뜻하지 않습니다. 납부일 기준이라 월세·이자의 청구월과 차이가 있을 수 있습니다. 대출 원금 상환은 별도 확인이 필요하며 이자와 합산하지 않았습니다.','',
 '곗돈은 소비 지출에 포함하고 청약은 저축으로 구분합니다. 기존 통합 지출에는 청약도 포함되어 있으므로 소비예산과 비교할 때 조정이 필요합니다. 과거 통합의 같은 달 추정 중복 189건도 아직 확정 전입니다. 캔바는 7월 10일 9,900원으로 기록되어 있으나 실제 서비스·유지 여부를 확인하지 못해 예산에서 제외했습니다.','',
 '거래별 근거는 `fixed-expenses.json`에 보관했습니다.',''
].join('\n');
fs.writeFileSync(path.join(data,'fixed-expenses.md'),md);
console.log(JSON.stringify({estimate,recurringSubtotal,annualReserve:estimate-recurringSubtotal,groups:groups.map(g=>({name:g.name,budget:g.budget}))},null,2));
