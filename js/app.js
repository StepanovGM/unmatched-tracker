const STORAGE_KEY = 'unmatched-tracker-state';

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

// Most heroes are one hero figure (+ optional sidekicks), but a few
// (e.g. Raptors) are a *pack*: several identical fighters and no single
// "hero" figure at all (heroFigure.count > 1, sidekick: null). Those get
// fighter keys 'hero-0', 'hero-1', ... instead of the single 'hero' key,
// so each pack member is tracked/damaged independently.
function heroFigureCount(hero) {
  return hero && hero.heroFigure && hero.heroFigure.count > 1 ? hero.heroFigure.count : 1;
}

function fightersForPlayer(player) {
  const hero = heroBySlug(state.current.players[player].heroSlug);
  const figureCount = heroFigureCount(hero);
  const list = [];
  if (figureCount > 1) {
    for (let i = 0; i < figureCount; i++) {
      list.push({ fighter: 'hero-' + i, label: `${hero ? hero.name : 'Hero'} ${i + 1}` });
    }
  } else {
    list.push({ fighter: 'hero', label: hero ? hero.name : 'Hero' });
  }
  if (hero && hero.sidekick && hero.sidekick.count > 0) {
    const count = hero.sidekick.count;
    for (let i = 0; i < count; i++) {
      list.push({ fighter: i, label: count > 1 ? `${hero.sidekick.name} ${i + 1}` : hero.sidekick.name });
    }
  }
  return list;
}

function isHeroFighter(fighterKey) {
  return fighterKey === 'hero' || (typeof fighterKey === 'string' && fighterKey.indexOf('hero-') === 0);
}

function fighterLabel(match, player, fighterKey) {
  const hero = heroBySlug(match.players[player].heroSlug);
  if (!hero) return String(fighterKey);
  if (fighterKey === 'hero') return hero.name;
  if (typeof fighterKey === 'string' && fighterKey.indexOf('hero-') === 0) {
    return `${hero.name} ${Number(fighterKey.slice(5)) + 1}`;
  }
  const count = hero.sidekick ? hero.sidekick.count : 1;
  const name = hero.sidekick ? hero.sidekick.name : 'Sidekick';
  return count > 1 ? `${name} ${fighterKey + 1}` : name;
}

function startingHpFor(match, player, fighter) {
  const hero = heroBySlug(match.players[player].heroSlug);
  if (!hero) return 0;
  return isHeroFighter(fighter) ? hero.hp : (hero.sidekick && hero.sidekick.hp ? hero.sidekick.hp : 1);
}

function startingHp(player, fighter) {
  return startingHpFor(state.current, player, fighter);
}

function currentHp(player, fighter) {
  const log = state.current.log;
  const delta = log
    .filter((e) => e.type === 'hp' && e.player === player && e.target.fighter === fighter)
    .reduce((sum, e) => sum + e.delta, 0);
  return startingHp(player, fighter) + delta;
}

// Running HP total right after a specific 'hp' log entry was applied —
// used to show "current HP" in the log without needing a separate,
// always-visible HP display (per Gleb's minimalism call).
function hpAfterEntry(match, targetEntry) {
  const idx = match.log.indexOf(targetEntry);
  const { player } = targetEntry;
  const fighter = targetEntry.target.fighter;
  const delta = match.log
    .slice(0, idx + 1)
    .filter((e) => e.type === 'hp' && e.player === player && e.target.fighter === fighter)
    .reduce((sum, e) => sum + e.delta, 0);
  return startingHpFor(match, player, fighter) + delta;
}

function isDead(player, fighter) {
  return state.current.log.some((e) => e.type === 'death' && e.player === player && e.target.fighter === fighter);
}

function startMatch(slugA, slugB) {
  if (state.current) {
    state.history.unshift(state.current);
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
    state.current = null;
    resetNav();
    saveState();
    render();
  });
}

function setStatus(message) {
  document.getElementById('status').textContent = message;
}

// --- Press feedback -------------------------------------------------------
// CSS :active is unreliable on mobile touch, and a commit action (e.g.
// logging a play) may not otherwise change what's on screen — every
// interactive control needs an explicit, immediate visual response.
function bindPress(el) {
  const on = () => el.classList.add('pressed');
  const off = () => el.classList.remove('pressed');
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('pointercancel', off);
}

