// Regenerates scripts/image-tasks.json from data/heroes.json (plus the
// hardcoded card-type icon URLs in js/app.js's TYPE_META). Run this whenever
// heroes.json changes, then hand the output to a downloader script.
//
//   node scripts/generate-image-tasks.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const heroes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8')).heroes;

// Mirrors TYPE_META in js/app.js. Kept in sync manually since it's a fixed,
// rarely-changing set of 4 icons.
const TYPE_ICONS = {
  attack: 'https://unmatched.cards/img/attack.3856f1fe.svg',
  versatile: 'https://unmatched.cards/img/versatile.25641eb0.svg',
  defense: 'https://unmatched.cards/img/defence.e13b40d0.svg',
  scheme: 'https://unmatched.cards/img/scheme.9b22b426.svg',
};

function extOf(url) {
  const clean = url.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot);
}

const tasks = [];
const seenPaths = new Set();

function addTask(url, relPath) {
  if (!url) return;
  if (seenPaths.has(relPath)) {
    throw new Error(`Duplicate output path: ${relPath} (url: ${url})`);
  }
  seenPaths.add(relPath);
  tasks.push({ url, path: relPath });
}

for (const hero of heroes) {
  const dir = `images/heroes/${hero.slug}`;

  addTask(hero.avatarImage, `${dir}/avatar${extOf(hero.avatarImage)}`);
  addTask(hero.cardBackImage, `${dir}/card-back${extOf(hero.cardBackImage)}`);

  const figure = hero.heroFigure;
  if (figure) {
    if (figure.miniImage) {
      addTask(figure.miniImage, `${dir}/mini${extOf(figure.miniImage)}`);
    }
    if (Array.isArray(figure.miniImages)) {
      figure.miniImages.forEach((url, i) => {
        addTask(url, `${dir}/mini-${i + 1}${extOf(url)}`);
      });
    }
  }

  if (hero.sidekick && Array.isArray(hero.sidekick.tokenImages)) {
    hero.sidekick.tokenImages.forEach((url, i) => {
      addTask(url, `${dir}/sidekick-${i + 1}${extOf(url)}`);
    });
  }

  for (const card of hero.cards) {
    addTask(card.image, `${dir}/cards/${card.id}${extOf(card.image)}`);
  }
}

for (const [type, url] of Object.entries(TYPE_ICONS)) {
  addTask(url, `images/icons/${type}${extOf(url)}`);
}

const outPath = path.join(__dirname, 'image-tasks.json');
fs.writeFileSync(outPath, JSON.stringify(tasks, null, 2) + '\n');
console.log(`Wrote ${tasks.length} tasks to ${path.relative(ROOT, outPath)}`);
