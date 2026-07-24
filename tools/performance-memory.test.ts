import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { promisify } from 'node:util';
import { solveBuild, solveBuildWithFallback } from '../desktop/src/domain/solver.ts';
import { aggregateRawInventory, expandStocks } from '../desktop/src/domain/inventory-groups.ts';
import type { BuildProfile, CatalogData, SolverAnalysis } from '../desktop/src/domain/models.ts';
import type { RawSigil } from '../desktop/src/shared/contracts.ts';

if (!global.gc) throw new Error('Run this audit with --expose-gc.');

const projectRoot = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(
  await readFile(path.join(projectRoot, 'data/catalog/catalog.zh-CN.json'), 'utf8')) as CatalogData;
const profile = JSON.parse(
  await readFile(path.join(projectRoot, 'data/fixtures/screenshot-profile.json'), 'utf8')) as BuildProfile;
const savePath = process.env.GBFR_TEST_SAVE;
if (!savePath) throw new Error('Set GBFR_TEST_SAVE to a local SaveData*.dat test fixture.');
const workerDll = path.join(
  projectRoot, 'src/GBFRTool.SaveReader.Worker/bin/Release/net10.0/GBFRTool.SaveReader.Worker.dll');
const { stdout } = await promisify(execFile)('dotnet', [workerDll, '--parse', savePath], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, DOTNET_ROLL_FORWARD: 'Major' }
});
const rawInventory = (JSON.parse(stdout) as { sigils: RawSigil[] }).sigils;
const aggregationStarted = performance.now();
const inventory = expandStocks(aggregateRawInventory(rawInventory));
const aggregationMs = performance.now() - aggregationStarted;
assert.equal(inventory.length, 401);

function run(seed: number): SolverAnalysis {
  return solveBuild({ profile, catalog, inventory, maxSlots: 12, resultLimit: 10, runSeed: seed });
}

run(1);
run(2);
global.gc();

const samples: Array<{ elapsedMs: number; heapUsed: number; rss: number }> = [];
let last: SolverAnalysis | null = null;
for (let index = 0; index < 15; index++) {
  const started = performance.now();
  last = run(20260723 + index);
  const elapsedMs = performance.now() - started;
  global.gc();
  const memory = process.memoryUsage();
  samples.push({ elapsedMs, heapUsed: memory.heapUsed, rss: memory.rss });
}
assert.equal(last?.status, 'completed');
assert.equal(last.results.length, 10);

const times = samples.map(sample => sample.elapsedMs).sort((left, right) => left - right);
const firstHeap = samples[0]!.heapUsed;
const lastHeap = samples.at(-1)!.heapUsed;
const heapGrowth = lastHeap - firstHeap;
const maxHeap = Math.max(...samples.map(sample => sample.heapUsed));
const maxRss = Math.max(...samples.map(sample => sample.rss));
const report = {
  iterations: samples.length,
  inventoryCount: inventory.length,
  aggregationMs: Number(aggregationMs.toFixed(3)),
  exploredStateCount: last.exploredStateCount,
  p50Ms: Math.round(times[Math.floor(times.length * 0.5)]!),
  p95Ms: Math.round(times[Math.floor(times.length * 0.95)]!),
  maxMs: Math.round(times.at(-1)!),
  firstHeapMiB: Number((firstHeap / 1024 / 1024).toFixed(1)),
  lastHeapMiB: Number((lastHeap / 1024 / 1024).toFixed(1)),
  heapGrowthMiB: Number((heapGrowth / 1024 / 1024).toFixed(1)),
  maxHeapMiB: Number((maxHeap / 1024 / 1024).toFixed(1)),
  maxRssMiB: Number((maxRss / 1024 / 1024).toFixed(1))
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

assert.ok(report.p95Ms < 2_000, `p95 solve time exceeded 2 seconds: ${report.p95Ms} ms`);
assert.ok(aggregationMs < 100, `inventory aggregation exceeded 100 ms: ${aggregationMs} ms`);
assert.ok(heapGrowth < 8 * 1024 * 1024, `post-GC heap grew by ${report.heapGrowthMiB} MiB`);

const traitIdByHash = new Map(catalog.traits.map(trait => [
  Number.parseInt(trait.hash.slice(2), 16) >>> 0,
  trait.id
]));
const frequency = new Map<number, number>();
for (const sigil of inventory) {
  for (const hash of [sigil.primaryTraitHash >>> 0, sigil.secondaryTraitHash >>> 0]) {
    if (traitIdByHash.has(hash)) frequency.set(hash, (frequency.get(hash) ?? 0) + 1);
  }
}
const wideOptional = [...frequency]
  .sort((left, right) => right[1] - left[1])
  .slice(0, 24)
  .map(([hash]) => traitIdByHash.get(hash)!);
assert.equal(wideOptional.length, 24);
const wideProfile: BuildProfile = {
  ...profile,
  name: '24 项资源上限回归',
  mandatory: [],
  basicPrimary: [],
  forceBasicPrimary: false,
  allowBasicSubstitution: false,
  basicSubstitutionOrder: [],
  attackPrimary: [],
  forceAttackPrimary: false,
  defensePrimary: [],
  forceDefensePrimary: false,
  optional: wideOptional,
  forbidden: [],
  avoid: []
};
const wideStarted = performance.now();
const wideAnalysis = await solveBuildWithFallback({
    profile: wideProfile,
    catalog,
    inventory,
    maxSlots: 12,
    resultLimit: 10,
    runSeed: 20260723,
    timeLimitMs: 120_000,
    memoryLimitMiB: 128
  });
assert.equal(wideAnalysis.status, 'completed');
const wideElapsedMs = performance.now() - wideStarted;
global.gc();
const wideMemory = process.memoryUsage();
const wideReport = {
  elapsedMs: Math.round(wideElapsedMs),
  heapMiB: Number((wideMemory.heapUsed / 1024 / 1024).toFixed(1)),
  rssMiB: Number((wideMemory.rss / 1024 / 1024).toFixed(1))
};
process.stdout.write(`${JSON.stringify({ wideProfileSafety: wideReport }, null, 2)}\n`);
assert.ok(wideElapsedMs < 120_000, `wide profile exceeded fallback window: ${wideElapsedMs} ms`);