// --- Icons ------------------------------------------------------------
// Custom icons are authored inline (simple, generic symbols — not sourced
// from any card/game asset) and encoded as data URIs. Card-type icons are
// hotlinked from unmatched.cards' community symbol set (see TYPE_META),
// same "hotlink, never download" policy as hero/card art.
function svgDataUri(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const ICONS = {
  heart: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f2f2f5" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
  ),
  hourglass: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f2f2f5" d="M6 2h12v2c0 2.5-2 4.2-4.2 5.5L13 10l.8.5C16 11.8 18 13.5 18 16v2H6v-2c0-2.5 2-4.2 4.2-5.5L11 10l-.8-.5C8 8.2 6 6.5 6 4V2zm2 2v.3c0 1.4 1.3 2.6 3.2 3.8L12 8.5l.8-.4C14.7 6.9 16 5.7 16 4.3V4H8zm0 16v-.3c0-1.4 1.3-2.6 3.2-3.8l.8-.4.8.4c1.9 1.2 3.2 2.4 3.2 3.8v.3H8z"/></svg>'
  ),
  boot: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#f2f2f5" d="M272.5 18.906c-12.775.17-26.23 2.553-40.344 7.594-30.165 55.31-68.313 120.904-125.72 178.5-21.19 21.26-39.23 44.94-52.28 68.313 1.294 6.312 4.984 11.65 10.72 17.406 10.992 11.032 30.86 21.618 54.593 33.25 46.313 22.695 107.284 50.39 146.374 108.467l195.625.032c-20.198-70.834-100.276-101.12-159.064-83.94-.073.03-.145.066-.22.095-1.61.633-3.27 1.138-4.967 1.563-.024.005-.04.025-.064.03-8.86 2.204-18.82 1.68-29.125-.406-24.79-5.02-52.76-19.695-61.342-45.687-28.615-86.673 16.65-179.742 78.156-223.28 23.064-16.328 49.06-25.848 74.47-24.47.144.008.29.023.436.03-24.19-22.74-53.33-37.95-87.25-37.5zm81.75 56c-19.213.01-39.414 7.59-58.625 21.188-54.644 38.682-96.652 125.024-71.188 202.156 5.127 15.53 27.25 29.162 47.282 33.22 10.015 2.027 19.218 1.518 23.717-.283 2.25-.9 3.173-1.84 3.594-2.562.422-.72.81-1.663.25-4.375-9.08-44.167-2.743-84.61 22.533-114.47 23.586-27.863 62.753-45.462 117.406-50.686-15.014-47.145-37.47-71.226-61.314-80.03-6.407-2.368-13.032-3.706-19.812-4.064-1.272-.067-2.563-.094-3.844-.094zM43.78 294.22c-5.405 12.554-9.136 24.756-10.905 36.186 7.178 27.76 51.898 55.43 91.094 61.344 1.703-5.973 5.832-11.475 10.28-14.25 51.01 28.844 86.18 60.704 102 101h229.594c.697-9.613.44-18.712-.625-27.344l-204.314-.03h-5.125l-2.75-4.345c-35.405-55.575-93.93-82.58-141.78-106.03-23.925-11.724-45.17-22.336-59.625-36.844-2.978-2.99-5.618-6.225-7.844-9.687z"/></svg>'
  ),
  play: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="#f2f2f5"><rect x="2.3" y="9" width="7.4" height="11.2" rx="1.6" transform="rotate(-14 6 14.6)"/><rect x="8.3" y="6.8" width="7.4" height="12.4" rx="1.6"/><rect x="14.3" y="9" width="7.4" height="11.2" rx="1.6" transform="rotate(14 18 14.6)"/></g></svg>'
  ),
  discard: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect fill="#f2f2f5" x="2" y="5" width="9.5" height="14" rx="1.8"/><path fill="#f2f2f5" d="M13.5 10.2h4.2v-2.7l5 4.5-5 4.5v-2.7h-4.2z"/></svg>'
  ),
  draw: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect fill="#f2f2f5" opacity="0.45" x="3.3" y="8.5" width="9.5" height="14" rx="1.8"/><rect fill="#f2f2f5" x="6.3" y="5.5" width="9.5" height="14" rx="1.8"/><path fill="#f2f2f5" d="M19.3 3.2l4 5.2h-2.7v4.6h-2.6V8.4h-2.7z"/></svg>'
  ),
  returnCard: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect fill="#f2f2f5" x="12.5" y="5" width="9.5" height="14" rx="1.8"/><path fill="#f2f2f5" d="M10.5 10.2H6.3v-2.7l-5 4.5 5 4.5v-2.7h4.2z"/></svg>'
  ),
  plus: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M11 3h2v8h8v2h-8v8h-2v-8H3v-2h8z"/></svg>'
  ),
  star: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f2f2f5" d="M12 2l2.9 6.6 7.1.7-5.4 4.7 1.6 7-6.2-3.8L5.8 21l1.6-7L2 9.3l7.1-.7z"/></svg>'
  ),
};

