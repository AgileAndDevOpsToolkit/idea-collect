import {$, api, codePattern, getStored, newId, notice, runButton, store} from './common.js';

const codeField = $('code');
const nicknameField = $('nickname');
const ideaField = $('idea');
const initialHint = $('joinHint').textContent;
let session = null;
let member = null;
let draft = null;

function showQuestion(next) {
  session = next;
  $('question').textContent = next.question;
  $('activeCode').textContent = next.code;
}

function showBoard(next, admission) {
  showQuestion(next);
  member = admission;
  draft = getStored('draft.' + next.code) || {text: '', id: newId()};
  ideaField.value = draft.text;
  updateCounter();
  $('hello').textContent = 'Bienvenue, ' + admission.name + '.';
  $('welcome').hidden = true;
  $('board').hidden = false;
  const url = new URL(location.href);
  url.searchParams.set('s', next.code);
  history.replaceState(null, '', url);
  notice('ideaStatus');
  $('question').focus();
}

function showJoin(message = '') {
  session = null;
  member = null;
  $('board').hidden = true;
  $('welcome').hidden = false;
  notice('joinStatus', message, Boolean(message));
}

function updateCounter() {
  $('counter').textContent = ideaField.value.length + ' / 1 000';
}

async function readInvitation(resume = false) {
  const code = codeField.value.trim().toUpperCase();
  $('joinHint').textContent = initialHint;
  if (!codePattern.test(code)) return;
  try {
    const result = await api('session', {code});
    if (code !== codeField.value.trim().toUpperCase() || session) return;
    $('joinHint').textContent = result.session.question;
    const admission = resume && getStored('member.' + code);
    if (admission) showBoard(result.session, admission);
  } catch (error) {
    if (!session && code === codeField.value.trim().toUpperCase()) notice('joinStatus', error.message, true);
  }
}

codeField.addEventListener('input', () => {
  codeField.value = codeField.value.toUpperCase();
  notice('joinStatus');
  void readInvitation();
});

$('joinForm').addEventListener('submit', event => {
  event.preventDefault();
  void runButton(event.currentTarget.querySelector('[type=submit]'), 'joinStatus', async () => {
    const code = codeField.value.trim().toUpperCase();
    const name = nicknameField.value.trim();
    if (!codePattern.test(code)) throw new Error('Saisis les six caractères du code de session.');
    if (!name) throw new Error('Saisis ton prénom ou ton pseudo.');
    const result = await api('join', {code, body: {nickname: name}});
    const admission = {name, token: result.token};
    store('member.' + code, admission);
    showBoard(result.session, admission);
  });
});

ideaField.addEventListener('input', () => {
  updateCounter();
  if (session && draft.text !== ideaField.value) {
    draft = {text: ideaField.value, id: newId()};
    store('draft.' + session.code, draft);
    notice('ideaStatus');
  }
});

async function refreshQuestion() {
  if (!session) return;
  const code = session.code;
  const result = await api('session', {code});
  if (session?.code === code && result.session.revision > session.revision) {
    showQuestion(result.session);
    notice('ideaStatus', 'La question a changé. Relis-la avant d’envoyer ton idée.');
  }
}

$('ideaForm').addEventListener('submit', event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type=submit]');
  void runButton(button, 'ideaStatus', async () => {
    if (!ideaField.value.trim()) throw new Error('Écris une idée avant de l’envoyer.');
    const code = session.code;
    ideaField.readOnly = true;
    $('leave').disabled = true;
    try {
      await api('submit', {code, token: member.token,
        body: {idea: draft.text, requestId: draft.id, revision: session.revision}});
      draft = {text: '', id: newId()};
      store('draft.' + code, null);
      ideaField.value = '';
      updateCounter();
      notice('ideaStatus', 'Idée enregistrée. Tu peux en proposer une autre !');
      ideaField.focus();
    } catch (error) {
      if (error.status === 409) await refreshQuestion();
      if (error.status === 403) {
        store('member.' + code, null);
        showJoin(error.message);
        return;
      }
      throw error;
    } finally {
      ideaField.readOnly = false;
      $('leave').disabled = false;
    }
  });
});

$('leave').addEventListener('click', () => {
  store('member.' + session.code, null);
  store('draft.' + session.code, null);
  nicknameField.value = '';
  const url = new URL(location.href);
  url.searchParams.delete('s');
  history.replaceState(null, '', url);
  showJoin();
  nicknameField.focus();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && session) void refreshQuestion().catch(() => {});
});

const fromLink = new URL(location.href).searchParams.get('s');
if (fromLink) {
  codeField.value = fromLink.trim().toUpperCase();
  if (codePattern.test(codeField.value)) void readInvitation(true);
  else notice('joinStatus', 'Ce lien contient un code invalide. Tu peux le corriger ci-dessus.', true);
}
