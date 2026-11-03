import {$, api, codePattern, defaultQuestion, getStored, newId, notice, runButton, store} from './common.js';

// Les deux listes dynamiques utilisent Vue sans compilateur de templates.
const {createApp, h, shallowRef} = window.Vue;
const sessionRows = shallowRef([]);
const ideaRows = shallowRef([]);

function sessionRow(session) {
  const count = session.idea_count;
  return h('li', {key: session.code}, [
    h('a', {href: '#' + session.code}, [
      h('span', {class: 'session-code'}, session.code),
      h('span', {class: 'session-title'}, session.question),
      h('span', {class: 'session-total'}, count + (count > 1 ? ' idées' : ' idée')),
      h('span', {class: 'row-arrow', 'aria-hidden': 'true'}, '→'),
    ]),
  ]);
}
createApp({render: () => sessionRows.value.map(sessionRow)}).mount('#sessionList');
createApp({render: () => ideaRows.value.map((text, index) => h('li', {key: index}, text))}).mount('#ideaList');

let key = getStored('admin') || '';
let current = null;
let navigation = 0;
let refreshNumber = 0;
let questionEdit = null;

function view(id) {
  ['loginView', 'listView', 'detailView'].forEach(name => { $(name).hidden = name !== id; });
  $('logout').hidden = id === 'loginView';
}

function signOut(message = '') {
  key = '';
  current = null;
  navigation++;
  store('admin', null);
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('adminKey').value = '';
  sessionRows.value = [];
  ideaRows.value = [];
  $('copyText').value = '';
  view('loginView');
  notice('loginStatus', message, Boolean(message));
}

async function adminApi(action, options = {}) {
  try {
    return await api(action, {...options, admin: key});
  } catch (error) {
    if (error.status === 401) signOut(error.message);
    throw error;
  }
}

function renderSessions(sessions) {
  $('sessionCount').textContent = sessions.length;
  $('noSessions').hidden = sessions.length > 0;
  sessionRows.value = sessions;
}

function renderCollection(result) {
  current = result.session;
  $('detailQuestion').textContent = current.question;
  $('detailCode').textContent = current.code;
  $('ideaCount').textContent = result.ideas.length;
  $('noIdeas').hidden = result.ideas.length > 0;
  ideaRows.value = result.ideas;
}

function drawQr(canvas, url) {
  const qr = window.qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4, scale = 12;
  canvas.width = canvas.height = (count + 2 * margin) * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#151821';
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (qr.isDark(y, x)) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    }
  }
}

function renderInvitation(code) {
  const url = new URL('./', location.href);
  url.searchParams.set('s', code);
  $('joinLink').href = url.href;
  $('joinCode').textContent = code;
  $('largeCode').textContent = code;
  try {
    drawQr($('qr'), url.href);
    $('openQr').hidden = false;
  } catch {
    $('openQr').hidden = true;
    notice('detailStatus', 'QR code indisponible. Partage le lien ou le code de session.', true);
  }
}

async function navigate(prefetched = null) {
  const turn = ++navigation;
  current = null;
  if (!key) { view('loginView'); return; }
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  const code = location.hash.slice(1).toUpperCase();
  const detail = codePattern.test(code);
  notice('listStatus');
  notice('detailStatus');
  try {
    if (detail) {
      const result = await adminApi('ideas', {code});
      if (turn !== navigation) return;
      renderCollection(result);
      renderInvitation(code);
      view('detailView');
      $('detailQuestion').focus();
    } else {
      const result = prefetched || await adminApi('sessions');
      if (turn !== navigation) return;
      renderSessions(result.sessions);
      view('listView');
    }
  } catch (error) {
    if (turn !== navigation || !key) return;
    // L’index reste accessible, même après l’ouverture d’un favori périmé.
    history.replaceState(null, '', location.pathname + location.search);
    view('listView');
    if (detail) {
      const result = await adminApi('sessions').catch(() => null);
      if (turn !== navigation) return;
      if (result) renderSessions(result.sessions);
    }
    notice('listStatus', error.message, true);
  }
}

async function freshIdeas() {
  const code = current?.code;
  if (!code) return null;
  const turn = navigation;
  const refresh = ++refreshNumber;
  const result = await adminApi('ideas', {code});
  if (turn !== navigation || current?.code !== code) return null;
  if (refresh === refreshNumber) renderCollection(result);
  return result;
}

