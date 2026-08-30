'use strict';

/* ────────────────────────────────────────────
   분류 규칙
   가맹점명에 아래 키워드가 들어 있으면 해당 분류로 자동 배정한다.
   위에서부터 먼저 걸리는 규칙이 이긴다.
   ──────────────────────────────────────────── */
const CATEGORIES = [
  '식재료', '건강식품', '기호식품', '주거', '교통', '개인', '쇼핑', '여행',
  '보험, 곗돈', '전화, 인터넷, iCloud', '육아 - 교육', '육아 - 생필품', '육아 - 간식',
  '건강/의료', '외식', '배달', '생활가전', '생필품', '경조사', '선물', '회사점심', '기타',
];

const CATEGORY_RULES = [
  ['배달',      ['배달의민족', '배민', '요기요', '쿠팡이츠']],
  ['외식',      ['식당', '국밥', '김밥', '분식', '치킨', '피자', '버거', '맥도날드', '롯데리아', '서브웨이',
                '한식', '중식', '일식', '초밥', '스시', '고기', '삼겹', '곱창', '족발', '보쌈', '칼국수',
                '면옥', '냉면', '쌀국수', '반점', '주점', '포차', '호프', '푸드', 'FOOD', '키친', 'KITCHEN']],
  ['기호식품',  ['커피', '카페', 'CAFE', 'COFFEE', '스타벅스', '투썸', '이디야', '메가엠지씨', '빽다방', '컴포즈',
                '파리바게', '뚜레쥬르', '베이커리', '디저트', '베스킨', '설빙', '공차', '탕후루']],
  ['교통',      ['택시', '카카오T', '코레일', '철도', '지하철', '버스', '교통', '주유', 'SK에너지', 'GS칼텍스',
                '하이패스', '주차', '아마노', '쏘카', '티머니']],
  ['여행',      ['항공', '에어', '공항', '호텔', '에어비앤비', '펜션', '리조트', '여행사', '하나투어', '모두투어']],
  ['건강/의료', ['약국', '병원', '의원', '치과', '한의', '클리닉', '메디컬']],
  ['건강식품',  ['영양제', '비타민', '홍삼', '유산균', '프로틴', '건강원']],
  ['육아 - 교육', ['어린이집', '유치원', '놀이학교', '문화센터', '학원']],
  ['육아 - 생필품', ['기저귀', '분유']],
  ['보험, 곗돈', ['보험료', '보험', '곗돈']],
  ['주거',      ['관리비', '전기요금', '한국전력', '도시가스', '수도요금', '상하수도', '월세', '임대료']],
  ['전화, 인터넷, iCloud', ['SKT', 'KT ', 'LGU', 'U+', '유플러스', '통신요금', '넷플릭스', 'NETFLIX', '유튜브', 'YOUTUBE',
                '스포티파이', 'APPLE', 'ICLOUD', '아이클라우드', '구글', 'GOOGLE', '멜론', '왓챠', '티빙', '쿠팡플레이']],
  ['생활가전',  ['하이마트', '전자랜드', '다나와', '이케아', '한샘']],
  ['식재료',    ['이마트', '홈플러스', '롯데마트', '마켓컬리', '컬리', 'SSG', '오아시스', '농협', '정육', '식품']],
  ['생필품',    ['다이소', '올리브영', 'GS25', 'CU ', '씨유', '세븐일레븐', '코리아세븐', '이마트24', '미니스톱', '스토리웨이']],
  ['쇼핑',      ['쿠팡', '11번가', 'G마켓', '지마켓', '옥션', '네이버페이', '무신사', '배송', '스토어']],
  ['경조사',    ['부의', '축의', '화환']],
  ['선물',      ['선물', '기프트', 'GIFT']],
  ['개인',      ['클라이밍', '짐', 'GYM', '피트니스', '헬스', '요가', '필라테스', '수영', '골프', 'CGV', '메가박스',
                '롯데시네마', '서점', '문고']],
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
const RE_TABLE_DATE = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;

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

/** 스프레드시트에서 복사한 탭 구분 표를 붙여넣을 때 쓴다.
    한 줄 = "날짜(생략 가능) \t 금액 \t 가맹점 \t 분류". 날짜 칸이 비어 있으면
    바로 위에서 마지막으로 읽은 날짜를 그대로 쓴다(병합 셀 흉내). */
function parseTable(text) {
  const parsed = [];
  const failed = [];
  let lastAt = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [dateRaw, amountRaw, merchantRaw, categoryRaw] = line.split('\t');

    const dateMatch = dateRaw && dateRaw.match(RE_TABLE_DATE);
    if (dateMatch) {
      const [, y, mo, d] = dateMatch;
      lastAt = new Date(Number(y), Number(mo) - 1, Number(d)).getTime();
    }

    const amount = Number(String(amountRaw || '').replace(/[^\d-]/g, ''));
    const merchant = tidy(merchantRaw || '');
    if (!merchant || !Number.isFinite(amount) || amount === 0) {
      if (line.includes('원') || amountRaw) failed.push(line);
      continue;
    }

    const categoryRawTidy = tidy(categoryRaw || '');
    const category = CATEGORIES.includes(categoryRawTidy) ? categoryRawTidy : categorize(merchant);

    parsed.push({
      id: newId(),
      at: lastAt,
      amount,
      merchant,
      card: UNKNOWN_CARD,
      running: null,
      category,
      canceled: amount < 0,
      manual: true,
    });
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
   저장소 (서버 API)
   ──────────────────────────────────────────── */
const UNKNOWN_CARD = '카드 미상';

async function apiFetch(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`${path} 요청 실패 (${res.status})`);
  return res.status === 204 ? null : res.json();
}

const store = {
  transactions: [],
  learned: {},   // 가맹점명 → 사용자가 직접 고른 분류
  cards: [],     // 직접 입력에서 고를 수 있는 카드 목록(사용자가 설정)

  async load() {
    const data = await apiFetch('/state');
    this.transactions = data.transactions;
    this.learned = data.learned;
    this.cards = data.cards;
    this.sort();
  },

  /** 문자에서 읽은 건은 서버가 이미 담긴 것과 겹치면 건너뛴다.
      직접 입력·표 붙여넣기(manual)는 사용자가 의도한 것이므로 겹쳐도 그대로 담는다. */
  async add(list) {
    if (!list.length) return [];
    const { added } = await apiFetch('/transactions', { method: 'POST', body: JSON.stringify(list) });
    this.transactions.push(...added);
    this.sort();
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

  /** 서버가 돌려준, 이번 수정으로 바뀐 행들을 로컬 목록에 반영한다.
      분류 수정은 같은 가맹점 전체(+ learned)에 걸치므로 여러 행이 함께 올 수 있다. */
  _mergePatch({ transactions, learned }) {
    for (const tx of transactions) {
      const i = this.transactions.findIndex((t) => t.id === tx.id);
      if (i !== -1) this.transactions[i] = tx;
    }
    this.learned = learned;
  },

  async setDate(id, at) {
    this._mergePatch(await apiFetch(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify({ at }) }));
    this.sort();
  },

  async setMerchant(id, merchant) {
    this._mergePatch(await apiFetch(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify({ merchant }) }));
  },

  async setAmount(id, amount) {
    this._mergePatch(await apiFetch(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify({ amount }) }));
  },

  async setCard(id, card) {
    this._mergePatch(await apiFetch(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify({ card }) }));
  },

  async setCategory(id, category) {
    this._mergePatch(await apiFetch(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify({ category }) }));
  },

  async remove(id) {
    await apiFetch(`/transactions/${id}`, { method: 'DELETE' });
    this.transactions = this.transactions.filter((t) => t.id !== id);
  },

  async clear() {
    await apiFetch('/transactions', { method: 'DELETE' });
    this.transactions = [];
    this.learned = {};
  },

  async addCard(name) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === UNKNOWN_CARD) return;
    const { cards } = await apiFetch('/cards', { method: 'POST', body: JSON.stringify({ name: trimmed }) });
    this.cards = cards;
  },

  async removeCard(name) {
    await apiFetch(`/cards/${encodeURIComponent(name)}`, { method: 'DELETE' });
    this.cards = this.cards.filter((c) => c !== name);
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
  tableInput: document.getElementById('table-input'),
  tableParseBtn: document.getElementById('table-parse-btn'),
  tableStatus: document.getElementById('table-status'),
  monthFilter: document.getElementById('month-filter'),
  cardFilter: document.getElementById('card-filter'),
  chartCard: document.getElementById('chart-card'),
  chartCardSection: document.getElementById('chart-card-section'),
  cardForm: document.getElementById('card-form'),
  cardNameInput: document.getElementById('card-name-input'),
  cardSettingsList: document.getElementById('card-settings-list'),
  cardModal: document.getElementById('card-modal'),
  openCardModalBtn: document.getElementById('open-card-modal'),
  tableModal: document.getElementById('table-modal'),
  openTableModalBtn: document.getElementById('open-table-modal'),
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

const cardLabel = (tx) => tx.card || UNKNOWN_CARD;

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
}

