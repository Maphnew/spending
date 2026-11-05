'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = value => Math.round(value).toLocaleString('ko-KR');
  const won = value => num(value) + '원';
  const short = value => (value / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '만 원';
  const palette = ['#2563eb','#f97316','#16a34a','#dc2626','#9333ea','#d6a000','#0891b2','#db2777'];
  let data = null, selectedMonth = 'all', selectedCategory = '', busy = false;
  const status = (message, error = false) => { $('analysis-status').textContent = message; $('analysis-status').classList.toggle('error', error); };
  const currentPanel = () => ['plan','fixed','categories'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'plan';
  const kpi = (label, amount, note, accent = false) => `<div class="insight-kpi${accent ? ' accent' : ''}"><span>${esc(label)}</span><strong>${esc(amount)}</strong><small>${esc(note)}</small></div>`;
  const card = (title, body, extra = '') => `<section class="insight-card ${extra}"><h2>${esc(title)}</h2>${body}</section>`;
  const table = (headings, rows, footer = '') => `<div class="insight-table-scroll"><table class="insight-table"><thead><tr>${headings.map((h,i) => `<th scope="col"${i > 0 ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>${footer ? `<tfoot>${footer}</tfoot>` : ''}</table></div>`;
  function bars(rows, clickable = false) {
    const max = Math.max(1, ...rows.map(r => Math.abs(r.amount)));
    return `<div class="insight-bars">${rows.map((r,i) => `<${clickable ? 'button type="button"' : 'div'} class="insight-bar${clickable ? ' clickable' : ''}"${clickable ? ` data-category="${esc(r.label)}" aria-label="${esc(r.label)} 거래 보기"` : ''}><div class="insight-bar-head"><span>${esc(r.label)}</span><span>${won(r.amount)}</span></div><div class="insight-bar-track"><div class="insight-bar-fill" style="width:${Math.max(0, Math.abs(r.amount)/max*100)}%;background:${palette[i % palette.length]}"></div></div></${clickable ? 'button' : 'div'}>`).join('')}</div>`;
  }
  function donut(rows, total, label) {
    let position = 0;
    const colors = rows.map((r,i) => { const start=position; position+=r.amount/total*100; return `${palette[i % palette.length]} ${start}% ${position}%`; });
    return `<div class="donut-layout"><div class="donut" role="img" aria-label="${esc(label)}. ${esc(rows.map(r => r.label+' '+won(r.amount)).join(', '))}" style="background:conic-gradient(${colors.join(',')})"><div class="donut-hole"><small>${esc(label)}</small><strong>${short(total)}</strong></div></div><div class="donut-legend">${rows.map((r,i) => `<div class="legend-item"><span class="legend-dot" style="background:${palette[i % palette.length]}"></span><span>${esc(r.label)}</span><span class="legend-value">${(r.amount/total*100).toFixed(1)}%</span></div>`).join('')}</div></div>`;
  }
  function lineChart(rows) {
    const w=620,h=200,left=46,right=18,top=18,bottom=32,max=Math.ceil(Math.max(1,...rows.map(r=>r.amount))/1000000)*1000000;
    const x=i=>left+i*(w-left-right)/Math.max(rows.length-1,1), y=v=>h-bottom-v/max*(h-top-bottom);
    return `<svg class="line-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="월별 소비 지출 추이. 상세 금액은 아래 월별 표에서 확인할 수 있습니다.">${[0,.5,1].map(p=>`<line class="grid" x1="${left}" x2="${w-right}" y1="${y(max*p)}" y2="${y(max*p)}"/><text x="${left-8}" y="${y(max*p)+4}" text-anchor="end">${Math.round(max*p/10000)}</text>`).join('')}<polyline class="plot" points="${rows.map((r,i)=>`${x(i)},${y(r.amount)}`).join(' ')}"/>${rows.map((r,i)=>`<circle cx="${x(i)}" cy="${y(r.amount)}" r="4"><title>${esc(r.month)}: ${won(r.amount)}</title></circle><text x="${x(i)}" y="${h-9}" text-anchor="middle">${Number(r.month.slice(5))}월</text>`).join('')}</svg>`;
  }
  function planPanel() {
    const p=data.plan, compare=p.personalShopping;
    const fixed=p.budgets[0].amount;
    const composition=[{label:'목표 저축',amount:p.monthlySavingsTarget},{label:'고정지출·보험 적립',amount:fixed},{label:'그 외 생활비·적립',amount:p.monthlySpendingLimit-fixed}];
    return `<div class="insight-kpis">${kpi('월 실수령액',short(p.monthlyNetIncome),'가구 합산')}${kpi('목표 저축',short(p.monthlySavingsTarget),'청약 포함',true)}${kpi('생활비·적립 한도',short(p.monthlySpendingLimit),'저축과 별도로 관리')}${kpi('개인·쇼핑 목표',short(compare.target),'최근 대비 '+short(compare.recentReduction)+' 절감')}</div>
      <div class="plan-note"><span class="pill">계획 초안</span> &nbsp;클라이밍 33만 원 / 3개월 이용권 두 개를 유지하는 가정입니다. 곗돈은 월 12만 원으로 잠정 반영했습니다.</div>
      <div class="insights-content-grid">${card('600만 원의 월 배분',donut(composition,p.monthlyNetIncome,'월 실수령액'))}${card('개인·쇼핑, 이렇게 줄여보기',`<div class="comparison"><div class="comparison-row"><span>항목</span><span>최근 3개월 평균</span><span>월 예산</span></div>${['개인','쇼핑'].map(label=>{const c=data.categories.categories.find(r=>r.category===label),b=p.budgets.find(r=>r.category===label);return `<div class="comparison-row"><strong>${label}</strong><div class="comparison-value">실제 기록<strong>${won(c.recentAverage)}</strong></div><div class="comparison-value target">목표<strong>${won(b.amount)}</strong></div></div>`;}).join('')}</div><p>개인비 27만 원 중 클라이밍 적립 22만 원, 기타 개인비 5만 원. 쇼핑은 월 15만 원, 분기 45만 원으로 관리합니다.</p>`)}</div>
      ${card('월 예산 상세',table(['항목','월 한도·적립액','운영 기준'],p.budgets.map(b=>`<tr><td>${esc(b.category)}</td><td class="num">${won(b.amount)}</td><td class="detail-cell">${esc(b.note)}</td></tr>`),`<tr><td>합계</td><td class="num">${won(p.monthlySpendingLimit)}</td><td>목표 저축 ${won(p.monthlySavingsTarget)}은 별도</td></tr>`))}
      <div class="plan-note">보험·클라이밍·경조사 등의 적립금은 나중에 쓸 생활비이며, 목표 저축 150만 원에 포함하지 않습니다. 결제할 때 적립 잔액에서 차감해 이중 집계하지 않습니다. 이 화면은 예산 초안이며 월별 예산 대비 실적·적립 잔액은 아직 추적하지 않습니다.</div>`;
  }
  function fixedPanel() {
    const f=data.fixed, core=f.groups.filter(g=>!g.optional&&!g.transfer), total=f.coreMonthlyEstimate;
    const definitions=[['주거',['월세','대출이자','관리비']],['보험',['예지 보험','유주 보험·KB손해보험','운전자보험','화재보험 추정']],['통신',['휴대전화','인터넷']],['곗돈',['곗돈']],['어린이집',['어린이집 교육회비']],['자동차보험 적립',['자동차 보험 월 적립']],['코웨이',['코웨이']],['구독',['iCloud·APPLE','쿠팡 멤버십','멜론']]];
    const grouped=definitions.map(([label,names])=>({label,amount:core.filter(g=>names.includes(g.name)).reduce((s,g)=>s+g.budget,0)}));
    const top=[...core].sort((a,b)=>b.budget-a.budget).slice(0,8).map(g=>({label:g.name,amount:g.budget}));
    return `<div class="insight-kpis">${kpi('월 고정지출·적립',won(total),'현재 기준의 예산 추정',true)}${kpi('월 반복 지출',won(f.recurringMonthlySubtotal),'자동차보험 적립 제외')}${kpi('자동차보험 월 적립',won(f.annualReserveMonthly),'연간 보험료 448,650원')}${kpi('고정비 / 생활비 한도',(total/data.plan.monthlySpendingLimit*100).toFixed(1)+'%','월 450만 원 기준')}</div>
      <div class="insights-content-grid">${card('월 고정지출 구성',donut(grouped,total,'월 고정지출·적립'))}${card('주요 항목별 월 예산',bars(top))}</div>
      ${card('고정지출 상세',table(['항목','월 기준액','관측 월 수','근거·확인 사항'],core.map(g=>`<tr><td>${esc(g.name)}</td><td class="num">${won(g.budget)}</td><td class="num">${g.months}개월</td><td class="detail-cell">${esc(g.note)}</td></tr>`),`<tr><td>월 예산 합계</td><td class="num">${won(total)}</td><td colspan="2">청약·미확인 구독 제외</td></tr>`))}
      <div class="insights-content-grid">${card('별도 확인이 필요한 항목',f.groups.filter(g=>g.optional||g.transfer).map(g=>`<h3>${esc(g.name)}</h3><p>${esc(g.note)}</p>`).join(''))}${card('금액을 읽는 방법','<p>과거 평균이 아닌 최근 관측 금액과 확인된 납부 주기를 바탕으로 만든 월 예산입니다.</p><p>기록이 없는 달을 미납·해지 또는 0원으로 해석하지 않습니다. 납부일과 청구월이 다를 수 있으며 관리비와 이자는 변동합니다.</p><p>곗돈은 소비, 청약은 저축으로 구분합니다. 캔바 등 유지 여부를 확인하지 못한 구독은 예산에서 제외했습니다.</p>')}</div>`;
  }
  function categoryName(row) { return /곗돈/.test(row.description) ? '곗돈' : /보험, 곗돈/.test(row.category) ? '보험' : row.category || '미분류'; }
  function categoryPanel() {
    const c=data.categories;
    const availableMonths=[...new Set(data.transactions.filter(r=>r.date).map(r=>r.date.slice(0,7)))].sort();
    const now=new Date(), currentMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const history=availableMonths.map(month=>{const rows=data.transactions.filter(r=>r.date&&r.date.startsWith(month));return {month,consumption:rows.filter(r=>!/청약/.test(r.description)).reduce((n,r)=>n+r.amount,0),savings:rows.filter(r=>/청약/.test(r.description)).reduce((n,r)=>n+r.amount,0)};});
    const transactions=data.transactions.filter(r=>r.date&&!/청약/.test(r.description)&&(selectedMonth==='all'?(r.date>='2026-01-01'&&r.date<'2026-11-01'):r.date.startsWith(selectedMonth)));
    const total=transactions.reduce((n,r)=>n+r.amount,0), divisor=selectedMonth==='all'?10:1;
    const categories=[...new Set(transactions.map(categoryName))].map(label=>({label,amount:transactions.filter(r=>categoryName(r)===label).reduce((n,r)=>n+r.amount,0)})).sort((a,b)=>b.amount-a.amount);
    const active=selectedCategory&&categories.some(r=>r.label===selectedCategory)?selectedCategory:(categories[0]||{}).label;
    const txs=transactions.filter(r=>categoryName(r)===active).sort((a,b)=>b.date.localeCompare(a.date));
    const food=transactions.filter(r=>['식재료','외식','배달','기호식품','회사점심','건강식품'].includes(categoryName(r))).reduce((n,r)=>n+r.amount,0);
    const period=selectedMonth==='all'?'2026년 1~10월':selectedMonth.replace('-', '년 ')+'월';
    return `<div class="insights-controls"><label for="analysis-month">분석 기간</label><select id="analysis-month"><option value="all">기준 기간 · 2026년 1~10월</option>${[...availableMonths].reverse().map(month=>`<option value="${month}"${selectedMonth===month?' selected':''}>${month}${month>=currentMonth?' (진행 중)':''}</option>`).join('')}</select><span class="pill">청약 제외 · 곗돈 포함</span></div>
      <div class="insight-kpis">${kpi('소비 지출 합계',short(total),period,true)}${kpi(selectedMonth==='all'?'월평균 소비':'선택 월 소비',won(total/divisor),selectedMonth==='all'?'10개월 기준':'환불 차감')}${kpi('식비·기호식품 등',short(food/divisor),'월 기준 · 소비의 '+(total?food/total*100:0).toFixed(1)+'%')}${kpi('최대 지출 분류',esc((categories[0]||{}).label||'없음'),categories.length?won(categories[0].amount/divisor)+' / 월':'기록 없음')}</div>
      <div class="insights-content-grid">${card('카테고리별 '+(selectedMonth==='all'?'월평균':'지출'),`<p class="chart-caption">항목을 누르면 아래에서 거래를 확인할 수 있습니다.</p>${bars(categories.slice(0,10).map(r=>({...r,amount:r.amount/divisor})),true)}`)}${card('월별 소비 지출',`<p class="chart-caption"><span>기록된 전체 기간</span><span>단위: 만 원</span></p>${lineChart(history.map(m=>({month:m.month,amount:m.consumption})))}<p class="muted-copy">진행 중인 달은 기록된 금액만 표시합니다. 기준 기간 평균은 2026년 1~10월이며 다른 달은 기간 선택에서 확인할 수 있습니다. 날짜 없는 환불 ${won(c.undatedExpenses.reduce((n,r)=>n+r.amount,0))}은 월별 합계에서 제외했습니다.</p>`)}</div>
      ${card('카테고리 상세',table(['카테고리','소비 합계','월평균','비중'],categories.map(r=>`<tr><td><button class="btn link" type="button" data-category="${esc(r.label)}">${esc(r.label)}</button></td><td class="num">${won(r.amount)}</td><td class="num">${won(r.amount/divisor)}</td><td class="num">${total?(r.amount/total*100).toFixed(1):'0'}%</td></tr>`),`<tr><td>합계</td><td class="num">${won(total)}</td><td class="num">${won(total/divisor)}</td><td class="num">${total?'100':'0'}%</td></tr>`))}
      <div class="insights-content-grid">${card('초기와 최근의 변화',table(['항목','1~3월 평균','8~10월 평균','차이'],c.categories.filter(r=>['식재료','외식','기호식품','개인','쇼핑'].includes(r.category)).map(r=>`<tr><td>${esc(r.category)}</td><td class="num">${won(r.earlyAverage)}</td><td class="num">${won(r.recentAverage)}</td><td class="num ${r.change>0?'trend-up':'trend-down'}">${r.change>0?'+':''}${won(r.change)}</td></tr>`))+'<p>전체 기간의 초기·최근 월평균 비교입니다. 누락·계절·일회성 구매의 영향을 받을 수 있습니다.</p>')}${card('분류와 집계 기준','<p>거래의 원본 분류를 기본으로 유지합니다. 네이버페이·쿠팡의 실제 구매 품목과 코웨이 등의 분류는 확인이 필요합니다.</p><p>같은 달·금액·이름·분류를 근거로 날짜가 다른 '+data.deduplication.sameMonthAssumedDuplicates+'건을 중복으로 추정했습니다. 따라서 합계는 잠정 집계입니다.</p><p>고정비가 이미 소비 합계에 들어 있습니다. 고정지출 예산을 이 합계에 더하면 이중 합산됩니다.</p>')}</div>
      <section class="insight-card" id="category-transactions"><div class="section-heading"><h2>카테고리 거래 내역</h2><span class="pill">${txs.length}건</span></div><div class="insights-controls"><label for="analysis-category">카테고리</label><select id="analysis-category">${categories.map(r=>`<option value="${esc(r.label)}"${r.label===active?' selected':''}>${esc(r.label)}</option>`).join('')}</select></div>${txs.length?table(['날짜','설명','출처','금액'],txs.map(r=>`<tr><td>${esc(r.date)}${r.dateBasis==='previous_row_candidate'?' <span class="pill">추정</span>':''}</td><td>${esc(r.description||'설명 없음')}</td><td>${r.source==='db'?'거래 DB':'과거 시트'}</td><td class="num">${won(r.amount)}</td></tr>`)):'<p class="empty-copy">이 기간에는 거래 기록이 없습니다.</p>'}</section>
      ${card('월별 소비 합계',table(['월','소비','청약·저축'],history.map(m=>`<tr><td>${m.month}${m.month>=currentMonth?' <span class="pill">진행 중</span>':''}</td><td class="num">${won(m.consumption)}</td><td class="num">${won(m.savings)}</td></tr>`)))}`;
  }
  function render() {
    if (!data) return;
    const panel=currentPanel();
    document.querySelectorAll('[data-panel]').forEach(a=>{if(a.dataset.panel===panel)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    $('insights-content').innerHTML=panel==='fixed'?fixedPanel():panel==='categories'?categoryPanel():planPanel();
    $('insights-content').setAttribute('aria-busy','false');
    $('updated-at').textContent='데이터 기준 '+new Date(data.generatedAt).toLocaleString('ko-KR');
    document.title=({plan:'지출 계획',fixed:'고정지출',categories:'카테고리 분석'})[panel]+' · 소비 정리';
  }
  async function load(refresh = false) {
    if (busy) return;
    busy=true;$('refresh-analysis').disabled=true;$('refresh-analysis').textContent=refresh?'분석 중…':'불러오는 중…';
    status(refresh?'최신 거래를 반영하고 있습니다. 잠시 기다려주세요.':'분석 결과를 불러오고 있습니다…');
    try {
      const response=await fetch(refresh?'/api/insights/refresh':'/api/insights',{method:refresh?'POST':'GET',headers:refresh?{'Content-Type':'application/json'}:{},cache:'no-store'});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||'분석 결과를 불러오지 못했습니다.');
      data=result;render();
      status('DB '+num(data.sourceCount)+'건과 과거 시트 8개를 반영했습니다. 중복 추정과 확인 전 항목이 포함된 잠정 분석입니다.');
    } catch(error) {
      status(error.message+(data?' 현재 화면은 마지막 성공 결과입니다.':''),true);
      if(!data)$('insights-content').innerHTML='<section class="insight-card"><h2>분석 결과를 준비하지 못했습니다.</h2><p>위의 분석 새로고침을 눌러 다시 시도해주세요. 거래 입력 화면은 계속 사용할 수 있습니다.</p></section>';
      $('insights-content').setAttribute('aria-busy','false');
    } finally {busy=false;$('refresh-analysis').disabled=false;$('refresh-analysis').textContent='분석 새로고침';}
  }
  $('refresh-analysis').addEventListener('click',()=>load(true));
  window.addEventListener('hashchange',render);
  $('insights-content').addEventListener('change',event=>{
    if(event.target.id==='analysis-month'){selectedMonth=event.target.value;render();$('analysis-month').focus();}
    if(event.target.id==='analysis-category'){selectedCategory=event.target.value;render();$('analysis-category').focus();}
  });
  $('insights-content').addEventListener('click',event=>{
    const button=event.target.closest('[data-category]');
    if(button){selectedCategory=button.dataset.category;render();$('category-transactions').scrollIntoView({behavior:'smooth',block:'start'});$('analysis-category').focus({preventScroll:true});}
  });
  load();
})();
