const STORAGE_KEY = 'unmatched-tracker-state';
const MAX_HISTORY = 5;

let heroes = [];
let state = loadState();
const draft = { 0: null, 1: null };

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        current: parsed && parsed.current ? parsed.current : null,
        history: parsed && Array.isArray(parsed.history) ? parsed.history : [],
      };
    }
  } catch (e) {
    console.warn('Failed to parse saved state, resetting.', e);
  }
  return { current: null, history: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function heroBySlug(slug) {
  return heroes.find((h) => h.slug === slug) || null;
}

function heroDisplayName(slug) {
  const hero = heroBySlug(slug);
  if (!hero) return slug;
  return hero.subtitle ? `${hero.name} ${hero.subtitle}` : hero.name;
}

function deriveTurnState(log) {
  let turnNumber = 1;
  let activePlayer = 0;
  for (const entry of log) {
    if (entry.type === 'pass') {
      turnNumber += 1;
      activePlayer = 1 - activePlayer;
    }
  }
  return { turnNumber, activePlayer };
}

function startMatch(slugA, slugB) {
  if (state.current) {
    state.history.unshift(state.current);
    state.history = state.history.slice(0, MAX_HISTORY);
  }
  state.current = {
    id: 'match-' + Date.now(),
    startedAt: new Date().toISOString(),
    players: [{ heroSlug: slugA }, { heroSlug: slugB }],
    log: [],
  };
  draft[0] = null;
  draft[1] = null;
  saveState();
  render();
}

function logAction(type) {
  const match = state.current;
  if (!match) return;
  const { turnNumber, activePlayer } = deriveTurnState(match.log);
  match.log.push({ type, player: activePlayer, turnNumber, at: new Date().toISOString() });
  saveState();
  render();
}

function passTurn() {
  logAction('pass');
}

function undoLast() {
  const match = state.current;
  if (!match || match.log.length === 0) return;
  match.log.pop();
  saveState();
  render();
}

function showConfirm(message, onConfirm) {
  const overlay = document.getElementById('confirm-overlay');
  document.getElementById('confirm-message').textContent = message;
  overlay.hidden = false;

  const okBtn = document.getElementById('confirm-ok-btn');
  const cancelBtn = document.getElementById('confirm-cancel-btn');

  function cleanup() {
    overlay.hidden = true;
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
  }
  function onOk() {
    cleanup();
    onConfirm();
  }
  function onCancel() {
    cleanup();
  }

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
}

function requestNewMatch() {
  if (!state.current) {
    render();
    return;
  }
  showConfirm('Archive the current match and start a new one?', () => {
    state.history.unshift(state.current);
    state.history = state.history.slice(0, MAX_HISTORY);
    state.current = null;
    saveState();
    render();
  });
}

function setStatus(message) {
  document.getElementById('status').textContent = message;
}

function renderHeroGrid(slotIndex) {
  const grid = document.getElementById('hero-grid-' + slotIndex);
  grid.innerHTML = '';
  const otherSlot = slotIndex === 0 ? 1 : 0;
  heroes.forEach((hero) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hero-item';
    if (draft[slotIndex] === hero.slug) btn.classList.add('selected');
    if (draft[otherSlot] === hero.slug) btn.disabled = true;

    const img = document.createElement('img');
    img.src = hero.avatarImage || '';
    img.alt = hero.name;
    img.loading = 'lazy';

    const label = document.createElement('span');
    label.textContent = hero.name;

    btn.appendChild(img);
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      draft[slotIndex] = hero.slug;
      renderSetup();
    });

    grid.appendChild(btn);
  });
}

function renderSetup() {
  renderHeroGrid(0);
  renderHeroGrid(1);
  const startBtn = document.getElementById('start-match-btn');
  startBtn.disabled = !(draft[0] && draft[1] && draft[0] !== draft[1]);
}

function actionLabel(entry) {
  switch (entry.type) {
    case 'maneuver': return 'Maneuver';
    case 'attack': return 'Attack';
    case 'scheme': return 'Scheme';
    case 'pass': return 'Passed turn';
    default: return entry.type;
  }
}

function renderMatch() {
  const match = state.current;
  const { turnNumber, activePlayer } = deriveTurnState(match.log);
  const activeSlug = match.players[activePlayer].heroSlug;
  const activeHero = heroBySlug(activeSlug);

  document.getElementById('turn-number-label').textContent = 'Turn ' + turnNumber;
  document.getElementById('active-player-label').textContent =
    (activeHero ? activeHero.name : activeSlug) + "'s turn";

  for (let i = 0; i < 2; i++) {
    const hero = heroBySlug(match.players[i].heroSlug);
    document.getElementById('player-avatar-' + i).src = hero ? hero.avatarImage || '' : '';
    document.getElementById('player-name-' + i).textContent = hero ? hero.name : match.players[i].heroSlug;
    document.getElementById('player-panel-' + i).classList.toggle('active', i === activePlayer);
  }

  document.getElementById('undo-btn').disabled = match.log.length === 0;

  const logEl = document.getElementById('action-log');
  logEl.innerHTML = '';
  match.log.forEach((entry) => {
    const hero = heroBySlug(match.players[entry.player].heroSlug);
    const li = document.createElement('li');

    const turnSpan = document.createElement('span');
    turnSpan.className = 'log-turn';
    turnSpan.textContent = 'T' + entry.turnNumber;

    const textSpan = document.createElement('span');
    textSpan.textContent = (hero ? hero.name : entry.player) + ' — ' + actionLabel(entry);

    li.appendChild(turnSpan);
    li.appendChild(textSpan);
    logEl.appendChild(li);
  });
}

function render() {
  const hasMatch = !!state.current;
  document.getElementById('setup-screen').hidden = hasMatch;
  document.getElementById('match-screen').hidden = !hasMatch;
  if (hasMatch) {
    renderMatch();
  } else {
    renderSetup();
  }
}

function wireEvents() {
  document.getElementById('start-match-btn').addEventListener('click', () => {
    if (draft[0] && draft[1] && draft[0] !== draft[1]) {
      startMatch(draft[0], draft[1]);
    }
  });

  document.querySelectorAll('.btn-action').forEach((btn) => {
    btn.addEventListener('click', () => logAction(btn.dataset.action));
  });

  document.getElementById('pass-turn-btn').addEventListener('click', passTurn);
  document.getElementById('undo-btn').addEventListener('click', undoLast);
  document.getElementById('new-match-btn').addEventListener('click', requestNewMatch);

  document.getElementById('share-btn').addEventListener('click', async () => {
    const json = JSON.stringify(state, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus('Copied JSON to clipboard.');
    } catch (e) {
      setStatus('Copy failed: ' + e.message);
    }
  });

  const pasteArea = document.getElementById('paste-area');
  const loadPastedBtn = document.getElementById('load-pasted-btn');

  document.getElementById('paste-btn').addEventListener('click', () => {
    const show = pasteArea.hidden;
    pasteArea.hidden = !show;
    loadPastedBtn.hidden = !show;
    if (show) pasteArea.focus();
  });

  function applyImportedState(text) {
    const imported = JSON.parse(text);
    state = imported;
    saveState();
    render();
  }

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
}

async function init() {
  try {
    const res = await fetch('data/heroes.json');
    const data = await res.json();
    heroes = data.heroes;
  } catch (e) {
    console.error('Failed to load hero data', e);
    setStatus('Failed to load hero data: ' + e.message);
  }
  wireEvents();
  render();
}

init();
