const STORAGE_KEY = 'unmatched-tracker-state';
const MAX_HISTORY = 5;

let heroes = [];
let state = loadState();
const draft = { 0: null, 1: null };

let nav = { path: [], reply: false, hp: { sign: '-', targets: new Set(['hero']) } };

function resetNav() {
  nav.path = [];
  nav.reply = false;
  nav.hp = { sign: '-', targets: new Set(['hero']) };
}

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

function actingPlayer() {
  const { activePlayer } = deriveTurnState(state.current.log);
  return nav.reply ? 1 - activePlayer : activePlayer;
}

function fightersForPlayer(player) {
  const hero = heroBySlug(state.current.players[player].heroSlug);
  const list = [{ fighter: 'hero', label: hero ? hero.name : 'Hero' }];
  if (hero && hero.sidekick && hero.sidekick.count > 0) {
    const count = hero.sidekick.count;
    for (let i = 0; i < count; i++) {
      list.push({ fighter: i, label: count > 1 ? `${hero.sidekick.name} ${i + 1}` : hero.sidekick.name });
    }
  }
  return list;
}

function fighterLabel(player, fighterKey) {
  const hero = heroBySlug(state.current.players[player].heroSlug);
  if (!hero) return String(fighterKey);
  if (fighterKey === 'hero') return hero.name;
  const count = hero.sidekick ? hero.sidekick.count : 1;
  const name = hero.sidekick ? hero.sidekick.name : 'Sidekick';
  return count > 1 ? `${name} ${fighterKey + 1}` : name;
}

function startingHp(player, fighter) {
  const hero = heroBySlug(state.current.players[player].heroSlug);
  if (!hero) return 0;
  return fighter === 'hero' ? hero.hp : (hero.sidekick && hero.sidekick.hp ? hero.sidekick.hp : 1);
}

function currentHp(player, fighter) {
  const log = state.current.log;
  const delta = log
    .filter((e) => e.type === 'hp' && e.player === player && e.target.fighter === fighter)
    .reduce((sum, e) => sum + e.delta, 0);
  return startingHp(player, fighter) + delta;
}

function isDead(player, fighter) {
  return state.current.log.some((e) => e.type === 'death' && e.player === player && e.target.fighter === fighter);
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
  resetNav();
  saveState();
  render();
}

function commitSimple(partial) {
  const match = state.current;
  const { turnNumber } = deriveTurnState(match.log);
  const player = actingPlayer();
  match.log.push({ ...partial, player, turnNumber, at: new Date().toISOString() });
  resetNav();
  saveState();
  render();
}

function commitHp(amount) {
  const match = state.current;
  const { turnNumber } = deriveTurnState(match.log);
  const player = actingPlayer();
  const sign = nav.hp.sign === '-' ? -1 : 1;
  const at = new Date().toISOString();
  const groupId = at + '-' + Math.random().toString(36).slice(2, 8);

  nav.hp.targets.forEach((fighter) => {
    match.log.push({ type: 'hp', target: { fighter }, delta: sign * amount, player, turnNumber, at, groupId });
    if (!isDead(player, fighter) && currentHp(player, fighter) < 1) {
      match.log.push({ type: 'death', target: { fighter }, player, turnNumber, at, groupId });
    }
  });

  resetNav();
  saveState();
  render();
}

