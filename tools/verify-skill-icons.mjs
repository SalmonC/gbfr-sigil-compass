import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(
  path.join(repositoryRoot, 'data/catalog/catalog.zh-CN.json'), 'utf8'));
const provenance = JSON.parse(await readFile(
  path.join(repositoryRoot, 'data/catalog/skill-icon-provenance.json'), 'utf8'));
const expectedFiles = new Set(catalog.traits.flatMap(trait => trait.iconFile ? [trait.iconFile] : []));
const assetDirectory = path.join(repositoryRoot, 'desktop/src/renderer/skill-icons');
const bundledFiles = (await readdir(assetDirectory)).filter(file => file.endsWith('.png')).sort();

assert.equal(provenance.sourceCommit, catalog.source.commit);
assert.equal(provenance.files.length, expectedFiles.size);
assert.deepEqual(bundledFiles, [...expectedFiles].sort(), 'skill icon directory contains missing or unreferenced PNG files');
for (const entry of provenance.files) {
  assert(expectedFiles.has(entry.file), `catalog no longer references ${entry.file}`);
  assert(!entry.file.includes('/') && entry.file.endsWith('.png'), `unsafe icon path: ${entry.file}`);
  const bytes = await readFile(path.join(assetDirectory, entry.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${entry.file} hash changed`);
}

process.stdout.write(`Verified ${expectedFiles.size} pinned skill icon assets.\n`);
