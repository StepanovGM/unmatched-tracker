// Rewrites data/heroes.json in place, replacing every remote image URL with
// its local path from scripts/image-tasks.json (produced by
// generate-image-tasks.js + download-images.js). Run after downloading:
//
//   node scripts/localize-heroes-images.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const heroesPath = path.join(ROOT, 'data', 'heroes.json');
const tasks = JSON.parse(fs.readFileSync(path.join(__dirname, 'image-tasks.json'), 'utf8'));

const urlToPath = new Map(tasks.map((t) => [t.url, t.path]));

function localize(url) {
  if (!url) return url;
  const local = urlToPath.get(url);
  if (!local) throw new Error(`No local mapping for URL: ${url}`);
  return local;
}

const data = JSON.parse(fs.readFileSync(heroesPath, 'utf8'));

for (const hero of data.heroes) {
  hero.avatarImage = localize(hero.avatarImage);
  hero.cardBackImage = localize(hero.cardBackImage);

  if (hero.heroFigure) {
    if (hero.heroFigure.miniImage) {
      hero.heroFigure.miniImage = localize(hero.heroFigure.miniImage);
    }
    if (Array.isArray(hero.heroFigure.miniImages)) {
      hero.heroFigure.miniImages = hero.heroFigure.miniImages.map(localize);
    }
  }

  if (hero.sidekick && Array.isArray(hero.sidekick.tokenImages)) {
    hero.sidekick.tokenImages = hero.sidekick.tokenImages.map(localize);
  }

  for (const card of hero.cards) {
    card.image = localize(card.image);
  }
}

fs.writeFileSync(heroesPath, JSON.stringify(data, null, 2) + '\n');
console.log(`Localized image paths in ${path.relative(ROOT, heroesPath)}`);