/** 설정에 등록된 카드 칩 목록. */
function renderCardSettings() {
  if (!store.cards.length) {
    el.cardSettingsList.innerHTML = '<li class="chip-empty">등록된 카드가 없습니다. 위에서 추가해 주세요.</li>';
    return;
  }

  el.cardSettingsList.innerHTML = '';
  for (const name of store.cards) {
    const li = document.createElement('li');
    li.className = 'chip';

    const label = document.createElement('span');
    label.textContent = name;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chip-remove';
    del.textContent = '×';
    del.title = `${name} 삭제`;
    del.setAttribute('aria-label', `${name} 삭제`);
    del.addEventListener('click', async () => {
      await store.removeCard(name);
      renderCardSettings();
      renderManualCardOptions();
    });

    li.append(label, del);
    el.cardSettingsList.appendChild(li);
  }
}

/** 직접 입력 폼의 카드 드롭다운. 카드 미상이 항상 첫 항목이다. */
function renderManualCardOptions() {
  const prev = el.mCard.value;
  el.mCard.innerHTML = [`<option value="${UNKNOWN_CARD}">${UNKNOWN_CARD}</option>`]
    .concat(store.cards.map((c) => `<option value="${c}">${c}</option>`))
    .join('');
  el.mCard.value = [UNKNOWN_CARD, ...store.cards].includes(prev) ? prev : UNKNOWN_CARD;
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

    // render()가 이 input을 DOM에서 떼어내면 브라우저가 자동으로 blur를 쏘므로,
    // commit이 시작하자마자 blur 리스너부터 떼서 재진입(중복 저장·Escape 후 저장)을 막는다.
    const commit = async () => {
      input.removeEventListener('blur', commit);
      if (!input.value) { render(); return; }
      const next = new Date(input.value).getTime();
      if (Number.isFinite(next)) {
        try { await store.setDate(tx.id, next); }
        catch (err) { console.error('일시 저장 실패', err); }
      }
      render();
    };
    const cancel = () => { input.removeEventListener('blur', commit); render(); };

    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') cancel();
    });

    cell.replaceChildren(input);
    input.focus();
  });

  return button;
}

