// Doit correspondre à APP_KEY dans app/config.php.
const appKey = 'atelier-idees-web-v1';
export const defaultQuestion = 'Qu’est-ce que vous voulez livrer en juin 2027 ?';
export const $ = (id) => document.getElementById(id);
export const codePattern = /^[A-HJ-NP-Z2-9]{6}$/;
const memory = new Map();

export function getStored(key) {
  try {
    const raw = sessionStorage.getItem('atelier.' + key);
    if (raw !== null) return JSON.parse(raw);
  } catch { /* Le mode privé peut limiter le stockage de l’onglet. */ }
  return memory.get(key) ?? null;
}

export function store(key, value) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) sessionStorage.removeItem('atelier.' + key);
    else sessionStorage.setItem('atelier.' + key, JSON.stringify(value));
  } catch { /* Le parcours reste utilisable en mémoire. */ }
}

export function newId() {
  // Disponible aussi sur un intranet HTTP, contrairement à crypto.randomUUID().
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}

export function notice(id, message = '', isError = false) {
  const node = $(id);
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.hidden = !message;
}

export async function runButton(button, status, action) {
  if (button.disabled) return;
  button.disabled = true;
  notice(status);
  try {
    await action();
  } catch (error) {
    notice(status, error.message, true);
  } finally {
    button.disabled = false;
  }
}

export async function api(action, {code, body, admin, token, csv = false} = {}) {
  const url = new URL('./api.php', document.baseURI);
  url.searchParams.set('action', action);
  if (code) url.searchParams.set('code', code);
  const headers = {'X-App-Key': appKey};
  if (admin) headers['X-Admin-Key'] = admin;
  if (token) headers['X-Participant-Token'] = token;
  if (body) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET', headers, cache: 'no-store',
      signal: controller.signal, body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || 'Le serveur n’a pas pu traiter la demande.');
      error.status = response.status;
      throw error;
    }
    return csv ? await response.blob() : await response.json();
  } catch (error) {
    if (error.status) throw error;
    throw new Error('Réponse du serveur indisponible. Vérifie la connexion et réessaie.');
  } finally {
    clearTimeout(timer);
  }
}
