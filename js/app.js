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
  const file = new File([json], `unmatched-tracker-${Date.now()}.json`, {
    type: 'application/json',
  });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'Unmatched Tracker state',
      });
      setStatus('Shared.');
    } catch (e) {
      if (e.name !== 'AbortError') setStatus('Share failed: ' + e.message);
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(json);
    setStatus('Sharing not supported here — copied JSON to clipboard instead.');
  } catch (e) {
    setStatus('Copy failed: ' + e.message);
  }
});

document.getElementById('import-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    state = imported;
    saveState(state);
    render();
    setStatus('Imported state from ' + file.name);
  } catch (e) {
    setStatus('Import failed: ' + e.message);
  }
  event.target.value = '';
});

render();
