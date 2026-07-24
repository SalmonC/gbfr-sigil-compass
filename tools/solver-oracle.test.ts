import assert from 'node:assert/strict';
import { solveBuild, solveBuildWithFallback } from '../desktop/src/domain/solver.ts';
import { solveBuildMilp } from '../desktop/src/domain/solver-milp.ts';
import { factorGroupKey } from '../desktop/src/domain/inventory-groups.ts';
import type { BuildProfile, CatalogData, SolverRequest, SolverResult } from '../desktop/src/domain/models.ts';
import type { LogicalSigil } from '../desktop/src/shared/contracts.ts';

type OracleResult = Pick<SolverResult,
  'signature' | 'primaryMatched' | 'exactPrimaryCoverage' | 'basicSubstitutionUsage' |
  'optionalMatched' | 'optionalCoverage' | 'avoidOccurrences' | 'usedSlots' |
  'levelSum' | 'tieA' | 'tieB'>;
type OracleCandidate = OracleResult & { readonly equivalenceKey: string };

const hashText = (value: number) => `0x${value.toString(16).padStart(8, '0')}`;
const trait = (id: string, hash: number) => ({
  id, hash: hashText(hash), nameZh: id, nameEn: id, category: 'BasicStats',
  canPrimary: true, canSecondary: true, maxLevel: 15
});
const sigil = (id: number, primary: number, secondary: number, level = 15): LogicalSigil => ({
  groupKey: factorGroupKey({
    primaryTraitHash: primary,
    secondaryTraitHash: secondary,
    sigilLevel: level
  }),
  stockOrdinal: id,
  sigilLevel: level,
  primaryTraitHash: primary,
  secondaryTraitHash: secondary
});
const baseProfile = (patch: Partial<BuildProfile>): BuildProfile => ({
  schemaVersion: 3, catalogVersion: 'oracle', name: 'oracle', mandatory: [], basicPrimary: [],
  forceBasicPrimary: false, allowBasicSubstitution: false,
  basicSubstitutionOrder: [], attackPrimary: [], forceAttackPrimary: false,
  defensePrimary: [], forceDefensePrimary: false,
  optional: [], forbidden: [], avoid: [], ...patch
});
const catalogFor = (count: number): CatalogData => ({
  schemaVersion: 1, catalogVersion: 'oracle', gameVersion: 'oracle', categories: [],
  traits: Array.from({ length: count }, (_, index) => trait(`S${index + 1}`, index + 1))
});

function coefficient(value: string, seed: number, salt: number): number {
  let hash = (2166136261 ^ seed ^ salt) >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 1_000_003;
}

function compareBool(left: readonly boolean[], right: readonly boolean[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index] ? -1 : 1;
  }
  return 0;
}

