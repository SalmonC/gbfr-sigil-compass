import type { RawSigil } from '../shared/contracts';
import type { SolverAnalysis, SolverRequest, SolverResult } from './models';
import {
  dedupeEquivalentResults, searchFactorGroupKey, targetTraitHashes
} from './result-equivalence.ts';

interface FactorGroup {
  readonly primary: number;
  readonly secondary: number;
  readonly instances: readonly RawSigil[];
  readonly key: string;
  readonly tieA: number;
  readonly tieB: number;
}

interface Variant {
  readonly totalCounts: Uint8Array;
  readonly primaryCounts: Uint8Array;
  readonly usedSlots: number;
  readonly avoidOccurrences: number;
  readonly levelSum: number;
  readonly tieA: number;
  readonly tieB: number;
  readonly selections: SelectionNode | null;
}

interface SelectionNode {
  readonly previous: SelectionNode | null;
  readonly group: FactorGroup;
  readonly count: number;
}

interface FactorChoice {
  readonly count: number;
  readonly avoidOccurrences: number;
  readonly levelSum: number;
  readonly tieA: number;
  readonly tieB: number;
  readonly entries: readonly [FactorGroup, number][];
}

interface FactorClass {
  readonly key: string;
  readonly totalIndexes: readonly number[];
  readonly primaryIndex: number | null;
  readonly availableCount: number;
  readonly choices: readonly FactorChoice[];
}

interface EvaluatedCoverage {
  readonly mandatorySatisfied: boolean;
  readonly primaryMatched: number;
  readonly exactPrimaryCoverage: readonly boolean[];
  readonly basicSubstitutionUsage: readonly number[];
  readonly optionalCoverage: readonly boolean[];
}

const DEFAULT_SOLVE_MILLISECONDS = 30_000;
const MIN_SOLVE_MILLISECONDS = 5_000;
const MAX_SOLVE_MILLISECONDS = 600_000;
const DEFAULT_MEMORY_LIMIT_MIB = 512;
const MIN_MEMORY_LIMIT_MIB = 128;
const MAX_MEMORY_LIMIT_MIB = 2_048;
// Conservative retained-memory estimates for the packed state map. Temporary
// allocations are additionally bounded by the independent Worker lifetime.
const ESTIMATED_STATE_BYTES = 1_280;
const ESTIMATED_VARIANT_BYTES = 1_920;

function hashNumber(value: string): number {
  return Number.parseInt(value.slice(2), 16) >>> 0;
}

