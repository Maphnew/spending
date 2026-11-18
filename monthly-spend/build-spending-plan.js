'use strict';
const fs=require('fs'),path=require('path');
const data=path.join(__dirname,'data');
const fixed=JSON.parse(fs.readFileSync(path.join(data,'fixed-expenses.json'),'utf8'));
const categories=JSON.parse(fs.readFileSync(path.join(data,'category-expenses.json'),'utf8'));
const income=6000000,savings=1500000,limit=income-savings;
const budgets=[
 {category:'고정·준고정 및 자동차보험 적립',amount:fixed.coreMonthlyEstimate,note:'월세·이자·관리비·통신·보험·어린이집·구독·곗돈. 기존 고정비 보고서 기준이며 자동차보험 적립 포함.'},
 {category:'개인',amount:270000,note:'클라이밍 3개월권 330,000원 × 2개라는 가정으로 월 220,000원 적립 + 기타 개인비 50,000원. 현재 이용권 수 확인 필요.'},
 {category:'쇼핑',amount:150000,note:'가구 전체 의류·잡화·비필수 구매. 미사용액은 최대 3개월 이월해 계절 구매에 사용.'},
 {category:'식재료',amount:1000000,note:'장보기 기준. 네이버페이·쿠팡은 품목을 확인해 실제 식재료만 집계.'},
 {category:'외식',amount:200000,note:'가족 외식 총액. 회사점심·배달과 구분.'},
 {category:'기호식품',amount:100000,note:'카페·간식 등. 가족 합산.'},
 {category:'회사점심',amount:180000,note:'월 근무일 20일 가정 시 하루 9,000원.'},
 {category:'배달',amount:50000,note:'외식 예산과 중복 배정하지 않음.'},
 {category:'교통',amount:200000,note:'주유·대중교통·주차·통행료. 자동차보험은 고정비에 있어 제외.'},
 {category:'생활 생필품',amount:180000,note:'일반 생필품. 큰 가전은 비정기 지출 적립에서 사용.'},
 {category:'육아 변동비',amount:180000,note:'육아 생필품·간식·교재 등. 어린이집 회비는 고정비에 있어 제외.'},
 {category:'건강·의료',amount:150000,note:'의료비와 건강식품. 남은 금액은 이월.'},
 {category:'경조사·선물',amount:200000,note:'매월 적립하고 필요한 달에 사용. 곗돈은 고정비에 있어 제외.'},
 {category:'여행·가전 등 비정기 지출 적립',amount:200000,note:'결제액이 큰 달을 대비해 이월. 사용 시 적립과 소비를 이중 집계하지 않음.'}
];
budgets.push({category:'예비비',amount:limit-budgets.reduce((n,b)=>n+b.amount,0),note:'분류 누락·관리비 변동 등에 사용. 반복 초과의 보전 용도로 고정 사용하지 않음.'});
const find=c=>categories.categories.find(r=>r.category===c);
const currentPersonal=find('개인'),currentShopping=find('쇼핑');
const target=420000,tenMonthBaseline=currentPersonal.average+currentShopping.average,recentBaseline=currentPersonal.recentAverage+currentShopping.recentAverage;
const result={createdAt:new Date().toISOString(),status:'draft_not_committed',monthlyNetIncome:income,monthlySavingsTarget:savings,monthlySpendingLimit:limit,userConfirmed:{climbingPassMonths:3,climbingPassPrice:330000},assumptions:{activeClimbingPassCount:2,gyeMonthly:120000,housingSubscriptionMonthly:20000,housingSubscriptionIncludedInSavings:true},budgets,personalShopping:{tenMonthAverage:tenMonthBaseline,recentAverage:recentBaseline,target,tenMonthReduction:tenMonthBaseline-target,recentReduction:recentBaseline-target}};
if(budgets.reduce((n,b)=>n+b.amount,0)!==limit||budgets.some(b=>b.amount<0))throw new Error('Budget total mismatch');
fs.writeFileSync(path.join(data,'spending-plan.json'),JSON.stringify(result,null,2)+'\n');
const money=n=>Math.round(n).toLocaleString('en-US');
const md=['# 월 지출 계획 초안','',
 '월 실수령액 6,000,000원, 목표 저축 1,500,000원을 기준으로 작성했습니다. 확정 예산이 아닌 초안입니다.','',
 '| 구분 | 월 금액 |','| --- | ---: |',`| 실수령액 | ${money(income)}원 |`,`| 목표 저축 | ${money(savings)}원 |`,`| **생활비·지출 대비 적립 한도** | **${money(limit)}원** |`,'',
 '```mermaid',
 '%%{init: {"theme": "base", "themeVariables": {"pie1": "#2563EB", "pie2": "#F97316", "pie3": "#16A34A", "pieStrokeColor": "#FFFFFF", "pieStrokeWidth": "3px"}}}%%',
 'pie showData',
 '    title 월 실수령액 배분 (원)',`    "목표 저축" : ${savings}`,`    "고정·준고정 및 자동차보험 적립" : ${fixed.coreMonthlyEstimate}`,`    "그 외 생활비·적립" : ${limit-fixed.coreMonthlyEstimate}`,'```','',
 '## 개인·쇼핑 절감 계획','',
 '```mermaid','xychart-beta','    title "개인·쇼핑 최근 월평균과 계획"',
 '    x-axis ["개인 최근", "개인 계획", "쇼핑 최근", "쇼핑 계획"]',
 '    y-axis "만원/월" 0 --> 40',
 `    bar [${(currentPersonal.recentAverage/10000).toFixed(1)}, 27, ${(currentShopping.recentAverage/10000).toFixed(1)}, 15]`,'```','',
 '| 항목 | 1~10월 평균 | 8~10월 평균 | 계획 |','| --- | ---: | ---: | ---: |',
 `| 개인 | ${money(currentPersonal.average)} | ${money(currentPersonal.recentAverage)} | 270,000 |`,
 `| 쇼핑 | ${money(currentShopping.average)} | ${money(currentShopping.recentAverage)} | 150,000 |`,
 `| **합계** | **${money(tenMonthBaseline)}** | **${money(recentBaseline)}** | **420,000** |`,'',
 `최근 평균 대비 월 ${money(recentBaseline-target)}원, 1~10월 평균 대비 월 ${money(tenMonthBaseline-target)}원을 줄이는 계획입니다. 개인·쇼핑만 줄여서는 전체 생활비 목표를 보장할 수 없어 다른 항목에도 한도를 배정했습니다.`, '',
 '- 클라이밍은 330,000원 ÷ 3개월 = 이용권당 월 110,000원입니다. 같은 달 두 건의 등록 이력이 있어 초안에는 두 이용권에 월 220,000원을 적립했습니다. 현재 한 이용권만 유지하면 월 110,000원을 저축 또는 예비비로 전환할 수 있습니다.',
 '- 개인 예산 270,000원은 클라이밍 적립 220,000원과 기타 50,000원으로 나눕니다. 이미 결제한 이용권은 재결제 예정일부터 적립 계획을 맞춥니다.',
 '- 쇼핑은 월 150,000원, 분기 450,000원으로 관리합니다. 미사용액만 이월하며 다음 달 예산을 미리 당겨 쓰지 않습니다.',
 '- 비필수 구매는 목록에 적고 48시간 뒤 예산 잔액을 확인해 결제합니다. 100,000원 이상 구매는 월 한도와 이월 잔액 안에서 합니다.','',
 '## 월 예산표','',
 '| 항목 | 월 한도·적립액 | 운영 기준 |','| --- | ---: | --- |',
 ...budgets.map(b=>`| ${b.category} | ${money(b.amount)}원 | ${b.note} |`),
 `| **합계** | **${money(limit)}원** | 목표 저축 ${money(savings)}원은 별도 |`,'',
 '## 목표와 실제 기록의 차이','',
 `1~10월 소비 월평균 ${money(categories.consumptionAverage)}원 대비 생활비·적립 한도는 ${money(categories.consumptionAverage-limit)}원 낮습니다. 과거 평균과 계획은 단위가 완전히 같지 않습니다. 과거는 실제 거래·환불 기준이고 이번 계획에는 향후 큰 지출을 위한 적립이 포함되어 있습니다.`, '',
 '식재료·외식·기호식품·회사점심·배달 합계는 월 1,530,000원입니다. 식비까지 함께 관리해야 저축 목표에 가까워집니다. 의료·경조사·여행 적립금은 한 달에 쓰지 않았다고 남는 자유 소비 예산으로 바꾸지 않습니다.','',
 '## 저축·적립 구분','',
 '- 목표 저축 1,500,000원 안에 청약을 포함하는 초안입니다. 청약이 월 20,000원이면 나머지 저축은 1,480,000원입니다. 두 계좌에 총 40,000원이면 나머지는 1,460,000원입니다.',
 '- 청약을 목표 150만 원과 별도로 납입하려면 생활비 한도에서 그만큼 더 빼야 합니다.',
 '- 자동차보험·클라이밍·경조사·여행 등의 적립금은 향후 지출을 위한 돈이므로 목표 저축 150만 원에 포함하지 않습니다.',
 '- 적립 시 예산에서 확보하고, 결제 시 해당 적립 잔액에서 차감합니다. 예산 보고에서 적립과 실제 결제를 두 번 비용으로 합산하지 않습니다. DB에는 실제 결제를 기록합니다.','',
 '## 실행·점검','',
 '1. 급여일에 목표 저축 150만 원을 먼저 배정하고 생활비·적립금은 별도로 관리합니다.',
 '2. 개인·쇼핑은 주 1회 잔액을 확인합니다. 월 한도의 80%를 사용하면 비필수 지출을 멈추고 예정 지출을 점검합니다.',
 '3. 첫 한 달은 초과 원인을 기록합니다. 필수비가 반복 초과하면 항목 간 예산을 조정하되 총액 450만 원을 유지합니다.',
 '4. 매달 DB를 갱신해 실제 거래와 예산을 비교합니다. 자동 예산 대비 집계·적립 잔액 관리 기능은 아직 구현되지 않았습니다.','',
 '## 미확정 사항','',
 '- 현재 클라이밍 이용권 수는 2개로 가정했습니다. 3개월 이용기간은 사용자 확인 사항입니다.',
 '- 곗돈은 가족 100,000원 + 다른 항목 20,000원을 잠정 반영했습니다. 구독의 현재 요금과 보험 계약, 고정비의 누락 기록은 추가 확인이 필요합니다.',
 '- 과거 통합 데이터의 날짜가 다른 189건은 추정 중복입니다. 과거 평균은 잠정 집계입니다.',
 '- 의료비·예상치 못한 큰 지출은 기존 별도 자금 유무에 따라 적립액을 더 확보해야 할 수 있습니다.',''
].join('\n');
fs.writeFileSync(path.join(data,'spending-plan.md'),md);
console.log(JSON.stringify({income,savings,limit,total:budgets.reduce((n,b)=>n+b.amount,0),budgets,comparison:result.personalShopping},null,2));
