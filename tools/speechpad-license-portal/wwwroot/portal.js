const form = document.getElementById('issue-form');
const errorBox = document.getElementById('issue-error');
const result = document.getElementById('result');
const jsonBox = document.getElementById('license-json');
const summary = document.getElementById('result-summary');
const copyState = document.getElementById('copy-state');
const rows = document.getElementById('rows');
const empty = document.getElementById('empty');

let csrf = sessionStorage.getItem('csrf') || '';
let lastLicense = '';
let lastName = 'license.json';

const FEATURES = {
  insert: 'вставка',
  extension: 'расширение',
  topmost: 'поверх окон',
};

function requireCsrf() {
  if (csrf) return csrf;
  return fetch('/api/session')
    .then((r) => r.json())
    .then((data) => {
      if (!data.ok) throw new Error('Сессия истекла, войдите снова');
      csrf = data.csrf;
      sessionStorage.setItem('csrf', csrf);
      return csrf;
    });
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  result.hidden = true;
}

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  sessionStorage.clear();
  location.href = '/';
});

for (const radio of document.querySelectorAll('input[name="term"]')) {
  radio.addEventListener('change', () => {
    const value = radio.value;
    const isDays = value === 'days';
    const isDate = value === 'date';
    if (radio.checked) {
      document.getElementById('days').hidden = !isDays;
      document.getElementById('expires').hidden = !isDate;
    }
  });
}

for (const radio of document.querySelectorAll('input[name="binding"]')) {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      document.getElementById('machine').hidden = radio.value !== 'machine';
    }
  });
}

function slug(value) {
  return (value || 'license')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'license';
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  errorBox.hidden = true;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;

  try {
    const token = await requireCsrf();
    const data = new FormData(form);
    const term = data.get('term');
    const binding = data.get('binding');
    const features = data.getAll('features');

    const payload = {
      licensee: data.get('licensee'),
      note: data.get('note'),
      allMachines: binding === 'any',
      machine: binding === 'machine' ? data.get('machine') : null,
      days: term === 'days' ? Number(data.get('days')) : null,
      expires: term === 'date' ? data.get('expires') : null,
      features,
    };

    if (binding === 'machine' && !String(payload.machine || '').trim()) {
      throw new Error('Укажите machine id или выберите «любой компьютер»');
    }
    if (term === 'date' && !payload.expires) {
      throw new Error('Укажите дату окончания');
    }

    const resp = await fetch('/api/licenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(payload),
    });
    const out = await resp.json();
    if (!resp.ok || !out.ok) throw new Error(out.error || 'Не удалось выпустить лицензию');

    lastLicense = out.license;
    lastName = `Speechpad-${slug(out.licensee)}.lic`;
    jsonBox.textContent = JSON.stringify(JSON.parse(out.license), null, 2);
    summary.textContent = [
      out.licensee,
      out.perpetual ? 'бессрочно' : `до ${new Date(out.expires).toLocaleDateString('ru-RU')}`,
      out.machine ? 'один компьютер' : 'любой компьютер',
      (out.features || []).map((f) => FEATURES[f] || f).join(', '),
    ].join(' · ');
    copyState.textContent = '';
    result.hidden = false;
    form.reset();
    document.getElementById('machine').hidden = true;
    await loadHistory();
  } catch (err) {
    showError(err.message);
  } finally {
    submit.disabled = false;
  }
});

document.getElementById('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(lastLicense);
    copyState.textContent = 'Скопировано. Покупатель вставляет это в файл license.json в папке SpeechPad.';
  } catch {
    copyState.textContent = 'Не удалось скопировать — выделите текст выше.';
  }
});

document.getElementById('download').addEventListener('click', () => {
  const blob = new Blob([lastLicense], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = lastName;
  a.click();
  URL.revokeObjectURL(url);
});

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

async function loadHistory() {
  const resp = await fetch('/api/licenses');
  if (resp.status === 401) {
    location.href = '/';
    return;
  }
  const data = await resp.json();
  const items = data.licenses || [];
  rows.replaceChildren();
  empty.hidden = items.length > 0;

  for (const item of items) {
    const tr = document.createElement('tr');
    if (item.revoked) tr.classList.add('revoked');

    const name = document.createElement('td');
    name.textContent = item.licensee;
    if (item.revoked) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'отозвана';
      name.append(' ', badge);
    }
    tr.append(name);

    tr.append(cell(new Date(item.issued).toLocaleDateString('ru-RU')));
    tr.append(cell(item.perpetual ? 'бессрочно' : new Date(item.expires).toLocaleDateString('ru-RU')));
    tr.append(cell(item.machine ? item.machine.slice(0, 12) + '…' : 'любой', 'mono'));
    tr.append(cell((item.features || []).map((f) => FEATURES[f] || f).join(', ')));

    const actions = document.createElement('td');
    if (!item.revoked) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost small';
      button.textContent = 'отозвать';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const token = await requireCsrf();
          await fetch(`/api/licenses/${encodeURIComponent(item.id)}/revoke`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': token },
          });
          await loadHistory();
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    }
    tr.append(actions);
    rows.append(tr);
  }
}

async function boot() {
  const resp = await fetch('/api/session');
  const data = await resp.json();
  if (!data.ok) {
    location.href = '/';
    return;
  }
  csrf = data.csrf;
  sessionStorage.setItem('csrf', csrf);
  document.getElementById('key').textContent = `ключ ${data.key || '—'}`;
  await loadHistory();
}

boot();
