const STORAGE_KEY = 'unmatched-tracker-state';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to parse saved state, resetting.', e);
  }
  return { counter: 0 };
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

const counterValueEl = document.getElementById('counter-value');
const statusEl = document.getElementById('status');

function render() {
  counterValueEl.textContent = state.counter;
}

function setStatus(message) {
  statusEl.textContent = message;
}

document.getElementById('increment').addEventListener('click', () => {
  state.counter += 1;
  saveState(state);
  render();
});

document.getElementById('decrement').addEventListener('click', () => {
  state.counter -= 1;
  saveState(state);
  render();
});

document.getElementById('share-btn').addEventListener('click', async () => {
  const json = JSON.stringify(state, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    setStatus('Copied JSON to clipboard.');
  } catch (e) {
    setStatus('Copy failed: ' + e.message);
  }
});

function applyImportedState(text) {
  const imported = JSON.parse(text);
  state = imported;
  saveState(state);
  render();
}

const pasteArea = document.getElementById('paste-area');
const loadPastedBtn = document.getElementById('load-pasted-btn');

document.getElementById('paste-btn').addEventListener('click', () => {
  const show = pasteArea.hidden;
  pasteArea.hidden = !show;
  loadPastedBtn.hidden = !show;
  if (show) pasteArea.focus();
});

loadPastedBtn.addEventListener('click', () => {
  try {
    applyImportedState(pasteArea.value);
    pasteArea.value = '';
    pasteArea.hidden = true;
    loadPastedBtn.hidden = true;
    setStatus('Imported state from pasted text.');
  } catch (e) {
    setStatus('Import failed: ' + e.message);
  }
});

document.getElementById('import-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    applyImportedState(await file.text());
    setStatus('Imported state from ' + file.name);
  } catch (e) {
    setStatus('Import failed: ' + e.message);
  }
  event.target.value = '';
});

render();