// Community-standard Unmatched card-type colors/icons (unmatched.cards).
const TYPE_META = {
  attack: { color: '#dc3034', icon: 'https://unmatched.cards/img/attack.3856f1fe.svg', label: 'Attack' },
  versatile: { color: '#6c4e8d', icon: 'https://unmatched.cards/img/versatile.25641eb0.svg', label: 'Versatile' },
  defense: { color: '#2c76ac', icon: 'https://unmatched.cards/img/defence.e13b40d0.svg', label: 'Defense' },
  scheme: { color: '#fcbd71', icon: 'https://unmatched.cards/img/scheme.9b22b426.svg', label: 'Scheme' },
};

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
    bindPress(btn);

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
    case 'draw':
      return heroName + ' — Draw a card';
    case 'play': {
      const mechLabel = { attack: 'Attack', scheme: 'Scheme', defense: 'Defense' }[entry.mechanic] || entry.mechanic;
      return `${heroName} — ${mechLabel}: ${entry.cardName}`;
    }
    case 'discard':
      return `${heroName} — Discard: ${entry.cardName}${entry.boosted ? ' (Boost)' : ''}`;
    case 'hp': {
      const who = fighterLabel(match, entry.player, entry.target.fighter);
      const sign = entry.delta >= 0 ? '+' : '';
      const hpNow = hpAfterEntry(match, entry);
      return `${who} ${sign}${entry.delta} HP → ${hpNow}`;
    }
    case 'death':
      return `${fighterLabel(match, entry.player, entry.target.fighter)} defeated`;
    case 'spawn':
      return `${heroName} — Sidekick spawn`;
    case 'ability':
      return `${heroName} — Special ability`;
    case 'return':
      return `${heroName} — Card returns: ${entry.cardName}`;
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

const RETURN_LEAF = {
  'r-attack': 'attack',
  'r-versatile': 'versatile',
  'r-scheme': 'scheme',
  'r-defense': 'defense',
};

const MENU_LABELS = {
  play: 'Play', discard: 'Discard', hp: 'HP', return: 'Card Returns',
  attack: 'Attack', versatile: 'Versatile', scheme: 'Scheme', defend: 'Defend',
  'd-attack': 'Attack', 'd-versatile': 'Versatile', 'd-scheme': 'Scheme', 'd-defense': 'Defense',
  'r-attack': 'Attack', 'r-versatile': 'Versatile', 'r-scheme': 'Scheme', 'r-defense': 'Defense',
};

function makeMenuButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'menu-btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  bindPress(btn);
  return btn;
}

function makeIconButton(sizeClass, iconKey, caption, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'menu-btn icon-only ' + sizeClass;
  const img = document.createElement('img');
  img.className = 'icon';
  img.src = ICONS[iconKey];
  img.alt = '';
  btn.appendChild(img);
  const label = document.createElement('span');
  label.className = 'icon-caption';
  label.textContent = caption;
  btn.appendChild(label);
  btn.addEventListener('click', onClick);
  bindPress(btn);
  return btn;
}

function makeTypeTile(cardType, onClick) {
  const meta = TYPE_META[cardType];
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'type-tile';
  btn.style.background = meta.color;
  const img = document.createElement('img');
  img.className = 'icon';
  img.src = meta.icon;
  img.alt = meta.label;
  btn.appendChild(img);
  btn.addEventListener('click', onClick);
  bindPress(btn);
  return btn;
}

