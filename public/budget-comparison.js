(function (root, factory) {
  const budget = factory();
  if (typeof module === 'object' && module.exports) module.exports = budget;
  else root.SpendingBudget = budget;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function buildGroups(plan, fixed) {
    const amount = (rows, name, field) => {
      const row = rows.find(r => r.category === name || r.name === name);
      if (!row || !Number.isFinite(row[field])) throw new Error('Missing budget: ' + name);
      return row[field];
    };
    const p = name => amount(plan.budgets, name, 'amount');
    const f = names => names.reduce((sum, name) => sum + amount(fixed.groups, name, 'budget'), 0);
    const housing=f(['월세','대출이자','관리비']);
    const insurance=f(['예지 보험','유주 보험·KB손해보험','운전자보험','화재보험 추정','자동차 보험 월 적립','곗돈']);
    const communication=f(['휴대전화','인터넷','iCloud·APPLE','코웨이','쿠팡 멤버십','멜론']);
    const education=f(['어린이집 교육회비']);
    if (housing+insurance+communication+education !== p('고정·준고정 및 자동차보험 적립')) throw new Error('Fixed budgets do not reconcile');
    const groups = [
      {label:'주거',categories:['주거'],budget:housing},
      {label:'보험·곗돈',categories:['보험, 곗돈','보험','곗돈'],budget:insurance,note:'자동차보험 월 적립 포함'},
      {label:'통신·구독·렌탈',categories:['전화, 인터넷, iCloud'],budget:communication,note:'휴대전화·인터넷·iCloud·코웨이·쿠팡·멜론'},
      {label:'개인',categories:['개인'],budget:p('개인')},
      {label:'쇼핑',categories:['쇼핑'],budget:p('쇼핑')},
      {label:'식재료',categories:['식재료'],budget:p('식재료')},
      {label:'외식',categories:['외식'],budget:p('외식')},
      {label:'기호식품',categories:['기호식품'],budget:p('기호식품')},
      {label:'회사점심',categories:['회사점심'],budget:p('회사점심')},
      {label:'배달',categories:['배달'],budget:p('배달')},
      {label:'교통',categories:['교통'],budget:p('교통')},
      {label:'생필품',categories:['생필품'],budget:p('생활 생필품')},
      {label:'육아 (교육·생필품·간식)',categories:['육아 - 교육','육아 - 생필품','육아 - 간식'],budget:education+p('육아 변동비'),note:'어린이집 회비와 육아 변동비의 합산 한도'},
      {label:'건강·의료·건강식품',categories:['건강/의료','건강식품'],budget:p('건강·의료'),note:'공동 예산'},
      {label:'경조사·선물',categories:['경조사','선물'],budget:p('경조사·선물'),note:'공동 적립 예산'},
      {label:'여행·생활가전',categories:['여행','생활가전'],budget:p('여행·가전 등 비정기 지출 적립'),note:'공동 적립 예산'},
      {label:'기타·예비비',categories:['기타',''],budget:p('예비비')},
    ];
    const assigned = groups.flatMap(g=>g.categories);
    if (new Set(assigned).size !== assigned.length || groups.reduce((s,g)=>s+g.budget,0)!==plan.monthlySpendingLimit) throw new Error('Category budgets do not reconcile');
    return groups;
  }
  function compare(transactions, groups) {
    const rows=groups.map(g=>({...g,actual:0,count:0}));
    const byCategory=new Map();for(const row of rows)for(const category of row.categories)byCategory.set(category,row);
    let savings=0;
    for(const tx of transactions){
      if (/청약/.test(tx.merchant || tx.description || '')) {savings+=tx.amount;continue;}
      let row=byCategory.get(tx.category || '');
      if(!row){row={label:tx.category || '미분류',categories:[tx.category],budget:null,actual:0,count:0,note:'계획에 대응하는 분류 없음'};rows.push(row);byCategory.set(tx.category,row);}
      row.actual+=tx.amount;row.count++;
    }
    for(const row of rows){row.remaining=row.budget==null?null:row.budget-row.actual;row.ratio=row.budget>0?row.actual/row.budget:null;}
    rows.sort((a,b)=>b.actual-a.actual || (b.budget || 0)-(a.budget || 0));
    return {rows,savings,actual:rows.reduce((s,r)=>s+r.actual,0),budget:groups.reduce((s,g)=>s+g.budget,0)};
  }
  return {buildGroups,compare};
});