function undoLast() {
  const match = state.current;
  if (!match || match.log.length === 0) return;
  const last = match.log[match.log.length - 1];
  if (last.groupId) {
    while (match.log.length && match.log[match.log.length - 1].groupId === last.groupId) {
      match.log.pop();
    }
  } else {
    match.log.pop();
  }
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
    resetNav();
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

function describeEntry(entry, match) {
  const hero = heroBySlug(match.players[entry.player].heroSlug);
  const heroName = hero ? hero.name : 'P' + (entry.player + 1);
  switch (entry.type) {
    case 'pass':
      return heroName + ' passed turn';
    case 'action':
      return heroName + ' — Maneuver';
    case 'play': {
      const mechLabel = { attack: 'Attack', scheme: 'Scheme', defense: 'Defense' }[entry.mechanic] || entry.mechanic;
      return `${heroName} — ${mechLabel}: ${entry.cardName}`;
    }
    case 'discard':
      return `${heroName} — Discard: ${entry.cardName}${entry.boosted ? ' (Boost)' : ''}`;
    case 'hp': {
      const who = fighterLabel(entry.player, entry.target.fighter);
      const sign = entry.delta >= 0 ? '+' : '';
      return `${who} ${sign}${entry.delta} HP`;
    }
    case 'death':
      return `${fighterLabel(entry.player, entry.target.fighter)} defeated`;
    case 'spawn':
      return `${heroName} — Sidekick spawn`;
    case 'ability':
      return `${heroName} — Special ability`;
    case 'return':
      return `${heroName} — Card returns to play`;
    default:
      return heroName + ' — ' + entry.type;
  }
}

const PLAY_LEAF = {
  attack: { cardType: 'attack', mechanic: 'attack' },
  versatile: { cardType: 'versatile', mechanic: () => (nav.reply ? 'defense' : 'attack') },
  scheme: { cardType: 'scheme', mechanic: 'scheme' },
  defend: { cardType: 'defense', mechanic: 'defense' },
};

const DISCARD_LEAF = {
  'd-attack': 'attack',
  'd-versatile': 'versatile',
  'd-scheme': 'scheme',
  'd-defense': 'defense',
};

const MENU_LABELS = {
  play: 'Play', discard: 'Discard', hp: 'HP',
  attack: 'Attack', versatile: 'Versatile', scheme: 'Scheme', defend: 'Defend',
  'd-attack': 'Attack', 'd-versatile': 'Versatile', 'd-scheme': 'Scheme', 'd-defense': 'Defense',
};

function bindTapOrHold(el, onTap, onHold, holdMs) {
  let timer = null;
  let held = false;
  const start = () => {
    held = false;
    timer = setTimeout(() => {
      held = true;
      onHold();
    }, holdMs || 500);
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const end = () => {
    const wasHeld = held;
    cancel();
    if (!wasHeld) onTap();
  };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function makeMenuButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'menu-btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderRootMenu(grid) {
  grid.appendChild(makeMenuButton('End Turn', () => commitSimple({ type: 'pass' })));
  grid.appendChild(makeMenuButton('Maneuver', () => commitSimple({ type: 'action', mechanic: 'maneuver' })));
  grid.appendChild(makeMenuButton('Play', () => { nav.path = ['play']; renderMenu(); }));
  grid.appendChild(makeMenuButton('Discard', () => { nav.path = ['discard']; renderMenu(); }));
  grid.appendChild(makeMenuButton('HP', () => { nav.path = ['hp']; renderMenu(); }));
  grid.appendChild(makeMenuButton('Sidekick Spawn', () => commitSimple({ type: 'spawn' })));
  grid.appendChild(makeMenuButton('Special Ability', () => commitSimple({ type: 'ability' })));
  grid.appendChild(makeMenuButton('Card Returns', () => commitSimple({ type: 'return' })));
}

function renderPlayMenu(grid) {
  if (!nav.reply) grid.appendChild(makeMenuButton('Attack', () => { nav.path = ['play', 'attack']; renderMenu(); }));
  grid.appendChild(makeMenuButton('Versatile', () => { nav.path = ['play', 'versatile']; renderMenu(); }));
  if (!nav.reply) grid.appendChild(makeMenuButton('Scheme', () => { nav.path = ['play', 'scheme']; renderMenu(); }));
  if (nav.reply) grid.appendChild(makeMenuButton('Defend', () => { nav.path = ['play', 'defend']; renderMenu(); }));
}

function renderDiscardMenu(grid) {
  grid.appendChild(makeMenuButton('Attack', () => { nav.path = ['discard', 'd-attack']; renderMenu(); }));
  grid.appendChild(makeMenuButton('Versatile', () => { nav.path = ['discard', 'd-versatile']; renderMenu(); }));
  grid.appendChild(makeMenuButton('Scheme', () => { nav.path = ['discard', 'd-scheme']; renderMenu(); }));
  grid.appendChild(makeMenuButton('Defense', () => { nav.path = ['discard', 'd-defense']; renderMenu(); }));
}

function renderCardList(grid, cardType, opts) {
  const player = actingPlayer();
  const hero = heroBySlug(state.current.players[player].heroSlug);
  const cards = (hero && hero.cards ? hero.cards : []).filter((c) => c.type === cardType);

  cards.forEach((card) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-item';

    const img = document.createElement('img');
    img.src = card.image || '';
    img.alt = card.name;
    img.loading = 'lazy';

    const label = document.createElement('span');
    label.textContent = card.name;

    btn.appendChild(img);
    btn.appendChild(label);

    if (opts.isDiscard) {
      bindTapOrHold(
        btn,
        () => commitSimple({ type: 'discard', cardType, cardId: card.id, cardName: card.name, boosted: false }),
        () => commitSimple({ type: 'discard', cardType, cardId: card.id, cardName: card.name, boosted: true })
      );
    } else {
      const mechanic = typeof opts.mechanic === 'function' ? opts.mechanic() : opts.mechanic;
      btn.addEventListener('click', () =>
        commitSimple({ type: 'play', mechanic, cardType, cardId: card.id, cardName: card.name })
      );
    }

    grid.appendChild(btn);
  });
}

function renderHpPanel(grid) {
  const player = actingPlayer();
  const fighters = fightersForPlayer(player);

  const wrap = document.createElement('div');
  wrap.className = 'hp-panel';

  const targetsRow = document.createElement('div');
  targetsRow.className = 'hp-targets';
  fighters.forEach((f) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fighter-toggle';
    if (nav.hp.targets.has(f.fighter)) btn.classList.add('selected');
    btn.textContent = f.label;
    btn.addEventListener('click', () => {
      if (nav.hp.targets.has(f.fighter)) nav.hp.targets.delete(f.fighter);
      else nav.hp.targets.add(f.fighter);
      renderMenu();
    });
    targetsRow.appendChild(btn);
  });

  const signRow = document.createElement('div');
  signRow.className = 'hp-sign-row';
  [
    ['-', '− Damage'],
    ['+', '+ Heal'],
  ].forEach(([sign, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sign-btn' + (nav.hp.sign === sign ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      nav.hp.sign = sign;
      renderMenu();
    });
    signRow.appendChild(btn);
  });

  const amountGrid = document.createElement('div');
  amountGrid.className = 'hp-amount-grid';
  for (let n = 1; n <= 10; n++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn';
    btn.textContent = String(n);
    btn.disabled = nav.hp.targets.size === 0;
    btn.addEventListener('click', () => commitHp(n));
    amountGrid.appendChild(btn);
  }

  wrap.appendChild(targetsRow);
  wrap.appendChild(signRow);
  wrap.appendChild(amountGrid);
  grid.appendChild(wrap);
}