function compareNumbers(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function compareOracle(left: OracleResult, right: OracleResult, force: boolean): number {
  if (force && left.primaryMatched !== right.primaryMatched) return right.primaryMatched - left.primaryMatched;
  if (force) {
    const exact = compareBool(left.exactPrimaryCoverage, right.exactPrimaryCoverage);
    if (exact) return exact;
    const substitution = compareNumbers(left.basicSubstitutionUsage, right.basicSubstitutionUsage);
    if (substitution) return substitution;
  }
  return right.optionalMatched - left.optionalMatched
    || left.avoidOccurrences - right.avoidOccurrences
    || compareBool(left.optionalCoverage, right.optionalCoverage)
    || left.usedSlots - right.usedSlots
    || right.levelSum - left.levelSum
    || left.tieA - right.tieA
    || left.tieB - right.tieB
    || left.signature.localeCompare(right.signature);
}

function bruteForce(request: SolverRequest): OracleResult[] {
  const byId = new Map(request.catalog.traits.map(item => [item.id, Number.parseInt(item.hash.slice(2), 16) >>> 0]));
  const hashes = (ids: readonly string[]) => ids.map(id => byId.get(id)!);
  const mandatory = hashes(request.profile.mandatory);
  const optional = hashes(request.profile.optional);
  const basic = hashes(request.profile.basicPrimary);
  const attack = hashes(request.profile.attackPrimary);
  const defense = hashes(request.profile.defensePrimary);
  const substitutions = hashes(request.profile.basicSubstitutionOrder);
  const forbidden = new Set(hashes(request.profile.forbidden));
  const avoid = new Set(hashes(request.profile.avoid));
  const equivalenceTargets = new Set(hashes([
    ...request.profile.mandatory,
    ...request.profile.basicPrimary,
    ...request.profile.attackPrimary,
    ...request.profile.defensePrimary,
    ...request.profile.optional
  ]));
  const forceBasic = request.profile.forceBasicPrimary;
  const forceAttack = request.profile.forceAttackPrimary;
  const forceDefense = request.profile.forceDefensePrimary;
  const allowSubstitution = forceBasic && request.profile.allowBasicSubstitution;
  const primaryTargets = [
    ...(forceBasic ? basic : []),
    ...(forceAttack ? attack : []),
    ...(forceDefense ? defense : [])
  ];
  const effectiveOptional = [
    ...optional,
    ...(!forceBasic ? basic : []),
    ...(!forceAttack ? attack : []),
    ...(!forceDefense ? defense : [])
  ];
  const force = primaryTargets.length > 0;
  const relevant = new Set([...mandatory, ...effectiveOptional, ...primaryTargets,
    ...(allowSubstitution ? substitutions : [])]);

  const grouped = new Map<string, LogicalSigil[]>();
  for (const item of request.inventory) {
    const primary = item.primaryTraitHash >>> 0;
    const secondary = item.secondaryTraitHash >>> 0;
    if (forbidden.has(primary) || forbidden.has(secondary)) continue;
    if (!relevant.has(primary) && !relevant.has(secondary)) continue;
    const secondaryRole = equivalenceTargets.has(secondary)
      ? secondary.toString(16).padStart(8, '0')
      : avoid.has(secondary) ? '*avoid' : '*';
    const key = `${primary.toString(16).padStart(8, '0')}:${secondaryRole}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }
  const groups = [...grouped].map(([key, instances]) => ({
    key,
    primary: instances[0]!.primaryTraitHash >>> 0,
    secondary: instances[0]!.secondaryTraitHash >>> 0,
    instances: [...instances].sort((a, b) =>
      b.sigilLevel - a.sigilLevel || a.stockOrdinal - b.stockOrdinal)
  })).sort((a, b) => a.key.localeCompare(b.key));

  const requirements = (values: readonly number[]) => {
    const result = new Map<number, number>();
    for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
    return result;
  };
  const mandatoryRequirements = requirements(mandatory);
  const results: OracleCandidate[] = [];

  const visit = (index: number, remainingSlots: number, chosen: number[]): void => {
    if (index < groups.length) {
      const group = groups[index]!;
      for (let count = 0; count <= Math.min(remainingSlots, group.instances.length); count++) {
        chosen.push(count);
        visit(index + 1, remainingSlots - count, chosen);
        chosen.pop();
      }
      return;
    }
    const usedSlots = chosen.reduce((sum, count) => sum + count, 0);
    if (!usedSlots) return;
    const total = new Map<number, number>();
    const primary = new Map<number, number>();
    let avoidOccurrences = 0;
    let levelSum = 0;
    let tieA = 0;
    let tieB = 0;
    const signatureParts: string[] = [];
    const selectedInstances: LogicalSigil[] = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const count = chosen[groupIndex]!;
      if (!count) continue;
      const group = groups[groupIndex]!;
      const chosenInstances = group.instances.slice(0, count);
      selectedInstances.push(...chosenInstances);
      for (const item of chosenInstances) {
        const primaryHash = item.primaryTraitHash >>> 0;
        const secondaryHash = item.secondaryTraitHash >>> 0;
        total.set(primaryHash, (total.get(primaryHash) ?? 0) + 1);
        total.set(secondaryHash, (total.get(secondaryHash) ?? 0) + 1);
        primary.set(primaryHash, (primary.get(primaryHash) ?? 0) + 1);
        avoidOccurrences += Number(avoid.has(primaryHash)) + Number(avoid.has(secondaryHash));
        levelSum += item.sigilLevel;
      }
      tieA += coefficient(group.key, request.runSeed, 0x9e3779b9) * count;
      tieB += coefficient(group.key, request.runSeed, 0x85ebca6b) * count;
      signatureParts.push(`${group.key}*${count}`);
    }
    if ([...mandatoryRequirements].some(([hash, count]) => (total.get(hash) ?? 0) < count)) return;

    for (const [hash, count] of mandatoryRequirements) {
      const totalCount = total.get(hash) ?? 0;
      const primaryCount = primary.get(hash) ?? 0;
      const secondaryCount = totalCount - primaryCount;
      total.set(hash, totalCount - count);
      primary.set(hash, Math.max(0, primaryCount - Math.max(0, count - secondaryCount)));
    }
    const exactPrimaryCoverage: boolean[] = [];
    const basicSubstitutionUsage = substitutions.map(() => 0);
    let primaryMatched = 0;
    if (force) {
      for (const hash of primaryTargets) {
        const available = primary.get(hash) ?? 0;
        const matched = available > 0;
        exactPrimaryCoverage.push(matched);
        if (matched) {
          primaryMatched++;
          primary.set(hash, available - 1);
          total.set(hash, (total.get(hash) ?? 0) - 1);
        }
      }
      if (allowSubstitution) {
        let missing = exactPrimaryCoverage.slice(0, basic.length).filter(value => !value).length;
        for (let subIndex = 0; subIndex < substitutions.length && missing > 0; subIndex++) {
          const hash = substitutions[subIndex]!;
          const used = Math.min(missing, primary.get(hash) ?? 0);
          basicSubstitutionUsage[subIndex] = used;
          primaryMatched += used;
          missing -= used;
          primary.set(hash, (primary.get(hash) ?? 0) - used);
          total.set(hash, (total.get(hash) ?? 0) - used);
        }
      }
    }
    const optionalCoverage = effectiveOptional.map(hash => {
      const available = total.get(hash) ?? 0;
      if (available <= 0) return false;
      total.set(hash, available - 1);
      return true;
    });
    const coverageKey = [
      primaryMatched,
      exactPrimaryCoverage.map(Number).join(''),
      basicSubstitutionUsage.join(','),
      optionalCoverage.map(Number).join('')
    ].join('/');
    const positionKey = selectedInstances.map(item => {
      const primaryHash = (item.primaryTraitHash >>> 0).toString(16).padStart(8, '0');
      const secondaryHash = item.secondaryTraitHash >>> 0;
      return `${primaryHash}:${equivalenceTargets.has(secondaryHash)
        ? secondaryHash.toString(16).padStart(8, '0')
        : '*'}`;
    }).sort().join('|');
    results.push({
      signature: signatureParts.join('|'), primaryMatched, exactPrimaryCoverage,
      basicSubstitutionUsage: allowSubstitution ? basicSubstitutionUsage : [],
      optionalMatched: optionalCoverage.filter(Boolean).length, optionalCoverage,
      avoidOccurrences, usedSlots, levelSum, tieA, tieB,
      equivalenceKey: `${coverageKey}/${positionKey}`
    });
  };
  visit(0, request.maxSlots, []);
  const seen = new Set<string>();
  return results.sort((a, b) => compareOracle(a, b, force))
    .filter(result => {
      if (seen.has(result.equivalenceKey)) return false;
      seen.add(result.equivalenceKey);
      return true;
    })
    .slice(0, Math.min(10, Math.max(1, request.resultLimit)))
    .map(({ equivalenceKey: _equivalenceKey, ...result }) => result);
}

function verify(request: SolverRequest, label: string): void {
  const actual = solveBuild(request).results.map(result => ({
    signature: result.signature,
    primaryMatched: result.primaryMatched,
    exactPrimaryCoverage: result.exactPrimaryCoverage,
    basicSubstitutionUsage: result.basicSubstitutionUsage,
    optionalMatched: result.optionalMatched,
    optionalCoverage: result.optionalCoverage,
    avoidOccurrences: result.avoidOccurrences,
    usedSlots: result.usedSlots,
    levelSum: result.levelSum,
    tieA: result.tieA,
    tieB: result.tieB
  }));
  assert.deepEqual(actual, bruteForce(request), label);
}

const makeRequest = (
  profile: Partial<BuildProfile>, inventory: LogicalSigil[],
  options: { slots?: number; seed?: number; limit?: number; catalogSize?: number } = {}
): SolverRequest => ({
  profile: baseProfile(profile), catalog: catalogFor(options.catalogSize ?? 8), inventory,
  maxSlots: options.slots ?? 2, resultLimit: options.limit ?? 10, runSeed: options.seed ?? 0
});

async function verifyFallback(request: SolverRequest, label: string): Promise<void> {
  const actual = (await solveBuildMilp(request, Date.now(), 30_000)).results.map(result => ({
    signature: result.signature,
    primaryMatched: result.primaryMatched,
    exactPrimaryCoverage: result.exactPrimaryCoverage,
    basicSubstitutionUsage: result.basicSubstitutionUsage,
    optionalMatched: result.optionalMatched,
    optionalCoverage: result.optionalCoverage,
    avoidOccurrences: result.avoidOccurrences,
    usedSlots: result.usedSlots,
    levelSum: result.levelSum,
    tieA: result.tieA,
    tieB: result.tieB
  }));
  assert.deepEqual(actual, bruteForce(request), label);
}

verify(makeRequest(
  { mandatory: ['S7', 'S8'] },
  [...Array.from({ length: 11 }, (_, index) => sigil(index + 1, index + 20, 7)), sigil(99, 99, 8)],
  { slots: 2, catalogSize: 8 }
), 'Top-10 additive tie regression');

verify(makeRequest(
  { optional: ['S2'], basicPrimary: ['S1'], forceBasicPrimary: false },
  [sigil(1, 1, 6), sigil(2, 2, 7)]
), 'disabled basic-primary appends to optional');

verify(makeRequest(
  { basicPrimary: ['S1', 'S2', 'S3'], forceBasicPrimary: true },
  [sigil(1, 1, 6), sigil(2, 2, 7), sigil(3, 3, 8)], { seed: 1 }
), 'ordered exact-primary coverage');

verify(makeRequest(
  { basicPrimary: ['S1'], forceBasicPrimary: true, allowBasicSubstitution: true,
    basicSubstitutionOrder: ['S2', 'S3'] },
  [sigil(1, 2, 6), sigil(2, 3, 7)], { slots: 1 }
), 'ordered substitution pool');

verify(makeRequest(
  { mandatory: ['S2'], basicPrimary: ['S1'], forceBasicPrimary: true,
    allowBasicSubstitution: true, basicSubstitutionOrder: ['S2'] },
  [sigil(1, 2, 6)], { slots: 1 }
), 'mandatory consumes token before substitution');

verify(makeRequest(
  {
    basicPrimary: ['S1'], forceBasicPrimary: true,
    attackPrimary: ['S2'], forceAttackPrimary: true,
    defensePrimary: ['S3'], forceDefensePrimary: true
  },
  [sigil(1, 1, 6), sigil(2, 2, 7), sigil(3, 3, 8)], { slots: 2 }
), 'basic attack and defense primary targets share one ordered allocation');

await verifyFallback(makeRequest(
  {
    mandatory: ['S1'], optional: ['S2', 'S3', 'S2'],
    basicPrimary: ['S4', 'S5'], forceBasicPrimary: true,
    allowBasicSubstitution: true, basicSubstitutionOrder: ['S2', 'S3'],
    avoid: ['S6']
  },
  [
    sigil(1, 1, 2, 15), sigil(2, 4, 3, 14), sigil(3, 2, 5, 13),
    sigil(4, 6, 2, 12), sigil(5, 3, 1, 11)
  ],
  { slots: 3, seed: 27, limit: 3 }
), 'MILP fallback must preserve the complete lexicographic ranking');

const multisetResult = solveBuild(makeRequest(
  { mandatory: ['S1'], optional: ['S1'], avoid: ['S1'], forbidden: ['S3'] },
  [sigil(1, 1, 1), sigil(2, 1, 3)], { slots: 1 }
)).results[0]!;
assert.equal(multisetResult.optionalMatched, 1, 'A&A must provide two independently consumed tokens');
assert.equal(multisetResult.avoidOccurrences, 2, 'A&A must count two avoid occurrences');
assert.ok(multisetResult.selected.every(item => item.secondaryTraitHash !== 3), 'forbidden factors must be absent');

const identityResult = solveBuild(makeRequest(
  { mandatory: ['S1', 'S2'] },
  [sigil(1, 1, 2, 11), sigil(2, 1, 2, 15), sigil(3, 2, 1, 13)], { slots: 1 }
)).results;
assert.equal(identityResult.length, 2, 'A&B and B&A are different logical schemes');
assert.equal(identityResult.find(item => item.signature.startsWith('00000001:00000002'))?.selected[0]?.sigilLevel,
  15, 'same logical scheme must use its highest-level inventory instance');

const wideInventory: LogicalSigil[] = [];
let wideId = 1;
for (let primary = 1; primary <= 24; primary++) {
  for (let secondary = 1; secondary <= 24; secondary++) {
    if (primary !== secondary) wideInventory.push(sigil(wideId++, primary, secondary));
  }
}
const wideResult = await solveBuildWithFallback({
  ...makeRequest(
    { optional: Array.from({ length: 24 }, (_, index) => `S${index + 1}`) },
    wideInventory,
    { slots: 12, catalogSize: 24 }),
  timeLimitMs: 120_000,
  memoryLimitMiB: 128
});
assert.equal(wideResult.status, 'completed',
  'wide legal inputs must fall back to the low-memory exact solver');
assert.equal(wideResult.results[0]?.optionalMatched, 24,
  'fallback must find full coverage for the 24-target stress case');

let randomState = 0x62e2ac15;
const random = (limit: number) => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) % limit;
};
for (let iteration = 0; iteration < 120; iteration++) {
  const force = random(2) === 1;
  const mandatory = [`S${1 + random(5)}`];
  const optional = Array.from({ length: random(4) }, () => `S${1 + random(5)}`);
  const basic = Array.from({ length: random(3) }, () => `S${1 + random(3)}`);
  const substitutions = force && random(2) === 1
    ? [...new Set(Array.from({ length: 1 + random(3) }, () => `S${1 + random(3)}`))]
    : [];
  const inventory = Array.from({ length: 3 + random(4) }, (_, index) =>
    sigil(index + 1, 1 + random(8), 1 + random(8), 11 + random(5)));
  verify(makeRequest({
    mandatory, optional, basicPrimary: basic, forceBasicPrimary: force,
    allowBasicSubstitution: substitutions.length > 0, basicSubstitutionOrder: substitutions,
    avoid: random(3) === 0 ? [`S${1 + random(8)}`] : [],
    forbidden: random(5) === 0 ? [`S${1 + random(8)}`] : []
  }, inventory, { slots: 1 + random(3), seed: random(10_000) }), `random oracle ${iteration}`);
}

console.log('Solver oracle passed: 7 P0 regressions, multiset/identity checks, and 120 exhaustive randomized cases.');