function countItems(values: readonly number[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function stableCoefficient(value: string, seed: number, salt: number): number {
  let hash = (2166136261 ^ seed ^ salt) >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  // Keep the linear sum below Number.MAX_SAFE_INTEGER for every legal build.
  return hash % 1_000_003;
}

function compareAdditiveTail(left: Variant, right: Variant): number {
  return left.avoidOccurrences - right.avoidOccurrences
    || left.usedSlots - right.usedSlots
    || right.levelSum - left.levelSum
    || left.tieA - right.tieA
    || left.tieB - right.tieB;
}

function compareStableTail(left: Variant, right: Variant): number {
  return compareAdditiveTail(left, right);
}

function addVariant(bucket: Variant[], candidate: Variant, limit: number): number {
  const previousLength = bucket.length;
  bucket.push(candidate);
  bucket.sort(compareStableTail);
  if (bucket.length > limit) {
    // Every member of a bucket has identical capped target/primary counts and slot use.
    // A future choice adds the same avoid/level/tie values to every member, so their
    // additive order cannot reverse. Keep all cutoff ties because canonical signature
    // is deliberately not used as an unsafe prefix-pruning key.
    const cutoff = bucket[limit - 1]!;
    const firstStrictlyWorse = bucket.findIndex((item, index) =>
      index >= limit && compareAdditiveTail(item, cutoff) !== 0);
    if (firstStrictlyWorse >= 0) bucket.length = firstStrictlyWorse;
  }
  return bucket.length - previousLength;
}

function compareCandidateTail(
  avoidOccurrences: number,
  usedSlots: number,
  levelSum: number,
  tieA: number,
  tieB: number,
  existing: Variant
): number {
  return avoidOccurrences - existing.avoidOccurrences
    || usedSlots - existing.usedSlots
    || existing.levelSum - levelSum
    || tieA - existing.tieA
    || tieB - existing.tieB;
}

function canEnterBucket(
  bucket: readonly Variant[],
  limit: number,
  avoidOccurrences: number,
  usedSlots: number,
  levelSum: number,
  tieA: number,
  tieB: number
): boolean {
  if (bucket.length < limit) return true;
  return compareCandidateTail(
    avoidOccurrences, usedSlots, levelSum, tieA, tieB, bucket[limit - 1]!) <= 0;
}

function selectionEntries(node: SelectionNode | null): [FactorGroup, number][] {
  const entries: [FactorGroup, number][] = [];
  for (let current = node; current; current = current.previous) {
    entries.push([current.group, current.count]);
  }
  entries.reverse();
  return entries;
}

function appendSelections(
  previous: SelectionNode | null,
  entries: readonly [FactorGroup, number][]
): SelectionNode | null {
  let current = previous;
  for (const [group, count] of entries) current = { previous: current, group, count };
  return current;
}

function packedStateKey(
  totalCounts: Uint8Array,
  primaryCounts: Uint8Array,
  usedSlots: number
): string {
  return String.fromCharCode(usedSlots, ...totalCounts, ...primaryCounts);
}

function projectedCount(
  counts: Uint8Array,
  index: number,
  contributionIndexes: readonly number[],
  selectedCount: number,
  cap: number
): number {
  let value = counts[index]!;
  for (const contributionIndex of contributionIndexes) {
    if (contributionIndex === index) value += selectedCount;
  }
  return Math.min(cap, value);
}

function projectedStateKey(
  variant: Variant,
  factorClass: FactorClass,
  selectedCount: number,
  usedSlots: number,
  allCaps: readonly number[],
  primaryCaps: readonly number[]
): string {
  let key = String.fromCharCode(usedSlots);
  for (let index = 0; index < variant.totalCounts.length; index++) {
    key += String.fromCharCode(projectedCount(
      variant.totalCounts, index, factorClass.totalIndexes, selectedCount, allCaps[index]!));
  }
  for (let index = 0; index < variant.primaryCounts.length; index++) {
    const value = factorClass.primaryIndex === index
      ? Math.min(primaryCaps[index]!, variant.primaryCounts[index]! + selectedCount)
      : variant.primaryCounts[index]!;
    key += String.fromCharCode(value);
  }
  return key;
}

function compareChoices(left: FactorChoice, right: FactorChoice): number {
  return left.avoidOccurrences - right.avoidOccurrences
    || left.count - right.count
    || right.levelSum - left.levelSum
    || left.tieA - right.tieA
    || left.tieB - right.tieB;
}

function addChoice(bucket: FactorChoice[], candidate: FactorChoice, limit: number): void {
  bucket.push(candidate);
  bucket.sort(compareChoices);
  if (bucket.length <= limit) return;
  const cutoff = bucket[limit - 1]!;
  const firstStrictlyWorse = bucket.findIndex((item, index) =>
    index >= limit && compareChoices(item, cutoff) !== 0);
  if (firstStrictlyWorse >= 0) bucket.length = firstStrictlyWorse;
}

function buildClassChoices(
  groups: readonly FactorGroup[],
  avoidPerFactor: number,
  maxSlots: number,
  resultLimit: number
): FactorChoice[] {
  let byCount: FactorChoice[][] = Array.from({ length: maxSlots + 1 }, () => []);
  byCount[0] = [{
    count: 0,
    avoidOccurrences: 0,
    levelSum: 0,
    tieA: 0,
    tieB: 0,
    entries: []
  }];
  for (const group of groups) {
    const next: FactorChoice[][] = Array.from({ length: maxSlots + 1 }, () => []);
    for (let previousCount = 0; previousCount <= maxSlots; previousCount++) {
      for (const previous of byCount[previousCount]!) {
        const maxGroupCount = Math.min(group.instances.length, maxSlots - previousCount);
        let runningLevel = 0;
        for (let groupCount = 0; groupCount <= maxGroupCount; groupCount++) {
          if (groupCount > 0) runningLevel += group.instances[groupCount - 1]!.sigilLevel;
          const count = previousCount + groupCount;
          addChoice(next[count]!, {
            count,
            avoidOccurrences: previous.avoidOccurrences + avoidPerFactor * groupCount,
            levelSum: previous.levelSum + runningLevel,
            tieA: previous.tieA + group.tieA * groupCount,
            tieB: previous.tieB + group.tieB * groupCount,
            entries: groupCount === 0
              ? previous.entries
              : [...previous.entries, [group, groupCount]]
          }, resultLimit);
        }
      }
    }
    byCount = next;
  }
  return byCount.flat();
}

function compareBooleanVector(left: readonly boolean[], right: readonly boolean[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index] ? -1 : 1;
  }
  return 0;
}

function compareNumberVectorDescending(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function evaluateCoverage(
  variant: Variant,
  allHashes: readonly number[],
  primaryHashes: readonly number[],
  mandatoryHashes: readonly number[],
  optionalHashes: readonly number[],
  primaryTargetHashes: readonly number[],
  forcedBasicTargetCount: number,
  substitutionHashes: readonly number[],
  allowBasicSubstitution: boolean
): EvaluatedCoverage {
  const total = new Map(allHashes.map((hash, index) => [hash, variant.totalCounts[index]!]));
  const primary = new Map(primaryHashes.map((hash, index) => [hash, variant.primaryCounts[index]!]));
  const mandatoryRequirements = countItems(mandatoryHashes);
  const mandatorySatisfied = [...mandatoryRequirements].every(([hash, count]) => (total.get(hash) ?? 0) >= count);
  if (!mandatorySatisfied) {
    return {
      mandatorySatisfied: false,
      primaryMatched: 0,
      exactPrimaryCoverage: primaryTargetHashes.map(() => false),
      basicSubstitutionUsage: substitutionHashes.map(() => 0),
      optionalCoverage: optionalHashes.map(() => false)
    };
  }

  // Mandatory tokens are allocated first. Prefer secondary occurrences so a primary
  // occurrence remains available for the higher-priority basic-primary assignment.
  for (const [hash, required] of mandatoryRequirements) {
    const totalCount = total.get(hash) ?? 0;
    const primaryCount = primary.get(hash) ?? 0;
    const secondaryCount = totalCount - primaryCount;
    const primaryConsumed = Math.max(0, required - secondaryCount);
    total.set(hash, totalCount - required);
    if (primary.has(hash)) primary.set(hash, Math.max(0, primaryCount - primaryConsumed));
  }

  let exactPrimaryMatched = 0;
  let substituted = 0;
  // Earlier exact positions win. Each primary occurrence can fill only one target,
  // so taking an available exact occurrence cannot reduce the maximum filled count.
  const exactPrimaryCoverage = primaryTargetHashes.map((hash) => {
    const available = primary.get(hash) ?? 0;
    if (available <= 0) return false;
    primary.set(hash, available - 1);
    total.set(hash, (total.get(hash) ?? 0) - 1);
    exactPrimaryMatched++;
    return true;
  });

  const basicSubstitutionUsage = substitutionHashes.map(() => 0);
  if (allowBasicSubstitution) {
    let missing = exactPrimaryCoverage.slice(0, forcedBasicTargetCount).filter(value => !value).length;
    for (let index = 0; index < substitutionHashes.length && missing > 0; index++) {
      const hash = substitutionHashes[index]!;
      const used = Math.min(missing, primary.get(hash) ?? 0);
      basicSubstitutionUsage[index] = used;
      substituted += used;
      missing -= used;
      primary.set(hash, (primary.get(hash) ?? 0) - used);
      total.set(hash, (total.get(hash) ?? 0) - used);
    }
  }

  const optionalCoverage = optionalHashes.map((hash) => {
    const available = total.get(hash) ?? 0;
    if (available <= 0) return false;
    total.set(hash, available - 1);
    return true;
  });

  return {
    mandatorySatisfied,
    primaryMatched: exactPrimaryMatched + substituted,
    exactPrimaryCoverage,
    basicSubstitutionUsage: allowBasicSubstitution ? basicSubstitutionUsage : [],
    optionalCoverage
  };
}

export function solveBuild(request: SolverRequest): SolverAnalysis {
  const startedAt = Date.now();
  let candidateAttemptCount = 0;
  const resultLimit = Math.max(1, Math.min(request.resultLimit, 10));
  const timeLimitMs = Math.max(
    MIN_SOLVE_MILLISECONDS,
    Math.min(request.timeLimitMs ?? DEFAULT_SOLVE_MILLISECONDS, MAX_SOLVE_MILLISECONDS));
  const memoryLimitBytes = Math.max(
    MIN_MEMORY_LIMIT_MIB,
    Math.min(request.memoryLimitMiB ?? DEFAULT_MEMORY_LIMIT_MIB, MAX_MEMORY_LIMIT_MIB))
    * 1024 * 1024;
  if (!Number.isInteger(request.maxSlots) || request.maxSlots < 1 || request.maxSlots > 12) {
    throw new Error('solver.max_slots_invalid');
  }

  const traitById = new Map(request.catalog.traits.map(trait => [trait.id, trait]));
  const idsToHashes = (ids: readonly string[]) => ids.map(id => {
    const trait = traitById.get(id);
    if (!trait) throw new Error(`catalog.skill_missing:${id}`);
    return hashNumber(trait.hash);
  });

  const mandatoryHashes = idsToHashes(request.profile.mandatory);
  const optionalHashes = idsToHashes(request.profile.optional);
  const basicHashes = idsToHashes(request.profile.basicPrimary);
  const attackHashes = idsToHashes(request.profile.attackPrimary);
  const defenseHashes = idsToHashes(request.profile.defensePrimary);
  const substitutionHashes = idsToHashes(request.profile.basicSubstitutionOrder);
  const forbidden = new Set(idsToHashes(request.profile.forbidden));
  const avoid = new Set(idsToHashes(request.profile.avoid));
  const equivalenceTargets = targetTraitHashes(request.profile, request.catalog);
  const forceBasicPrimary = request.profile.forceBasicPrimary;
  const forceAttackPrimary = request.profile.forceAttackPrimary;
  const forceDefensePrimary = request.profile.forceDefensePrimary;
  const allowBasicSubstitution = forceBasicPrimary && request.profile.allowBasicSubstitution;
  const primaryTargetHashes = [
    ...(forceBasicPrimary ? basicHashes : []),
    ...(forceAttackPrimary ? attackHashes : []),
    ...(forceDefensePrimary ? defenseHashes : [])
  ];
  const effectiveOptionalHashes = [
    ...optionalHashes,
    ...(!forceBasicPrimary ? basicHashes : []),
    ...(!forceAttackPrimary ? attackHashes : []),
    ...(!forceDefensePrimary ? defenseHashes : [])
  ];

  const allHashes = [...new Set([
    ...mandatoryHashes,
    ...effectiveOptionalHashes,
    ...primaryTargetHashes,
    ...(allowBasicSubstitution ? substitutionHashes : [])
  ])];
  const allIndex = new Map(allHashes.map((hash, index) => [hash, index]));
  const mandatoryRequirements = countItems(mandatoryHashes);
  const mandatoryEntries = [...mandatoryRequirements].map(([hash, required]) => ({
    index: allIndex.get(hash)!,
    required
  }));
  const optionalRequirements = countItems(effectiveOptionalHashes);
  const primaryRequirements = countItems(primaryTargetHashes);
  const allCaps = allHashes.map(hash => Math.min(request.maxSlots * 2,
    (mandatoryRequirements.get(hash) ?? 0)
      + (optionalRequirements.get(hash) ?? 0)
      + (primaryRequirements.get(hash) ?? 0)
      + (allowBasicSubstitution && substitutionHashes.includes(hash) ? basicHashes.length : 0)));

  const primaryHashes = [...new Set([
    ...primaryTargetHashes,
    ...(allowBasicSubstitution ? substitutionHashes : [])
  ])];
  const primaryIndex = new Map(primaryHashes.map((hash, index) => [hash, index]));
  const primaryCaps = primaryHashes.map(hash => Math.min(request.maxSlots,
    (mandatoryRequirements.get(hash) ?? 0)
      + (primaryRequirements.get(hash) ?? 0)
      + (allowBasicSubstitution && substitutionHashes.includes(hash) ? basicHashes.length : 0)));
  const relevant = new Set(allHashes);

  const grouped = new Map<string, RawSigil[]>();
  for (const sigil of request.inventory) {
    const primary = sigil.primaryTraitHash >>> 0;
    const secondary = sigil.secondaryTraitHash >>> 0;
    if (forbidden.has(primary) || forbidden.has(secondary)) continue;
    if (!relevant.has(primary) && !relevant.has(secondary)) continue;
    const key = searchFactorGroupKey(sigil, equivalenceTargets, avoid);
    const bucket = grouped.get(key) ?? [];
    bucket.push(sigil);
    grouped.set(key, bucket);
  }

  const groups: FactorGroup[] = [...grouped.entries()].map(([key, instances]) => ({
    key,
    primary: instances[0]!.primaryTraitHash >>> 0,
    secondary: instances[0]!.secondaryTraitHash >>> 0,
    instances: [...instances].sort((left, right) =>
      right.sigilLevel - left.sigilLevel || left.gemUnitId - right.gemUnitId),
    tieA: stableCoefficient(key, request.runSeed, 0x9e3779b9),
    tieB: stableCoefficient(key, request.runSeed, 0x85ebca6b)
  })).sort((left, right) => {
    const leftMandatory = (mandatoryRequirements.has(left.primary) ? 1 : 0)
      + (mandatoryRequirements.has(left.secondary) ? 1 : 0);
    const rightMandatory = (mandatoryRequirements.has(right.primary) ? 1 : 0)
      + (mandatoryRequirements.has(right.secondary) ? 1 : 0);
    return rightMandatory - leftMandatory || left.key.localeCompare(right.key);
  });

  const classGroups = new Map<string, FactorGroup[]>();
  for (const group of groups) {
    const totalIndexes = [
      group.primary,
      ...(equivalenceTargets.has(group.secondary) ? [group.secondary] : [])
    ]
      .flatMap(hash => {
        const index = allIndex.get(hash);
        return index === undefined ? [] : [index];
      })
      .sort((left, right) => left - right);
    const projectedPrimaryIndex = primaryIndex.get(group.primary) ?? null;
    const avoidPerFactor = (avoid.has(group.primary) ? 1 : 0) + (avoid.has(group.secondary) ? 1 : 0);
    const classKey = `${totalIndexes.join(',')}/${projectedPrimaryIndex ?? '-'}/${avoidPerFactor}`;
    const bucket = classGroups.get(classKey) ?? [];
    bucket.push(group);
    classGroups.set(classKey, bucket);
  }
  const classes: FactorClass[] = [...classGroups.entries()].map(([key, projectedGroups]) => {
    const [totalPart, primaryPart, avoidPart] = key.split('/');
    return {
      key,
      totalIndexes: totalPart ? totalPart.split(',').map(Number) : [],
      primaryIndex: primaryPart === '-' ? null : Number(primaryPart),
      availableCount: projectedGroups.reduce((sum, group) => sum + group.instances.length, 0),
      choices: buildClassChoices(
        projectedGroups, Number(avoidPart), request.maxSlots, resultLimit)
    };
  }).sort((left, right) => {
    const mandatoryContribution = (factorClass: FactorClass) => factorClass.totalIndexes
      .filter(index => mandatoryRequirements.has(allHashes[index]!)).length;
    return mandatoryContribution(right) - mandatoryContribution(left)
      || left.key.localeCompare(right.key);
  });

  // An unlimited-slot suffix count is a safe impossibility test for mandatory skills.
  const suffixAvailability = Array.from({ length: classes.length + 1 }, () => allHashes.map(() => 0));
  for (let classIndex = classes.length - 1; classIndex >= 0; classIndex--) {
    const factorClass = classes[classIndex]!;
    const row = [...suffixAvailability[classIndex + 1]!];
    for (const index of factorClass.totalIndexes) {
      row[index] = Math.min(allCaps[index]!, row[index]! + factorClass.availableCount);
    }
    suffixAvailability[classIndex] = row;
  }

  const initial: Variant = {
    totalCounts: new Uint8Array(allHashes.length),
    primaryCounts: new Uint8Array(primaryHashes.length),
    usedSlots: 0,
    avoidOccurrences: 0,
    levelSum: 0,
    tieA: 0,
    tieB: 0,
    selections: null
  };
  let states = new Map<string, Variant[]>([[packedStateKey(
    initial.totalCounts, initial.primaryCounts, initial.usedSlots), [initial]]]);
  let exploredStateCount = 1;

  for (let classIndex = 0; classIndex < classes.length; classIndex++) {
    const factorClass = classes[classIndex]!;
    const next = new Map<string, Variant[]>();
    let layerVariantCount = 0;
    const suffix = suffixAvailability[classIndex + 1]!;
    for (const variants of states.values()) {
      for (const variant of variants) {
        for (const choice of factorClass.choices) {
          if (variant.usedSlots + choice.count > request.maxSlots) continue;
          candidateAttemptCount++;
          if ((candidateAttemptCount & 0x7ff) === 0
            && Date.now() - startedAt > timeLimitMs) {
            throw new Error('solver.time_limit');
          }
          const usedSlots = variant.usedSlots + choice.count;
          let mandatoryDeficit = 0;
          let mandatoryStillPossible = true;
          for (const { index, required } of mandatoryEntries) {
            const count = projectedCount(
              variant.totalCounts, index, factorClass.totalIndexes, choice.count, allCaps[index]!);
            mandatoryDeficit += Math.max(0, required - count);
            if (count + suffix[index]! < required) {
              mandatoryStillPossible = false;
              break;
            }
          }
          if (!mandatoryStillPossible
            || Math.ceil(mandatoryDeficit / 2) > request.maxSlots - usedSlots) continue;

          const key = projectedStateKey(
            variant, factorClass, choice.count, usedSlots, allCaps, primaryCaps);
          const bucket = next.get(key) ?? [];
          const avoidOccurrences = variant.avoidOccurrences + choice.avoidOccurrences;
          const levelSum = variant.levelSum + choice.levelSum;
          const tieA = variant.tieA + choice.tieA;
          const tieB = variant.tieB + choice.tieB;
          if (!canEnterBucket(
            bucket, resultLimit, avoidOccurrences, usedSlots, levelSum, tieA, tieB)) continue;

          let candidate = variant;
          if (choice.count > 0) {
            const totalCounts = variant.totalCounts.slice();
            const primaryCounts = variant.primaryCounts.slice();
            for (const index of factorClass.totalIndexes) {
              totalCounts[index] = Math.min(
                allCaps[index]!, totalCounts[index]! + choice.count);
            }
            if (factorClass.primaryIndex !== null) {
              const index = factorClass.primaryIndex;
              primaryCounts[index] = Math.min(
                primaryCaps[index]!, primaryCounts[index]! + choice.count);
            }
            candidate = {
              totalCounts,
              primaryCounts,
              usedSlots,
              avoidOccurrences,
              levelSum,
              tieA,
              tieB,
              selections: appendSelections(variant.selections, choice.entries)
            };
          }
          layerVariantCount += addVariant(bucket, candidate, resultLimit);
          next.set(key, bucket);
          const estimatedRetainedBytes = next.size * ESTIMATED_STATE_BYTES
            + layerVariantCount * ESTIMATED_VARIANT_BYTES;
          if (estimatedRetainedBytes > memoryLimitBytes) {
            throw new Error('solver.memory_limit');
          }
        }
      }
    }
    exploredStateCount += next.size;
    states = next;
  }

  const results: SolverResult[] = [];
  for (const variants of states.values()) {
    for (const variant of variants) {
      if (variant.usedSlots === 0) continue;
      const coverage = evaluateCoverage(
        variant,
        allHashes,
        primaryHashes,
        mandatoryHashes,
        effectiveOptionalHashes,
        primaryTargetHashes,
        forceBasicPrimary ? basicHashes.length : 0,
        substitutionHashes,
        allowBasicSubstitution);
      if (!coverage.mandatorySatisfied) continue;
      const selections = selectionEntries(variant.selections);
      const selected = selections.flatMap(([group, count]) => group.instances.slice(0, count));
      results.push({
        selected,
        signature: selections
          .map(([group, count]) => `${group.key}*${count}`)
          .sort((left, right) => left.localeCompare(right))
          .join('|'),
        mandatorySatisfied: true,
        primaryMatched: coverage.primaryMatched,
        primaryRequired: primaryTargetHashes.length,
        exactPrimaryCoverage: coverage.exactPrimaryCoverage,
        basicSubstitutionUsage: coverage.basicSubstitutionUsage,
        optionalMatched: coverage.optionalCoverage.filter(Boolean).length,
        optionalCoverage: coverage.optionalCoverage,
        avoidOccurrences: variant.avoidOccurrences,
        usedSlots: variant.usedSlots,
        levelSum: variant.levelSum,
        tieA: variant.tieA,
        tieB: variant.tieB
      });
    }
  }

  const ranked = results.sort((left, right) => compareResults(left, right, primaryTargetHashes.length > 0));
  const unique = dedupeEquivalentResults(ranked, equivalenceTargets);
  return {
    status: unique.length ? 'completed' : 'no-solution',
    results: unique.slice(0, resultLimit),
    candidateTypeCount: groups.length,
    exploredStateCount
  };
}

export async function solveBuildWithFallback(request: SolverRequest): Promise<SolverAnalysis> {
  const startedAt = Date.now();
  const timeLimitMs = Math.max(
    MIN_SOLVE_MILLISECONDS,
    Math.min(request.timeLimitMs ?? DEFAULT_SOLVE_MILLISECONDS, MAX_SOLVE_MILLISECONDS));
  try {
    return solveBuild(request);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'solver.memory_limit') throw error;
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { solveBuildMilp } = await import('./solver-milp.ts');
      return solveBuildMilp(request, startedAt, timeLimitMs);
    }
    const { solveBuildMilpInBrowser } = await import('./solver-milp-browser.ts');
    return solveBuildMilpInBrowser(request, startedAt, timeLimitMs);
  }
}

function compareResults(left: SolverResult, right: SolverResult, forcePrimary: boolean): number {
  if (forcePrimary && left.primaryMatched !== right.primaryMatched) return right.primaryMatched - left.primaryMatched;
  if (forcePrimary) {
    const exactDifference = compareBooleanVector(left.exactPrimaryCoverage, right.exactPrimaryCoverage);
    if (exactDifference !== 0) return exactDifference;
    const substitutionDifference = compareNumberVectorDescending(left.basicSubstitutionUsage, right.basicSubstitutionUsage);
    if (substitutionDifference !== 0) return substitutionDifference;
  }
  if (left.optionalMatched !== right.optionalMatched) return right.optionalMatched - left.optionalMatched;
  if (left.avoidOccurrences !== right.avoidOccurrences) return left.avoidOccurrences - right.avoidOccurrences;
  const optionalDifference = compareBooleanVector(left.optionalCoverage, right.optionalCoverage);
  if (optionalDifference !== 0) return optionalDifference;
  return left.usedSlots - right.usedSlots
    || right.levelSum - left.levelSum
    || left.tieA - right.tieA
    || left.tieB - right.tieB
    || left.signature.localeCompare(right.signature);
}
