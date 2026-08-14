'use strict';

/* ────────────────────────────────────────────
   분류 규칙
   가맹점명에 아래 키워드가 들어 있으면 해당 분류로 자동 배정한다.
   위에서부터 먼저 걸리는 규칙이 이긴다.
   ──────────────────────────────────────────── */
const CATEGORIES = ['식비', '카페/간식', '편의점', '마트/쇼핑', '교통', '의료', '운동/취미', '통신/구독', '주거/공과금', '기타'];

const CATEGORY_RULES = [
  ['편의점',    ['GS25', 'CU ', '씨유', '세븐일레븐', '코리아세븐', '이마트24', '미니스톱', '스토리웨이']],
  ['카페/간식', ['커피', '카페', 'CAFE', 'COFFEE', '스타벅스', '투썸', '이디야', '메가엠지씨', '빽다방', '컴포즈',
                '파리바게', '뚜레쥬르', '베이커리', '디저트', '베스킨', '설빙', '공차', '탕후루']],
  ['교통',      ['택시', '카카오T', '코레일', '철도', '지하철', '버스', '교통', '주유', 'SK에너지', 'GS칼텍스',
                '하이패스', '주차', '아마노', '쏘카', '티머니', '항공', '에어']],
  ['의료',      ['약국', '병원', '의원', '치과', '한의', '클리닉', '메디컬']],
  ['운동/취미', ['클라이밍', '짐', 'GYM', '피트니스', '헬스', '요가', '필라테스', '수영', '골프', 'CGV', '메가박스',
                '롯데시네마', '서점', '문고']],
  ['주거/공과금', ['관리비', '전기요금', '한국전력', '도시가스', '수도요금', '상하수도', '월세', '임대료', '보험료']],
  ['통신/구독', ['SKT', 'KT ', 'LGU', 'U+', '유플러스', '통신요금', '넷플릭스', 'NETFLIX', '유튜브', 'YOUTUBE',
                '스포티파이', 'APPLE', '구글', 'GOOGLE', '멜론', '왓챠', '티빙', '쿠팡플레이']],
  ['마트/쇼핑', ['쿠팡', '이마트', '홈플러스', '롯데마트', '마켓컬리', '컬리', '11번가', 'G마켓', '지마켓', '옥션',
                'SSG', '네이버페이', '올리브', '다이소', '무신사', '이케아', '한샘', '배송', '스토어']],
  ['식비',      ['식당', '국밥', '김밥', '분식', '치킨', '피자', '버거', '맥도날드', '롯데리아', '서브웨이',
                '한식', '중식', '일식', '초밥', '스시', '고기', '삼겹', '곱창', '족발', '보쌈', '칼국수',
                '면옥', '냉면', '쌀국수', '반점', '식품', '주점', '포차', '호프', '배달의민족', '요기요',
                '푸드', 'FOOD', '키친', 'KITCHEN']],
];

/** 너무 짧아 부분일치로는 쓸 수 없는 상호는 완전일치로만 배정한다. */
const CATEGORY_EXACT = {
  'SR': '교통',
  'KTX': '교통',
  'SRT': '교통',
};

/* ────────────────────────────────────────────
   문자 파싱
   ──────────────────────────────────────────── */
/* 카드사마다 줄바꿈 위치가 다르다(현대카드는 항목마다 줄바꿈, 신한카드는 한 줄).
   그래서 줄 단위가 아니라 "헤더 → 금액 → 일시 → 가맹점 → 누적"이라는 순서를 기준으로
   블록 전체 텍스트에서 위치로 읽어낸다. */
