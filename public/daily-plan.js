'use strict';

const dateInput = document.querySelector('#plan-date');
const form = document.querySelector('#plan-form');
const fields = form.querySelector('fieldset');
const nameInput = document.querySelector('#plan-name');
const amountInput = document.querySelector('#plan-amount');
const saveButton = document.querySelector('#plan-save');
const cancelButton = document.querySelector('#plan-cancel');
const status = document.querySelector('#plan-status');
const items = document.querySelector('#plan-items');
const empty = document.querySelector('#plan-empty');
const total = document.querySelector('#plan-total');
const endpoint = '/api/daily-plans';
const won = new Intl.NumberFormat('ko-KR');
let editingId = null;

const today = new Date();
dateInput.value = [String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function resetForm() {
  editingId = null;
  form.reset();
  saveButton.textContent = '추가';
  cancelButton.hidden = true;
}

function setBusy(busy) {
  dateInput.disabled = busy;
  fields.disabled = busy || !dateInput.value;
  for (const button of items.querySelectorAll('button')) button.disabled = busy;
  items.setAttribute('aria-busy', String(busy));
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || (response.status === 404 ? '항목이 이미 삭제되었습니다.' : '요청을 처리하지 못했습니다.'));
  }
  return response.status === 204 ? null : response.json();
}

function rowButton(label, item, action, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = danger ? 'btn ghost danger' : 'btn ghost';
  button.textContent = label;
  button.setAttribute('aria-label', item.name + ' ' + label);
  button.addEventListener('click', () => action(item));
  return button;
}

function render(rows) {
  items.replaceChildren();
  empty.hidden = rows.length !== 0;
  total.textContent = won.format(rows.reduce((sum, item) => sum + BigInt(item.amount), 0n)) + '원';

  for (const item of rows) {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'daily-item-name';
    name.textContent = item.name;
    const amount = document.createElement('strong');
    amount.textContent = won.format(item.amount) + '원';
    const actions = document.createElement('div');
    actions.className = 'daily-row-actions';
    actions.append(rowButton('수정', item, editItem), rowButton('삭제', item, deleteItem, true));
    row.append(name, amount, actions);
    items.append(row);
  }
}

async function loadDay(message = '') {
  items.replaceChildren();
  empty.hidden = true;
  total.textContent = '—';
  if (!dateInput.value) {
    showStatus('날짜를 선택해 주세요.');
    setBusy(false);
    return;
  }
  setBusy(true);
  showStatus('소비 계획을 불러오는 중입니다.');
  try {
    render(await request(endpoint + '?date=' + encodeURIComponent(dateInput.value)));
    showStatus(message);
  } catch {
    showStatus('소비 계획을 불러오지 못했습니다. 날짜를 다시 선택하거나 페이지를 새로고침해 주세요.', true);
  } finally {
    setBusy(false);
  }
}

function editItem(item) {
  editingId = item.id;
  nameInput.value = item.name;
  amountInput.value = item.amount;
  saveButton.textContent = '수정 저장';
  cancelButton.hidden = false;
  showStatus('');
  nameInput.focus();
}

async function deleteItem(item) {
  if (!window.confirm(item.name + ' 항목을 삭제할까요?')) return;
  setBusy(true);
  try {
    await request(endpoint + '/' + item.id, { method: 'DELETE' });
    if (editingId === item.id) resetForm();
    await loadDay('항목을 삭제했습니다.');
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

dateInput.addEventListener('change', () => {
  resetForm();
  loadDay();
});

cancelButton.addEventListener('click', () => {
  resetForm();
  showStatus('');
  nameInput.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!nameInput.value.trim()) {
    showStatus('항목명을 입력해 주세요.', true);
    nameInput.focus();
    return;
  }

  const item = { date: dateInput.value, name: nameInput.value, amount: amountInput.valueAsNumber };
  const id = editingId;
  setBusy(true);
  try {
    await request(id ? endpoint + '/' + id : endpoint, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    resetForm();
    await loadDay(id ? '항목을 수정했습니다.' : '항목을 추가했습니다.');
    nameInput.focus();
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    setBusy(false);
  }
});

loadDay();