function breadcrumbText() {
  const parts = nav.path.map((id) => MENU_LABELS[id] || id);
  const text = parts.join(' › ');
  return nav.reply ? (text ? text + ' (Reply)' : 'Reply mode') : text;
}

function renderMenu() {
  const grid = document.getElementById('menu-grid');
  const header = document.getElementById('menu-header');
  const breadcrumb = document.getElementById('menu-breadcrumb');
  grid.innerHTML = '';

  const showHeader = nav.path.length > 0 || nav.reply;
  header.hidden = !showHeader;
  breadcrumb.textContent = breadcrumbText();

  const key = nav.path.join('.');
  const isCardList =
    (nav.path[0] === 'play' && PLAY_LEAF[nav.path[1]]) || (nav.path[0] === 'discard' && DISCARD_LEAF[nav.path[1]]);
  grid.classList.toggle('card-grid', !!isCardList);

  if (key === '') {
    renderRootMenu(grid);
  } else if (key === 'play') {
    renderPlayMenu(grid);
  } else if (key === 'discard') {
    renderDiscardMenu(grid);
  } else if (nav.path[0] === 'play' && PLAY_LEAF[nav.path[1]]) {
    const leaf = PLAY_LEAF[nav.path[1]];
    renderCardList(grid, leaf.cardType, { mechanic: leaf.mechanic });
  } else if (nav.path[0] === 'discard' && DISCARD_LEAF[nav.path[1]]) {
    renderCardList(grid, DISCARD_LEAF[nav.path[1]], { isDiscard: true });
  } else if (key === 'hp') {
    renderHpPanel(grid);
  }

  const { activePlayer } = deriveTurnState(state.current.log);
  for (let i = 0; i < 2; i++) {
    document.getElementById('player-panel-' + i).classList.toggle('replying', nav.reply && i !== activePlayer);
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

  renderMenu();

  const logEl = document.getElementById('action-log');
  logEl.innerHTML = '';
  match.log.forEach((entry) => {
    const li = document.createElement('li');

    const turnSpan = document.createElement('span');
    turnSpan.className = 'log-turn';
    turnSpan.textContent = 'T' + entry.turnNumber;

    const textSpan = document.createElement('span');
    textSpan.textContent = describeEntry(entry, match);

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

  document.getElementById('undo-btn').addEventListener('click', undoLast);
  document.getElementById('new-match-btn').addEventListener('click', requestNewMatch);

  document.getElementById('menu-cancel-btn').addEventListener('click', () => {
    resetNav();
    render();
  });

  [0, 1].forEach((i) => {
    document.getElementById('player-panel-' + i).addEventListener('click', () => {
      if (!state.current) return;
      const { activePlayer } = deriveTurnState(state.current.log);
      if (i === activePlayer) return;
      nav.reply = !nav.reply;
      nav.path = [];
      render();
    });
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
    resetNav();
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