const RE_CARD_HEADER = /^([^\n]*?)(승인취소|승인|취소|결제)/m;   // 앞부분에 카드사명이 있어야 헤더로 인정
const RE_LINE_HEADER = /^[^\n]{0,20}?(?:카드|은행|페이)[^\n]{0,12}?(?:승인|취소|결제)/;
const RE_AMOUNT = /([\d,]+)\s*원/;
const RE_DATE   = /(?:(\d{4})[./-])?(\d{1,2})[./](\d{1,2})(?:[\s(]+(\d{1,2}):(\d{2}))?/;
const RE_RUNNING_TOTAL = /(누적|잔액|한도|사용가능|이용가능|승인가능)\s*[\d,]+\s*원?/g;
const RE_RUNNING_VALUE = /(?:누적|잔액)\s*([\d,]+)\s*원?/;   // 같은 분·같은 금액 결제를 가르는 유일한 단서
const RE_MASKED_NAME = /[가-힣A-Za-z]\*+[가-힣A-Za-z]*(님)?/g;
const RE_INSTALLMENT = /\(\s*(일시불|\d+\s*개월)\s*\)|(?:^|\s)(일시불|\d+\s*개월)(?=\s|$)/g;
const RE_BOILERPLATE = /(정상\s*승인\s*(되었습니다)?[.!]?|승인\s*되었습니다[.!]?|되었습니다[.!]?|자동이체된?\s*금액)/g;

let idSeq = 0;
/** 내역을 지목하기 위한 식별자. 중복 판정에는 쓰지 않는다(→ isSameTx). */
const newId = () => `${Date.now().toString(36)}-${(idSeq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** 붙여넣은 텍스트를 문자 한 건씩의 블록으로 나눈다. */
function splitBlocks(text) {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const blocks = [];
  let cur = [];

  const flush = () => { if (cur.length) blocks.push(cur); cur = []; };

  for (const line of lines) {
    // [Web발신] 같은 말머리는 새 문자의 시작 신호
    if (/^\[[^\]]*\]$/.test(line)) { flush(); continue; }
    // 말머리가 없어도, "○○카드 … 승인"으로 시작하는 줄은 새 문자의 첫 줄로 본다
    if (cur.length && RE_LINE_HEADER.test(line)) flush();
    cur.push(line);
  }
  flush();
  return blocks;
}

/** 연도가 없는 MM/DD 를 오늘 기준으로 해석한다(미래로 크게 벗어나면 작년). */
function resolveYear(month, day) {
  const now = new Date();
  const year = now.getFullYear();
  const guess = new Date(year, month - 1, day);
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  return guess.getTime() - now.getTime() > THIRTY_DAYS ? year - 1 : year;
}

function tidy(s) {
  return s.replace(/[\s ]+/g, ' ').replace(/^[\s,·\-|/]+|[\s,·\-|/]+$/g, '').trim();
}

/** 여러 조각 중 가맹점으로 쓸 만한 첫 텍스트를 고른다. */
function pickMerchant(segments) {
  for (const segment of segments) {
    for (const piece of segment.split('\n')) {
      const value = tidy(piece);
      if (value && !/^[\d,.]+$/.test(value)) return value;
    }
  }
  return '';
}

function parseBlock(block) {
  let text = block.join('\n');

  // 누적/잔액은 결제액이 아니므로 값만 챙겨두고 걷어낸다
  const runningMatch = text.match(RE_RUNNING_VALUE);
  const running = runningMatch ? Number(runningMatch[1].replace(/,/g, '')) : null;
  text = text.replace(RE_RUNNING_TOTAL, ' ');

  let card = '';
  let canceled = false;
  const header = text.match(RE_CARD_HEADER);
  if (header && /카드|은행|페이|pay/i.test(header[1])) {
    card = tidy(header[1]);
    canceled = header[2].includes('취소');
    text = text.replace(header[0], '\n');
  }

  text = text.replace(RE_MASKED_NAME, ' ')      // 김*찬 / 김*찬님
             .replace(RE_INSTALLMENT, ' ')      // (일시불) / ( 3개월)
             .replace(RE_BOILERPLATE, ' ');     // 정상승인 되었습니다 …

  const amountMatch = text.match(RE_AMOUNT);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount === 0) return null;
  const amountEnd = amountMatch.index + amountMatch[0].length;

  const dateMatch = text.match(RE_DATE);
  let at = null;
  if (dateMatch) {
    const [, y, mo, d, h, mi] = dateMatch;
    const month = Number(mo);
    const day = Number(d);
    const year = y ? Number(y) : resolveYear(month, day);
    at = new Date(year, month - 1, day, Number(h || 0), Number(mi || 0)).getTime();
  }

  // 가맹점은 일시 뒤가 1순위, 없으면 금액 뒤 → 금액 앞 순으로 찾는다
  const segments = dateMatch
    ? [text.slice(dateMatch.index + dateMatch[0].length), text.slice(amountEnd, dateMatch.index), text.slice(0, amountMatch.index)]
    : [text.slice(0, amountMatch.index), text.slice(amountEnd)];
  const merchant = pickMerchant(segments) || '(가맹점 미상)';

  return {
    id: newId(),
    at,
    amount: canceled ? -amount : amount,
    merchant,
    card,
    running: Number.isFinite(running) ? running : null,
    category: categorize(merchant),
    canceled,
  };
}

function parseSms(text) {
  const parsed = [];
  const failed = [];
  for (const block of splitBlocks(text)) {
    const tx = parseBlock(block);
    if (tx) parsed.push(tx);
    else if (block.some((l) => /원/.test(l))) failed.push(block.join(' / '));
  }
  return { parsed, failed };
}

/* ────────────────────────────────────────────
   분류
   ──────────────────────────────────────────── */
function categorize(merchant) {
  const learned = store.learned[merchant];
  if (learned) return learned;

  const upper = merchant.toUpperCase();
  if (CATEGORY_EXACT[upper]) return CATEGORY_EXACT[upper];

  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some((kw) => upper.includes(kw.trim().toUpperCase()))) return category;
  }
  return '기타';
}

/* ────────────────────────────────────────────
   저장소 (localStorage)
   ──────────────────────────────────────────── */
const STORAGE_KEY = 'spending-app/v1';

/** 같은 결제인가?
    일시·금액·가맹점이 모두 같아야 하고, 양쪽 다 누적 금액을 알고 있다면 그것까지 같아야 한다.
    (같은 분에 같은 금액을 두 번 결제해도 누적은 다르므로 별개로 남는다.
     누적을 모르는 예전 데이터와 비교할 때는 일시·금액·가맹점만 본다.) */
function isSameTx(a, b) {
  if (a.merchant !== b.merchant || a.amount !== b.amount || a.at !== b.at) return false;
  if (a.running != null && b.running != null) return a.running === b.running;
  return true;
}

const store = {
  transactions: [],
  learned: {},   // 가맹점명 → 사용자가 직접 고른 분류

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.transactions = Array.isArray(data.transactions) ? data.transactions : [];
      this.learned = data.learned && typeof data.learned === 'object' ? data.learned : {};
    } catch (err) {
      console.warn('저장된 데이터를 읽지 못했습니다.', err);
    }
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        transactions: this.transactions,
        learned: this.learned,
      }));
    } catch (err) {
      console.warn('저장에 실패했습니다.', err);
    }
  },

  /** 문자에서 읽은 건은 이미 담긴 것과 겹치면 건너뛴다(→ isSameTx).
      직접 입력은 사용자가 의도한 것이므로 겹쳐도 그대로 담는다. */
  add(list) {
    const added = [];
    for (const tx of list) {
      if (!tx.manual && this.transactions.some((t) => isSameTx(t, tx))) continue;
      this.transactions.push(tx);
      added.push(tx);
    }
    this.sort();
    this.save();
    return added;
  },

  /** 최신순. 날짜를 아직 모르는 건은 눈에 띄도록 맨 위. */
  sort() {
    this.transactions.sort((a, b) => {
      if (a.at === null && b.at === null) return 0;
      if (a.at === null) return -1;
      if (b.at === null) return 1;
      return b.at - a.at;
    });
  },

  setDate(id, at) {
    const tx = this.transactions.find((t) => t.id === id);
    if (!tx) return;
    tx.at = at;
    this.sort();
    this.save();
  },

  remove(id) {
    this.transactions = this.transactions.filter((t) => t.id !== id);
    this.save();
  },

  setCategory(id, category) {
    const tx = this.transactions.find((t) => t.id === id);
    if (!tx) return;
    tx.category = category;
    this.learned[tx.merchant] = category;      // 같은 가맹점은 다음부터 이 분류로
    this.transactions.forEach((t) => {
      if (t.merchant === tx.merchant) t.category = category;
    });
    this.save();
  },

  clear() {
    this.transactions = [];
    this.learned = {};
    this.save();
  },
};

/* ────────────────────────────────────────────
   포맷
   ──────────────────────────────────────────── */
const won = (n) => `${n < 0 ? '-' : ''}${Math.abs(Math.round(n)).toLocaleString('ko-KR')}원`;
const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const monthKey = (ts) => dayKey(ts).slice(0, 7);
const shortDate = (key) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

function dateTimeLabel(ts) {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** <input type="datetime-local"> 이 쓰는 형식. */
function inputValue(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const dated = (txs) => txs.filter((t) => t.at !== null);

/* ────────────────────────────────────────────
   DOM
   ──────────────────────────────────────────── */
const el = {
  input: document.getElementById('sms-input'),
  parseBtn: document.getElementById('parse-btn'),
  status: document.getElementById('parse-status'),
  monthFilter: document.getElementById('month-filter'),
  cardFilter: document.getElementById('card-filter'),
  chartCard: document.getElementById('chart-card'),
  chartCardSection: document.getElementById('chart-card-section'),
  cardList: document.getElementById('card-list'),
  mCard: document.getElementById('m-card'),
  exportBtn: document.getElementById('export-csv'),
  clearBtn: document.getElementById('clear-all'),
  results: document.getElementById('results'),
  empty: document.getElementById('empty-state'),
  kpiTotal: document.getElementById('kpi-total'),
  kpiRange: document.getElementById('kpi-range'),
  kpiCount: document.getElementById('kpi-count'),
  kpiAvg: document.getElementById('kpi-avg'),
  kpiDaily: document.getElementById('kpi-daily'),
  kpiDays: document.getElementById('kpi-days'),
  kpiTopCat: document.getElementById('kpi-top-cat'),
  kpiTopCatAmt: document.getElementById('kpi-top-cat-amt'),
  chartCategory: document.getElementById('chart-category'),
  chartDaily: document.getElementById('chart-daily'),
  txBody: document.getElementById('tx-body'),
  txCount: document.getElementById('tx-count'),
  tooltip: document.getElementById('tooltip'),
  manualForm: document.getElementById('manual-form'),
  manualStatus: document.getElementById('manual-status'),
  mDate: document.getElementById('m-date'),
  mTime: document.getElementById('m-time'),
  mMerchant: document.getElementById('m-merchant'),
  mAmount: document.getElementById('m-amount'),
  mCategory: document.getElementById('m-category'),
};

// 직접 입력 폼의 분류 목록과 기본 날짜(오늘)를 채운다
el.mCategory.innerHTML = ['<option value="auto">자동 분류</option>']
  .concat(CATEGORIES.map((c) => `<option value="${c}">${c}</option>`))
  .join('');
el.mDate.value = dayKey(Date.now());

let selectedMonth = 'all';
let selectedCard = 'all';

const cardLabel = (tx) => tx.card || '카드 미상';

function visibleTransactions() {
  return store.transactions.filter((t) => {
    if (selectedCard !== 'all' && cardLabel(t) !== selectedCard) return false;
    // 날짜를 모르는 건은 어느 달에도 넣을 수 없으므로 전체 기간에서만 보인다
    if (selectedMonth !== 'all' && (t.at === null || monthKey(t.at) !== selectedMonth)) return false;
    return true;
  });
}

/* ── 툴팁 ── */
function bindTooltip(node, html) {
  node.addEventListener('mouseenter', () => {
    el.tooltip.innerHTML = html;
    el.tooltip.hidden = false;
  });
  node.addEventListener('mousemove', (e) => {
    const rect = el.tooltip.getBoundingClientRect();
    const x = Math.min(e.clientX + 12, window.innerWidth - rect.width - 8);
    const y = Math.max(e.clientY - rect.height - 10, 8);
    el.tooltip.style.left = `${x}px`;
    el.tooltip.style.top = `${y}px`;
  });
  node.addEventListener('mouseleave', () => { el.tooltip.hidden = true; });
}

/* ── 렌더 ── */
function render() {
  renderCardFilter();
  renderMonthFilter();

  const txs = visibleTransactions();
  const hasData = store.transactions.length > 0;
  el.empty.hidden = hasData;
  el.results.hidden = !hasData;
  if (!hasData) return;

  renderKpis(txs);
  renderCategoryChart(txs);
  renderDailyChart(txs);
  renderCardChart(txs);
  renderTable(txs);
}

function cardNames() {
  return [...new Set(store.transactions.map(cardLabel))].sort();
}

function renderCardFilter() {
  const cards = cardNames();
  if (selectedCard !== 'all' && !cards.includes(selectedCard)) selectedCard = 'all';

  el.cardFilter.innerHTML = ['<option value="all">전체 카드</option>']
    .concat(cards.map((c) => `<option value="${c}">${c}</option>`))
    .join('');
  el.cardFilter.value = selectedCard;

  // 직접 입력 폼의 카드 이름 자동완성도 같이 채운다
  el.cardList.innerHTML = cards.map((c) => `<option value="${c}"></option>`).join('');
}

function renderMonthFilter() {
  const months = [...new Set(dated(store.transactions).map((t) => monthKey(t.at)))].sort().reverse();
  if (selectedMonth !== 'all' && !months.includes(selectedMonth)) selectedMonth = 'all';

  const options = ['<option value="all">전체 기간</option>']
    .concat(months.map((m) => {
      const label = `${Number(m.slice(5, 7))}월 (${m.slice(0, 4)})`;
      return `<option value="${m}"${m === selectedMonth ? ' selected' : ''}>${label}</option>`;
    }));
  el.monthFilter.innerHTML = options.join('');
  el.monthFilter.value = selectedMonth;
}

function renderKpis(txs) {
  const total = txs.reduce((sum, t) => sum + t.amount, 0);
  const withDate = dated(txs);
  const undatedCount = txs.length - withDate.length;
  const datedTotal = withDate.reduce((sum, t) => sum + t.amount, 0);
  const days = new Set(withDate.map((t) => dayKey(t.at)));
  const dayCount = days.size || 1;

  el.kpiTotal.textContent = won(total);
  el.kpiCount.textContent = `${txs.length}건`;
  el.kpiAvg.textContent = txs.length ? `건당 평균 ${won(total / txs.length)}` : '';
  el.kpiDaily.textContent = won(datedTotal / dayCount);
  el.kpiDays.textContent = undatedCount
    ? `결제한 날 ${dayCount}일 기준 · 날짜 미정 ${undatedCount}건 제외`
    : `결제한 날 ${dayCount}일 기준`;

  const sorted = [...days].sort();
  el.kpiRange.textContent = sorted.length
    ? (sorted.length === 1 ? shortDate(sorted[0]) : `${shortDate(sorted[0])} – ${shortDate(sorted[sorted.length - 1])}`)
    : '';

  const byCategory = groupSum(txs, (t) => t.category);
  const top = byCategory[0];
  el.kpiTopCat.textContent = top ? top.key : '—';
  el.kpiTopCatAmt.textContent = top ? `${won(top.value)} · ${Math.round((top.value / total) * 100)}%` : '';
}

function groupSum(txs, keyFn) {
  const map = new Map();
  for (const t of txs) map.set(keyFn(t), (map.get(keyFn(t)) || 0) + t.amount);
  return [...map.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
}

/** 가로 막대. 큰 값부터, 값은 막대 끝에 직접 라벨한다. */
function renderBars(container, rows) {
  if (!rows.length) {
    container.innerHTML = '<p class="chart-empty">표시할 지출이 없습니다.</p>';
    return;
  }

  const max = rows[0].value;
  const total = rows.reduce((s, r) => s + r.value, 0);
  container.innerHTML = '';

  for (const row of rows) {
    const wrap = document.createElement('div');
    wrap.className = 'bar-row';

    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = row.key;
    label.title = row.key;

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.max((row.value / max) * 100, 1.5)}%`;
    track.appendChild(fill);

    const value = document.createElement('span');
    value.className = 'bar-value';
    value.textContent = won(row.value);

    bindTooltip(wrap, `${row.key}<br><span class="tt-value">${won(row.value)}</span> · ${Math.round((row.value / total) * 100)}%`);

    wrap.append(label, track, value);
    container.appendChild(wrap);
  }
}