function renderRootMenu(grid) {
  const player = actingPlayer();
  const hero = heroBySlug(state.current.players[player].heroSlug);
  const hasSidekick = !!(hero && hero.sidekick && hero.sidekick.count > 0);

  const row1 = document.createElement('div');
  row1.className = 'tile-row';
  row1.appendChild(makeIconButton('tile-lg', 'boot', 'Maneuver', () => commitSimple({ type: 'action', mechanic: 'maneuver' })));
  row1.appendChild(makeIconButton('tile-lg', 'play', 'Play', () => { nav.path = ['play']; renderMenu(); }));
  grid.appendChild(row1);

  grid.appendChild(makeIconButton('tile-lg tile-full', 'heart', 'HP', () => { nav.path = ['hp']; renderMenu(); }));

  const row2 = document.createElement('div');
  row2.className = 'tile-row';
  row2.appendChild(makeIconButton('tile-lg', 'discard', 'Discard', () => { nav.path = ['discard']; renderMenu(); }));
  row2.appendChild(makeIconButton('tile-lg', 'hourglass', 'End Turn', () => commitSimple({ type: 'pass' })));
  grid.appendChild(row2);

  const row3 = document.createElement('div');
  row3.className = 'tile-row';
  row3.appendChild(makeIconButton('tile-sm', 'draw', 'Draw', () => commitSimple({ type: 'draw' })));
  row3.appendChild(makeIconButton('tile-sm', 'returnCard', 'Returns', () => { nav.path = ['return']; renderMenu(); }));

  const spawnBtn = document.createElement('button');
  spawnBtn.type = 'button';
  spawnBtn.className = 'menu-btn tile-sm spawn-tile';
  if (hasSidekick) {
    spawnBtn.style.backgroundImage = `url("${hero.sidekick.tokenImages[0]}")`;
    const badge = document.createElement('span');
    badge.className = 'spawn-badge';
    const badgeIcon = document.createElement('img');
    badgeIcon.className = 'icon';
    badgeIcon.src = ICONS.plus;
    badgeIcon.alt = '';
    badge.appendChild(badgeIcon);
    spawnBtn.appendChild(badge);
    const caption = document.createElement('span');
    caption.className = 'spawn-caption';
    caption.textContent = 'Spawn';
    spawnBtn.appendChild(caption);
    spawnBtn.addEventListener('click', () => commitSimple({ type: 'spawn' }));
    bindPress(spawnBtn);
  } else {
    spawnBtn.disabled = true;
  }
  row3.appendChild(spawnBtn);

  row3.appendChild(makeIconButton('tile-sm', 'star', 'Ability', () => commitSimple({ type: 'ability' })));
  grid.appendChild(row3);
}

function renderPlayMenu(grid) {
  if (!nav.reply) grid.appendChild(makeTypeTile('attack', () => { nav.path = ['play', 'attack']; renderMenu(); }));
  grid.appendChild(makeTypeTile('versatile', () => { nav.path = ['play', 'versatile']; renderMenu(); }));
  if (!nav.reply) grid.appendChild(makeTypeTile('scheme', () => { nav.path = ['play', 'scheme']; renderMenu(); }));
  if (nav.reply) grid.appendChild(makeTypeTile('defense', () => { nav.path = ['play', 'defend']; renderMenu(); }));
}

function renderDiscardMenu(grid) {
  ['attack', 'versatile', 'scheme', 'defense'].forEach((t) => {
    grid.appendChild(makeTypeTile(t, () => { nav.path = ['discard', 'd-' + t]; renderMenu(); }));
  });
}

function renderReturnMenu(grid) {
  ['attack', 'versatile', 'scheme', 'defense'].forEach((t) => {
    grid.appendChild(makeTypeTile(t, () => { nav.path = ['return', 'r-' + t]; renderMenu(); }));
  });
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

    const payload = () => {
      const base = { type: opts.commitType, cardType, cardId: card.id, cardName: card.name };
      if (opts.commitType === 'play') base.mechanic = typeof opts.mechanic === 'function' ? opts.mechanic() : opts.mechanic;
      // Boost (long-press to discard with boosted:true) is disabled for
      // now — the hold gesture wasn't reliably registering on mobile.
      // Keep the field so old/new log entries stay the same shape.
      if (opts.commitType === 'discard') base.boosted = false;
      return base;
    };

    btn.addEventListener('click', () => commitSimple(payload()));
    bindPress(btn);

    grid.appendChild(btn);
  });
}

