import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { promisify } from 'node:util';
import { solveBuild } from '../desktop/src/domain/solver.ts';
import { aggregateRawInventory, expandStocks } from '../desktop/src/domain/inventory-groups.ts';
import type { BuildProfile, CatalogData } from '../desktop/src/domain/models.ts';
import type { RawSigil } from '../desktop/src/shared/contracts.ts';

const catalog = JSON.parse(await readFile('data/catalog/catalog.zh-CN.json', 'utf8')) as CatalogData;
const profile = JSON.parse(await readFile('data/fixtures/screenshot-profile.json', 'utf8')) as BuildProfile;
const savePath = process.env.GBFR_TEST_SAVE;
if (!savePath) throw new Error('Set GBFR_TEST_SAVE to a local SaveData*.dat test fixture.');
const workerDll = path.resolve('src/GBFRTool.SaveReader.Worker/bin/Release/net10.0/GBFRTool.SaveReader.Worker.dll');
const { stdout } = await promisify(execFile)('dotnet', [workerDll, '--parse', savePath], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, DOTNET_ROLL_FORWARD: 'Major' }
});
const parsed = JSON.parse(stdout) as {
  sigils: Array<{
    gemUnitId: number; inventorySlotId: number; sigilHash: number; sigilLevel: number;
    primaryTraitHash: number; primaryLevel: number; secondaryTraitHash: number;
    secondaryLevel: number; flags: number; wornByCharacterId: string | null;
  }>;
};
const inventory = expandStocks(aggregateRawInventory(parsed.sigils as RawSigil[]));

assert(profile.name === '欧羽尼高手-截图前16项', 'fixture name changed');
assert(JSON.stringify(profile.mandatory) === JSON.stringify([
  'HASH_A7726190', 'HASH_9232DC17', 'HASH_73220725', 'HASH_A898E283', 'HASH_D029FE08',
  'SKILL_020_00', 'SKILL_020_00', 'SKILL_020_00'
]), 'first eight mandatory targets no longer match the screenshot');
assert(JSON.stringify(profile.optional) === JSON.stringify([
  'SKILL_020_00', 'SKILL_233_00', 'SKILL_234_00', 'SKILL_151_00',
  'SKILL_151_00', 'SKILL_151_00', 'SKILL_064_00', 'SKILL_146_00'
]), 'remaining screenshot targets changed');
assert(JSON.stringify(profile.basicPrimary) === JSON.stringify([
  'SKILL_004_00', 'SKILL_004_00', 'SKILL_004_00', 'SKILL_001_00', 'SKILL_001_00'
]), 'basic-primary fixture changed');
assert(JSON.stringify(profile.forbidden) === JSON.stringify(['SKILL_158_00', 'SKILL_154_00']), 'forbidden fixture changed');
assert(profile.avoid.length === 3 && profile.avoid.every(id =>
  catalog.traits.find(trait => trait.id === id)?.category === 'defense'), 'avoid fixture must contain three defense skills');
assert(profile.forceBasicPrimary && !profile.allowBasicSubstitution, 'basic-primary switches changed');
assert(inventory.length === 401, `expected 401 V+ sigils, got ${inventory.length}`);

const started = performance.now();
const analysis = solveBuild({ profile, catalog, inventory, maxSlots: 12, resultLimit: 10, runSeed: 20260722 });
const elapsedMs = Math.round(performance.now() - started);
console.log(JSON.stringify({
  status: analysis.status,
  resultCount: analysis.results.length,
  candidateTypeCount: analysis.candidateTypeCount,
  exploredStateCount: analysis.exploredStateCount,
  elapsedMs,
  results: analysis.results.map(result => ({
    mandatorySatisfied: result.mandatorySatisfied,
    primary: `${result.primaryMatched}/${result.primaryRequired}`,
    exactPrimaryMatched: result.exactPrimaryCoverage.filter(Boolean).length,
    optionalMatched: result.optionalMatched,
    optionalCoverage: result.optionalCoverage,
    avoidOccurrences: result.avoidOccurrences,
    usedSlots: result.usedSlots,
    levelSum: result.levelSum,
    sigils: result.selected.map(sigil => [sigil.primaryTraitHash, sigil.secondaryTraitHash])
  }))
}, null, 2));

if (analysis.status !== 'completed' || analysis.results.length === 0) process.exitCode = 1;
if (analysis.results.some(result => !result.mandatorySatisfied)) process.exitCode = 2;
if (analysis.results.length !== 10) process.exitCode = 3;
if (analysis.results[0]?.primaryMatched !== 1 || analysis.results[0]?.primaryRequired !== 5) process.exitCode = 4;
if (analysis.results[0]?.optionalMatched !== 3) process.exitCode = 5;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