function renderCategoryChart(txs) {
  renderBars(el.chartCategory, groupSum(txs, (t) => t.category).filter((r) => r.value > 0));
}

function renderCardChart(txs) {
  const rows = groupSum(txs, cardLabel).filter((r) => r.value > 0);
  // 카드가 하나뿐이면 총 지출과 같은 말이므로 섹션을 접는다
  el.chartCardSection.hidden = rows.length < 2;
  if (rows.length >= 2) renderBars(el.chartCard, rows);
}

function renderDailyChart(txs) {
  const byDay = new Map();
  for (const t of dated(txs)) byDay.set(dayKey(t.at), (byDay.get(dayKey(t.at)) || 0) + t.amount);
  const days = [...byDay.keys()].sort();

  if (!days.length) {
    el.chartDaily.innerHTML = '<p class="chart-empty">표시할 지출이 없습니다.</p>';
    return;
  }

  // 첫 결제일 ~ 마지막 결제일 사이의 빈 날도 자리를 채워 흐름을 유지한다
  const filled = [];
  const cursor = new Date(days[0]);
  const last = new Date(days[days.length - 1]);
  while (cursor <= last && filled.length < 120) {
    const key = dayKey(cursor.getTime());
    filled.push({ key, value: byDay.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const max = Math.max(...filled.map((d) => d.value), 1);
  const labelStep = Math.ceil(filled.length / 10);

  el.chartDaily.innerHTML = '';
  const columns = document.createElement('div');
  columns.className = 'columns';
  const labels = document.createElement('div');
  labels.className = 'col-labels';

  filled.forEach((d, i) => {
    const slot = document.createElement('div');
    slot.className = 'col-slot';
    if (d.value > 0) {
      const bar = document.createElement('div');
      bar.className = 'col-bar';
      bar.style.height = `${Math.max((d.value / max) * 100, 2)}%`;
      slot.appendChild(bar);
    }
    bindTooltip(slot, `${shortDate(d.key)}<br><span class="tt-value">${won(d.value)}</span>`);
    columns.appendChild(slot);

    const label = document.createElement('span');
    label.textContent = i % labelStep === 0 ? shortDate(d.key) : '';
    labels.appendChild(label);
  });

  // 축 눈금 대신, 가장 큰 날 하나만 캡션으로 직접 라벨한다
  const peak = filled.reduce((a, b) => (b.value > a.value ? b : a));
  const caption = document.createElement('div');
  caption.className = 'chart-caption';
  caption.innerHTML = `<span>최고 ${shortDate(peak.key)}</span><span>${won(peak.value)}</span>`;

  el.chartDaily.append(caption, columns, labels);
}

/** 일시 셀. 누르면 그 자리에서 날짜를 고칠 수 있다(날짜가 없는 문자를 채울 때 쓴다). */
function dateCell(tx, cell) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = tx.at === null ? 'btn link needs-date' : 'btn link';
  button.textContent = tx.at === null ? '날짜 입력' : dateTimeLabel(tx.at);
  button.title = '일시 수정';

  button.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'date-input';
    input.value = inputValue(tx.at === null ? Date.now() : tx.at);

    const commit = () => {
      if (!input.value) { render(); return; }
      const next = new Date(input.value).getTime();
      if (Number.isFinite(next)) store.setDate(tx.id, next);
      render();
    };

    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') render();
    });

    cell.replaceChildren(input);
    input.focus();
  });

  return button;
}