/** 가맹점 셀. 누르면 그 자리에서 이름을 고칠 수 있다. */
function merchantCell(tx, cell) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn link';
  button.textContent = tx.merchant;
  button.title = '가맹점 수정';

  button.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cell-input';
    input.value = tx.merchant;

    const commit = async () => {
      input.removeEventListener('blur', commit);
      const value = input.value.trim();
      if (value) {
        try { await store.setMerchant(tx.id, value); }
        catch (err) { console.error('가맹점 저장 실패', err); }
      }
      render();
    };
    const cancel = () => { input.removeEventListener('blur', commit); render(); };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') cancel();
    });

    cell.replaceChildren(input);
    input.focus();
    input.select();
  });

  return button;
}

/** 카드 셀. 누르면 그 자리에서 카드 설정 목록 중 골라 바꿀 수 있다. */
function cardCell(tx, cell) {
  const current = cardLabel(tx);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn link';
  button.textContent = current;
  button.title = '카드 수정';

  button.addEventListener('click', () => {
    const select = document.createElement('select');
    select.className = 'cat-select';

    const options = [UNKNOWN_CARD, ...store.cards];
    if (!options.includes(current)) options.push(current);
    for (const name of options) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      if (name === current) option.selected = true;
      select.appendChild(option);
    }

    select.addEventListener('change', async () => {
      try { await store.setCard(tx.id, select.value); }
      catch (err) { console.error('카드 저장 실패', err); }
      render();
    });
    select.addEventListener('blur', () => render());
    select.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') render();
    });

    cell.replaceChildren(select);
    select.focus();
  });

  return button;
}