function renderHpPanel(grid) {
  const player = actingPlayer();
  const fighters = fightersForPlayer(player);

  // The default/leftover selection may not exist for this hero (e.g. a
  // pack hero like Raptors has no 'hero' key at all) — fall back to the
  // first available fighter instead of leaving the selection empty.
  const validKeys = new Set(fighters.map((f) => f.fighter));
  const hasValidTarget = Array.from(nav.hp.targets).some((t) => validKeys.has(t));
  if (!hasValidTarget && fighters.length > 0) {
    nav.hp.targets = new Set([fighters[0].fighter]);
  }

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
    bindPress(btn);
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
    bindPress(btn);
    signRow.appendChild(btn);
  });

  const amountGrid = document.createElement('div');
  amountGrid.className = 'hp-amount-grid';
  for (let n = 1; n <= 10; n++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn hp-amount-btn';
    btn.textContent = String(n);
    btn.disabled = nav.hp.targets.size === 0;
    btn.addEventListener('click', () => commitHp(n));
    bindPress(btn);
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

  const showHeader = nav.path.length > 0;
  header.hidden = !showHeader;
  header.classList.toggle('reply-active', nav.reply);
  breadcrumb.textContent = breadcrumbText();

  const key = nav.path.join('.');
  grid.classList.toggle('root-menu', key === '');
  grid.classList.toggle('reply-context', nav.reply);
  const isCardList =
    (nav.path[0] === 'play' && PLAY_LEAF[nav.path[1]]) ||
    (nav.path[0] === 'discard' && DISCARD_LEAF[nav.path[1]]) ||
    (nav.path[0] === 'return' && RETURN_LEAF[nav.path[1]]);
  grid.classList.toggle('card-grid', !!isCardList);

  if (key === '') {
    renderRootMenu(grid);
  } else if (key === 'play') {
    renderPlayMenu(grid);
  } else if (key === 'discard') {
    renderDiscardMenu(grid);
  } else if (key === 'return') {
    renderReturnMenu(grid);
  } else if (nav.path[0] === 'play' && PLAY_LEAF[nav.path[1]]) {
    const leaf = PLAY_LEAF[nav.path[1]];
    renderCardList(grid, leaf.cardType, { commitType: 'play', mechanic: leaf.mechanic });
  } else if (nav.path[0] === 'discard' && DISCARD_LEAF[nav.path[1]]) {
    renderCardList(grid, DISCARD_LEAF[nav.path[1]], { commitType: 'discard' });
  } else if (nav.path[0] === 'return' && RETURN_LEAF[nav.path[1]]) {
    renderCardList(grid, RETURN_LEAF[nav.path[1]], { commitType: 'return' });
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

  document.getElementById('turn-number-label').textContent = 'T' + turnNumber;

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
  // Newest entry first in the DOM (not CSS column-reverse, which doesn't
  // reliably keep overflow scrolled to "the start" across browsers) —
  // so the freshly-logged action is always what's visible after a commit.
  match.log.slice().reverse().forEach((entry) => {
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
  logEl.scrollTop = 0;
}

// A match counts as decided if exactly one player's hero died (pack
// heroes use 'hero-0'/'hero-1'/... — isHeroFighter covers those too).
// Undetermined (e.g. abandoned mid-game via New Match) shows no winner.
function matchWinner(match) {
  const deadPlayers = new Set();
  match.log.forEach((e) => {
    if (e.type === 'death' && isHeroFighter(e.target.fighter)) deadPlayers.add(e.player);
  });
  if (deadPlayers.size === 1) return 1 - Array.from(deadPlayers)[0];
  return null;
}

// Opens a past match exactly like pasting its single-match JSON would:
// it becomes the current match (fully live — Undo, more actions, etc.
// all work on it), and whatever was current gets archived into history.
function openHistoryMatch(matchId) {
  const idx = state.history.findIndex((m) => m.id === matchId);
  if (idx === -1) return;
  const match = state.history[idx];
  state.history.splice(idx, 1);
  if (state.current) state.history.unshift(state.current);
  state.current = match;
  resetNav();
  saveState();
  render();
}

function renderHistory() {
  const card = document.getElementById('history-card');
  const list = document.getElementById('history-list');
  card.hidden = state.history.length === 0;
  list.innerHTML = '';

  state.history.forEach((match) => {
    const winner = matchWinner(match);
    const { turnNumber } = deriveTurnState(match.log);

    const row = document.createElement('div');
    row.className = 'history-row';
    row.addEventListener('click', () => openHistoryMatch(match.id));
    bindPress(row);

    const playersRow = document.createElement('div');
    playersRow.className = 'history-players';

    [0, 1].forEach((i) => {
      const hero = heroBySlug(match.players[i].heroSlug);
      const side = document.createElement('div');
      side.className = 'history-side' + (winner === i ? ' winner' : '');

      const img = document.createElement('img');
      img.className = 'history-avatar';
      img.src = hero ? hero.avatarImage || '' : '';
      img.alt = '';

      const name = document.createElement('span');
      name.className = 'history-side-name';
      name.textContent = hero ? hero.name : match.players[i].heroSlug;

      side.appendChild(img);
      side.appendChild(name);
      playersRow.appendChild(side);

      if (i === 0) {
        const vs = document.createElement('span');
        vs.className = 'history-vs';
        vs.textContent = 'vs';
        playersRow.appendChild(vs);
      }
    });

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const started = new Date(match.startedAt);
    const dateStr = isNaN(started) ? '' : started.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    meta.textContent = `T${turnNumber} · ${dateStr}`;

    row.appendChild(playersRow);
    row.appendChild(meta);
    list.appendChild(row);
  });
}

function render() {
  const hasMatch = !!state.current;
  document.getElementById('app-title').hidden = hasMatch;
  document.getElementById('setup-screen').hidden = hasMatch;
  document.getElementById('match-screen').hidden = !hasMatch;
  document.getElementById('share-current-btn').disabled = !hasMatch;
  renderHistory();
  if (hasMatch) {
    renderMatch();
  } else {
    renderSetup();
  }
}

function wireEvents() {
  const startBtn = document.getElementById('start-match-btn');
  startBtn.addEventListener('click', () => {
    if (draft[0] && draft[1] && draft[0] !== draft[1]) {
      startMatch(draft[0], draft[1]);
    }
  });
  bindPress(startBtn);

  const undoBtn = document.getElementById('undo-btn');
  undoBtn.addEventListener('click', undoLast);
  bindPress(undoBtn);

  const newMatchBtn = document.getElementById('new-match-btn');
  newMatchBtn.addEventListener('click', requestNewMatch);
  bindPress(newMatchBtn);

  const clearHistoryBtn = document.getElementById('clear-history-btn');
  clearHistoryBtn.addEventListener('click', () => {
    showConfirm('Delete all match history? This cannot be undone.', () => {
      state.history = [];
      saveState();
      render();
    });
  });
  bindPress(clearHistoryBtn);

  const cancelBtn = document.getElementById('menu-cancel-btn');
  cancelBtn.addEventListener('click', () => {
    resetNav();
    render();
  });
  bindPress(cancelBtn);

  [0, 1].forEach((i) => {
    const panel = document.getElementById('player-panel-' + i);
    panel.addEventListener('click', () => {
      if (!state.current) return;
      const { activePlayer } = deriveTurnState(state.current.log);
      if (i === activePlayer) {
        // Tapping the active player's own portrait can only ever exit
        // reply mode (there's nothing to toggle "into" for yourself) —
        // gives a way out of reply mode from either portrait, not just
        // the one that turned it on.
        if (nav.reply) {
          nav.reply = false;
          nav.path = [];
          render();
        }
        return;
      }
      nav.reply = !nav.reply;
      nav.path = [];
      render();
    });
    bindPress(panel);
  });

  const shareCurrentBtn = document.getElementById('share-current-btn');
  shareCurrentBtn.addEventListener('click', async () => {
    if (!state.current) return;
    const json = JSON.stringify(state.current, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus('Copied current match JSON to clipboard.');
    } catch (e) {
      setStatus('Copy failed: ' + e.message);
    }
  });
  bindPress(shareCurrentBtn);

  const shareBtn = document.getElementById('share-btn');
  shareBtn.addEventListener('click', async () => {
    const json = JSON.stringify(state, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus('Copied full backup (current match + history) JSON to clipboard.');
    } catch (e) {
      setStatus('Copy failed: ' + e.message);
    }
  });
  bindPress(shareBtn);

  const pasteArea = document.getElementById('paste-area');
  const loadPastedBtn = document.getElementById('load-pasted-btn');

  const pasteBtn = document.getElementById('paste-btn');
  pasteBtn.addEventListener('click', () => {
    const show = pasteArea.hidden;
    pasteArea.hidden = !show;
    loadPastedBtn.hidden = !show;
    if (show) pasteArea.focus();
  });
  bindPress(pasteBtn);

  function applyImportedState(text) {
    const imported = JSON.parse(text);
    if (imported && (imported.current !== undefined || Array.isArray(imported.history))) {
      // Full backup shape: { current, history }.
      state = {
        current: imported.current || null,
        history: Array.isArray(imported.history) ? imported.history : [],
      };
    } else if (imported && Array.isArray(imported.players) && Array.isArray(imported.log)) {
      // Single-match shape (from "Copy Current Match") — drop it in as the
      // current match, archiving whatever was already in progress here.
      if (state.current) {
        state.history.unshift(state.current);
      }
      state.current = imported;
    } else {
      throw new Error('Unrecognized JSON — expected a tracker backup or a single match.');
    }
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
  bindPress(loadPastedBtn);

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