function renderTable(txs) {
  el.txCount.textContent = `${txs.length}건`;
  el.txBody.innerHTML = '';

  for (const tx of txs) {
    const tr = document.createElement('tr');

    const time = document.createElement('td');
    time.appendChild(dateCell(tx, time));

    const merchant = document.createElement('td');
    merchant.className = 'merchant';
    merchant.textContent = tx.merchant;

    const card = document.createElement('td');
    card.className = 'card-name';
    card.textContent = cardLabel(tx);
    card.title = cardLabel(tx);

    const category = document.createElement('td');
    const select = document.createElement('select');
    select.className = 'cat-select';
    select.setAttribute('aria-label', `${tx.merchant} 분류`);
    for (const c of CATEGORIES) {
      const option = document.createElement('option');
      option.value = c;
      option.textContent = c;
      if (c === tx.category) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      store.setCategory(tx.id, select.value);
      render();
    });
    category.appendChild(select);

    const amount = document.createElement('td');
    amount.className = tx.amount < 0 ? 'num refund' : 'num';
    amount.textContent = won(tx.amount);

    const actions = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'btn icon';
    del.type = 'button';
    del.textContent = '×';
    del.title = '삭제';
    del.setAttribute('aria-label', `${tx.merchant} 내역 삭제`);
    del.addEventListener('click', () => {
      store.remove(tx.id);
      render();
    });
    actions.appendChild(del);

    tr.append(time, merchant, card, category, amount, actions);
    el.txBody.appendChild(tr);
  }
}