/** 금액 셀. 누르면 그 자리에서 금액을 고칠 수 있다(환불·취소는 음수로). */
function amountCell(tx, cell) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = tx.amount < 0 ? 'btn link refund' : 'btn link';
  button.textContent = won(tx.amount);
  button.title = '금액 수정';

  button.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'cell-input num-input';
    input.step = '10';
    input.value = tx.amount;

    const commit = async () => {
      input.removeEventListener('blur', commit);
      const value = Number(input.value);
      if (Number.isFinite(value) && value !== 0) {
        try { await store.setAmount(tx.id, value); }
        catch (err) { console.error('금액 저장 실패', err); }
      }
      render();
    };
    const cancel = () => { input.removeEventListener('blur', commit); render(); };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') cancel();
    });

    cell.replaceChildren(input);
    input.focus();
    input.select();
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
    merchant.appendChild(merchantCell(tx, merchant));

    const card = document.createElement('td');
    card.className = 'card-name';
    card.appendChild(cardCell(tx, card));

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
    select.addEventListener('change', async () => {
      try { await store.setCategory(tx.id, select.value); }
      catch (err) { console.error('분류 저장 실패', err); }
      render();
    });
    category.appendChild(select);

    const amount = document.createElement('td');
    amount.className = 'num';
    amount.appendChild(amountCell(tx, amount));

    const actions = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'btn icon';
    del.type = 'button';
    del.textContent = '×';
    del.title = '삭제';
    del.setAttribute('aria-label', `${tx.merchant} 내역 삭제`);
    del.addEventListener('click', async () => {
      try { await store.remove(tx.id); }
      catch (err) { console.error('삭제 실패', err); }
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
  const header = ['날짜', '금액', '설명', '카테고리'];
  const rows = txs.map((t) => [
    t.at === null ? '' : dayKey(t.at), t.amount, `${t.merchant} (${cardLabel(t)})`, t.category,
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
async function handleParse() {
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

  let added;
  try {
    added = await store.add(parsed);
  } catch (err) {
    setStatus('서버에 저장하지 못했습니다. 서버가 켜져 있는지 확인해 주세요.', true);
    console.error(err);
    return;
  }
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

/** 스프레드시트 표(탭 구분)를 붙여넣었을 때. */
async function handleTableParse() {
  const text = el.tableInput.value.trim();
  if (!text) {
    setTableStatus('표 데이터를 먼저 붙여넣어 주세요.', true);
    return;
  }

  const { parsed, failed } = parseTable(text);
  if (!parsed.length) {
    setTableStatus('인식할 수 있는 줄을 찾지 못했습니다.', true);
    return;
  }

  let added;
  try {
    added = await store.add(parsed);
  } catch (err) {
    setTableStatus('서버에 저장하지 못했습니다. 서버가 켜져 있는지 확인해 주세요.', true);
    console.error(err);
    return;
  }
  const parts = [`${added.length}건 추가`];
  if (failed.length) parts.push(`인식 실패 ${failed.length}건`);
  setTableStatus(parts.join(' · '));

  el.tableInput.value = '';
  render();
}

/** 직접 입력 폼 → 내역 한 건 추가. */
async function handleManualAdd(e) {
  e.preventDefault();

  const merchant = el.mMerchant.value.trim();
  const amount = Number(el.mAmount.value);
  if (!merchant) { setManualStatus('가맹점을 입력해 주세요.', true); return; }
  if (!Number.isFinite(amount) || amount === 0) { setManualStatus('금액을 입력해 주세요.', true); return; }

  const at = el.mDate.value
    ? new Date(`${el.mDate.value}T${el.mTime.value || '00:00'}`).getTime()
    : null;

  const category = el.mCategory.value === 'auto' ? categorize(merchant) : el.mCategory.value;

  try {
    await store.add([{
      id: newId(),
      at: Number.isFinite(at) ? at : null,
      amount,
      merchant,
      card: el.mCard.value || UNKNOWN_CARD,
      running: null,
      category,
      canceled: amount < 0,
      manual: true,
    }]);
  } catch (err) {
    setManualStatus('서버에 저장하지 못했습니다. 서버가 켜져 있는지 확인해 주세요.', true);
    console.error(err);
    return;
  }

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

function setTableStatus(message, isError = false) {
  el.tableStatus.textContent = message;
  el.tableStatus.classList.toggle('error', isError);
}

el.parseBtn.addEventListener('click', handleParse);
el.tableParseBtn.addEventListener('click', handleTableParse);
el.manualForm.addEventListener('submit', handleManualAdd);

el.cardForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el.cardNameInput.value.trim();
  if (!name) return;
  try {
    await store.addCard(name);
  } catch (err) {
    console.error('카드 추가 실패', err);
    return;
  }
  el.cardNameInput.value = '';
  renderCardSettings();
  renderManualCardOptions();
});

// ⌘/Ctrl + Enter 로도 정리
el.input.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleParse();
});

el.tableInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleTableParse();
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

el.clearBtn.addEventListener('click', async () => {
  if (!store.transactions.length) return;
  if (!confirm('저장된 내역을 모두 지울까요? 되돌릴 수 없습니다.')) return;
  try {
    await store.clear();
  } catch (err) {
    console.error('전체 삭제 실패', err);
    return;
  }
  setStatus('');
  render();
});

/** 바깥(뒷배경)을 눌러도 닫히게 한다. dialog 자신이 콘텐츠 크기만큼만 차지하므로,
    클릭 좌표가 실제 박스 밖이면 배경을 누른 것으로 본다. */
function bindModalBackdropClose(dialog) {
  dialog.addEventListener('click', (e) => {
    const rect = dialog.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right
      && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) dialog.close();
  });
}
bindModalBackdropClose(el.cardModal);
bindModalBackdropClose(el.tableModal);

el.openCardModalBtn.addEventListener('click', () => {
  el.cardModal.showModal();
  el.cardNameInput.focus();
});

el.openTableModalBtn.addEventListener('click', () => {
  el.tableModal.showModal();
  el.tableInput.focus();
});

(async () => {
  try {
    await store.load();
  } catch (err) {
    setStatus('서버에 연결하지 못했습니다. 서버가 켜져 있는지 확인해 주세요.', true);
    console.error(err);
  }
  renderCardSettings();
  renderManualCardOptions();
  render();
})();
