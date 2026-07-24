import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { promisify } from 'node:util';
import { decodeProfile } from '../desktop/src/domain/profile-codec.ts';
import { solveBuildWithFallback } from '../desktop/src/domain/solver.ts';
import { aggregateRawInventory, expandStocks } from '../desktop/src/domain/inventory-groups.ts';
import type { CatalogData, SolverAnalysis } from '../desktop/src/domain/models.ts';
import type { RawSigil } from '../desktop/src/shared/contracts.ts';

const projectRoot = path.resolve(import.meta.dirname, '..');
const savePath = process.env.GBFR_TEST_SAVE;
const profilePath = process.env.GBFR_TEST_PROFILE;
if (!savePath || !profilePath) {
  throw new Error('Set GBFR_TEST_SAVE and GBFR_TEST_PROFILE.');
}

const catalog = JSON.parse(
  await readFile(path.join(projectRoot, 'data/catalog/catalog.zh-CN.json'), 'utf8')) as CatalogData;
const profile = decodeProfile((await readFile(profilePath, 'utf8')).trim(), catalog);
const workerDll = path.join(
  projectRoot, 'src/GBFRTool.SaveReader.Worker/bin/Release/net10.0/GBFRTool.SaveReader.Worker.dll');
const { stdout } = await promisify(execFile)('dotnet', [workerDll, '--parse', savePath], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, DOTNET_ROLL_FORWARD: 'Major' }
});
const inventory = expandStocks(aggregateRawInventory(
  (JSON.parse(stdout) as { sigils: RawSigil[] }).sigils));
const traitHash = new Map(catalog.traits.map(trait => [
  trait.id,
  Number.parseInt(trait.hash.slice(2), 16) >>> 0
]));
const hashes = (ids: readonly string[]) => ids.map(id => traitHash.get(id)!);
const primaryTargets = profile.forceBasicPrimary ? hashes(profile.basicPrimary) : [];
const relevantHashes = new Set([
  ...hashes(profile.mandatory),
  ...hashes(profile.optional),
  ...primaryTargets
]);
const primaryRelevant = new Set(primaryTargets);
const exactGroups = new Map<string, (typeof inventory)[number][]>();
for (const sigil of inventory) {
  const primary = sigil.primaryTraitHash >>> 0;
  const secondary = sigil.secondaryTraitHash >>> 0;
  if (!relevantHashes.has(primary) && !relevantHashes.has(secondary)) continue;
  const key = `${primary.toString(16)}:${secondary.toString(16)}`;
  const items = exactGroups.get(key) ?? [];
  items.push(sigil);
  exactGroups.set(key, items);
}
const contributionClasses = new Set([...exactGroups.values()].map(items => {
  const first = items[0]!;
  const total = [first.primaryTraitHash >>> 0, first.secondaryTraitHash >>> 0]
    .filter(hash => relevantHashes.has(hash)).sort((left, right) => left - right);
  const primary = primaryRelevant.has(first.primaryTraitHash >>> 0)
    ? first.primaryTraitHash >>> 0
    : 0;
  return `${total.join(',')}/${primary}`;
}));

const started = performance.now();
let error: string | null = null;
let result: SolverAnalysis | null = null;
try {
  if (process.env.GBFR_BENCHMARK_STATS_ONLY === '1') throw new Error('benchmark.stats_only');
  result = await solveBuildWithFallback({
    profile,
    catalog,
    inventory,
    maxSlots: 12,
    resultLimit: 10,
    runSeed: 20260723,
    timeLimitMs: 600_000,
    memoryLimitMiB: Number.parseInt(process.env.GBFR_BENCHMARK_MEMORY_MIB ?? '512', 10)
  });
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}
const memory = process.memoryUsage();
process.stdout.write(`${JSON.stringify({
  inventoryCount: inventory.length,
  exactGroupCount: exactGroups.size,
  contributionClassCount: contributionClasses.size,
  elapsedMs: Math.round(performance.now() - started),
  heapMiB: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
  rssMiB: Number((memory.rss / 1024 / 1024).toFixed(1)),
  externalMiB: Number((memory.external / 1024 / 1024).toFixed(1)),
  arrayBuffersMiB: Number((memory.arrayBuffers / 1024 / 1024).toFixed(1)),
  error,
  status: result?.status,
  resultCount: result?.results.length,
  candidateTypeCount: result?.candidateTypeCount,
  exploredStateCount: result?.exploredStateCount,
  results: result?.results.map(item => ({
    signature: item.signature,
    primaryMatched: item.primaryMatched,
    optionalMatched: item.optionalMatched,
    optionalCoverage: item.optionalCoverage,
    avoidOccurrences: item.avoidOccurrences,
    usedSlots: item.usedSlots,
    levelSum: item.levelSum
  })),
  firstResult: result?.results[0] && {
    signature: result.results[0].signature,
    primaryMatched: result.results[0].primaryMatched,
    optionalMatched: result.results[0].optionalMatched,
    usedSlots: result.results[0].usedSlots,
    levelSum: result.results[0].levelSum
  }
}, null, 2)}\n`);