/* ────────────────────────────────────────────
   CSV
   ──────────────────────────────────────────── */
function toCsv(txs) {
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ['일시', '가맹점', '분류', '금액', '카드'];
  const rows = txs.map((t) => [
    t.at === null ? '' : dateTimeLabel(t.at), t.merchant, t.category, t.amount, t.card,
  ].map(escape).join(','));
  return `﻿${header.map(escape).join(',')}\n${rows.join('\n')}\n`;
}

function downloadCsv() {
  const txs = visibleTransactions();
  if (!txs.length) return;
  const blob = new Blob([toCsv(txs)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const scope = [selectedMonth === 'all' ? '전체기간' : selectedMonth];
  if (selectedCard !== 'all') scope.push(selectedCard);
  a.download = `소비내역_${scope.join('_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ────────────────────────────────────────────
   이벤트
   ──────────────────────────────────────────── */
function handleParse() {
  const text = el.input.value.trim();
  if (!text) {
    setStatus('문자를 먼저 붙여넣어 주세요.', true);
    return;
  }

  const { parsed, failed } = parseSms(text);
  if (!parsed.length) {
    setStatus('인식할 수 있는 결제 문자를 찾지 못했습니다.', true);
    return;
  }

  const added = store.add(parsed);
  const skipped = parsed.length - added.length;
  const undated = added.filter((t) => t.at === null).length;
  const parts = [`${added.length}건 추가`];
  if (skipped) parts.push(`중복 ${skipped}건 제외`);
  if (undated) parts.push(`날짜 미정 ${undated}건 — 표에서 채워주세요`);
  if (failed.length) parts.push(`인식 실패 ${failed.length}건`);
  setStatus(parts.join(' · '));

  el.input.value = '';
  render();
}

/** 직접 입력 폼 → 내역 한 건 추가. */
function handleManualAdd(e) {
  e.preventDefault();

  const merchant = el.mMerchant.value.trim();
  const amount = Number(el.mAmount.value);
  if (!merchant) { setManualStatus('가맹점을 입력해 주세요.', true); return; }
  if (!Number.isFinite(amount) || amount === 0) { setManualStatus('금액을 입력해 주세요.', true); return; }

  const at = el.mDate.value
    ? new Date(`${el.mDate.value}T${el.mTime.value || '00:00'}`).getTime()
    : null;

  const category = el.mCategory.value === 'auto' ? categorize(merchant) : el.mCategory.value;

  store.add([{
    id: newId(),
    at: Number.isFinite(at) ? at : null,
    amount,
    merchant,
    card: el.mCard.value.trim() || '직접 입력',
    running: null,
    category,
    canceled: amount < 0,
    manual: true,
  }]);

  setManualStatus(`${merchant} ${won(amount)} 추가`);
  el.mMerchant.value = '';
  el.mAmount.value = '';
  el.mCategory.value = 'auto';
  el.mMerchant.focus();
  render();
}

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle('error', isError);
}

function setManualStatus(message, isError = false) {
  el.manualStatus.textContent = message;
  el.manualStatus.classList.toggle('error', isError);
}

el.parseBtn.addEventListener('click', handleParse);
el.manualForm.addEventListener('submit', handleManualAdd);

// ⌘/Ctrl + Enter 로도 정리
el.input.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleParse();
});

el.monthFilter.addEventListener('change', () => {
  selectedMonth = el.monthFilter.value;
  render();
});

el.cardFilter.addEventListener('change', () => {
  selectedCard = el.cardFilter.value;
  render();
});

el.exportBtn.addEventListener('click', downloadCsv);

el.clearBtn.addEventListener('click', () => {
  if (!store.transactions.length) return;
  if (!confirm('저장된 내역을 모두 지울까요? 되돌릴 수 없습니다.')) return;
  store.clear();
  setStatus('');
  render();
});

store.load();
render();