$('loginForm').addEventListener('submit', event => {
  event.preventDefault();
  void runButton(event.currentTarget.querySelector('[type=submit]'), 'loginStatus', async () => {
    const entered = $('adminKey').value;
    const sessions = await api('sessions', {admin: entered});
    key = entered;
    store('admin', key);
    $('adminKey').value = '';
    await navigate(sessions);
  });
});

$('logout').addEventListener('click', () => signOut());
window.addEventListener('hashchange', () => { void navigate(); });
$('reloadList').addEventListener('click', () => {
  void runButton($('reloadList'), 'listStatus', () => navigate());
});
$('reloadIdeas').addEventListener('click', () => {
  void runButton($('reloadIdeas'), 'detailStatus', async () => {
    if (await freshIdeas()) notice('detailStatus', 'Liste actualisée.');
  });
});

function openQuestion(edit) {
  if (edit && !current) return;
  questionEdit = edit ? {code: current.code, revision: current.revision} : {id: newId()};
  $('dialogTitle').textContent = edit ? 'Modifier la question' : 'Nouvelle session';
  $('saveQuestion').textContent = edit ? 'Enregistrer' : 'Créer la session';
  $('questionInput').value = edit ? current.question : defaultQuestion;
  $('questionHint').textContent = edit ? 'Les idées déjà reçues restent dans la session.' : 'Le code de session et le QR code sont générés à la création.';
  notice('questionStatus');
  $('questionDialog').showModal();
  $('questionInput').focus();
}

$('createOpen').addEventListener('click', () => openQuestion(false));
$('editOpen').addEventListener('click', () => openQuestion(true));
$('questionForm').addEventListener('submit', event => {
  event.preventDefault();
  void runButton($('saveQuestion'), 'questionStatus', async () => {
    const form = questionEdit;
    const turn = navigation;
    const question = $('questionInput').value.trim();
    if (!question) throw new Error('Écris une question pour la session.');
    if (form.code) {
      try {
        const result = await adminApi('edit', {code: form.code, body: {question, revision: form.revision}});
        if (turn !== navigation) return;
        current = result.session;
        $('detailQuestion').textContent = current.question;
        notice('detailStatus', 'Question enregistrée.');
      } catch (error) {
        if (error.status === 409 && await freshIdeas()) {
          form.revision = current.revision;
          $('questionHint').textContent = 'Question actuellement affichée aux participants · ' + current.question;
        }
        throw error;
      }
      $('questionDialog').close();
    } else {
      const result = await adminApi('create', {body: {question, requestId: form.id}});
      if (turn !== navigation) return;
      $('questionDialog').close();
      location.hash = result.session.code;
    }
  });
});

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

$('openQr').addEventListener('click', () => {
  const small = $('qr'), large = $('largeQr');
  large.width = small.width;
  large.height = small.height;
  large.getContext('2d').drawImage(small, 0, 0);
  $('qrDialog').showModal();
});

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    notice('detailStatus', done);
  } catch {
    // HTTP interne ou navigateur qui réserve le presse-papiers aux gestes directs.
    $('copyText').value = text;
    $('copyDialog').showModal();
    $('copyText').focus();
    $('copyText').select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* Sélection manuelle. */ }
    if (copied) {
      $('copyDialog').close();
      notice('detailStatus', done);
    }
  }
}

$('copyLink').addEventListener('click', () => { void copy($('joinLink').href, 'Lien de participation copié.'); });
$('copyIdeas').addEventListener('click', () => {
  void runButton($('copyIdeas'), 'detailStatus', async () => {
    const result = await freshIdeas();
    if (!result) return;
    if (!result.ideas.length) { notice('detailStatus', 'Aucune idée à copier pour le moment.'); return; }
    await copy(result.ideas.join('\n'), 'Liste copiée, une idée par ligne.');
  });
});

$('exportIdeas').addEventListener('click', () => {
  void runButton($('exportIdeas'), 'detailStatus', async () => {
    const code = current?.code;
    if (!code) return;
    const file = await adminApi('csv', {code, csv: true});
    if (current?.code !== code) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'idees-' + code + '.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    notice('detailStatus', 'Le téléchargement du CSV a été lancé.');
  });
});

void navigate();
