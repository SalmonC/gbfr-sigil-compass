import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const sourceCommit = '6aba7fc633e870de65f26c01462cdbe1dd6b6baa';
const sourceUrl = `https://raw.githubusercontent.com/choeki/gbfr-relink-sim/${sourceCommit}/src/data/seed.json`;
const response = await fetch(sourceUrl, { redirect: 'error' });
if (!response.ok) throw new Error(`Catalog source returned HTTP ${response.status}`);
const rawText = await response.text();
const raw = JSON.parse(rawText);
if (!Array.isArray(raw.traits) || raw.traits.length < 150) {
  throw new Error('Catalog source schema or trait count is invalid.');
}

const categories = [
  ['basic', '基础属性', 0],
  ['attack', '攻击', 1],
  ['defense', '防御', 2],
  ['support', '辅助', 3],
  ['special', '特殊', 4],
  ['character', '角色专属', 5]
].map(([id, nameZh, order]) => ({ id, nameZh, order }));
const validCategoryIds = new Set(categories.map(category => category.id));
const categoryOverlay = new Map([
  ['SKILL_235_00', 'attack'],
  ['SKILL_100_00', 'support'],
  ['SKILL_112_00', 'special'],
  ['SKILL_133_00', 'special'],
  ['SKILL_134_00', 'special'],
  ['SKILL_135_00', 'special'],
  ['SKILL_167_00', 'support']
]);

function normalizeCategory(trait) {
  const overlay = categoryOverlay.get(String(trait.id));
  if (overlay) return overlay;
  if (validCategoryIds.has(trait.category)) return trait.category;
  // The pinned seed omits category for character-exclusive traits. They are
  // identifiable by their character icon/ID families; keeping this rule in the
  // import adapter avoids leaking source quirks into the application model.
  if (String(trait.iconFile ?? '').startsWith('chars/')
    || /^HASH_/.test(String(trait.id))
    || /^SKILL_(11[4-9]|12[0-9]|13[0-2]|17[0-2])_/.test(String(trait.id))) return 'character';
  throw new Error(`Trait category requires an audited overlay: ${trait.id}`);
}

const traits = raw.traits.filter(trait =>
  typeof trait.hash === 'string' && /^0x[0-9A-Fa-f]{8}$/.test(trait.hash)
).map(trait => {
  const category = normalizeCategory(trait);
  const normalized = {
    id: String(trait.id),
    hash: trait.hash.toUpperCase().replace('0X', '0x'),
    nameZh: String(trait.nameZh || trait.name || trait.id),
    nameEn: String(trait.name || trait.id),
    category,
    canPrimary: trait.canPrimary !== false,
    canSecondary: trait.canSecondary !== false,
    maxLevel: Number.isInteger(trait.maxLevel) ? trait.maxLevel : null
  };
  const iconFile = typeof trait.iconFile === 'string' && !trait.iconFile.startsWith('chars/')
    ? trait.iconFile
    : null;
  return iconFile ? { ...normalized, iconFile } : normalized;
}).sort((left, right) => {
  const leftOrder = categories.find(category => category.id === left.category)?.order ?? 99;
  const rightOrder = categories.find(category => category.id === right.category)?.order ?? 99;
  return leftOrder - rightOrder || left.nameZh.localeCompare(right.nameZh, 'zh-CN');
});

const catalog = {
  schemaVersion: 1,
  catalogVersion: `gbfr-2.0.2-${sourceCommit.slice(0, 12)}-r2`,
  gameVersion: '2.0.2',
  source: {
    project: 'choeki/gbfr-relink-sim',
    commit: sourceCommit,
    url: sourceUrl,
    sha256: createHash('sha256').update(rawText).digest('hex'),
    importedAt: '2026-07-22T00:00:00Z'
  },
  categories,
  skippedTraitsWithoutHash: raw.traits.length - traits.length,
  traits
};

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(repositoryRoot, 'data', 'catalog');
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, 'catalog.zh-CN.json'),
  `${JSON.stringify(catalog, null, 2)}\n`,
  'utf8');
console.log(`Imported ${traits.length} traits from ${sourceCommit}.`);
