import type { RawSigil } from '../shared/contracts';
import type { SolverAnalysis, SolverRequest, SolverResult } from './models';

interface FactorGroup {
  readonly primary: number;
  readonly secondary: number;
  readonly instances: readonly RawSigil[];
  readonly key: string;
  readonly tieA: number;
  readonly tieB: number;
}

interface Variant {
  readonly totalCounts: readonly number[];
  readonly primaryCounts: readonly number[];
  readonly usedSlots: number;
  readonly avoidOccurrences: number;
  readonly levelSum: number;
  readonly tieA: number;
  readonly tieB: number;
  readonly selections: readonly [FactorGroup, number][];
  readonly signature: string;
}

interface EvaluatedCoverage {
  readonly mandatorySatisfied: boolean;
  readonly primaryMatched: number;
  readonly exactPrimaryCoverage: readonly boolean[];
  readonly basicSubstitutionUsage: readonly number[];
  readonly optionalCoverage: readonly boolean[];
}

// The exact dynamic program is intentionally bounded. Some legal 24-target
// profiles are exponential set-cover instances; failing them explicitly is safer
// than exhausting the renderer process and losing the whole UI.
const MAX_LAYER_STATES = 50_000;
const MAX_LAYER_VARIANTS = 100_000;
const MAX_SOLVE_MILLISECONDS = 30_000;

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
  return compareAdditiveTail(left, right) || left.signature.localeCompare(right.signature);
}

function addVariant(bucket: Variant[], candidate: Variant, limit: number): number {
  if (bucket.some(existing => existing.signature === candidate.signature)) return 0;
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
    const key = `${primary.toString(16).padStart(8, '0')}:${secondary.toString(16).padStart(8, '0')}`;
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

  // An unlimited-slot suffix count is a safe impossibility test for mandatory skills.
  const suffixAvailability = Array.from({ length: groups.length + 1 }, () => allHashes.map(() => 0));
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex--) {
    const group = groups[groupIndex]!;
    const row = [...suffixAvailability[groupIndex + 1]!];
    for (const hash of [group.primary, group.secondary]) {
      const index = allIndex.get(hash);
      if (index !== undefined) row[index] = Math.min(allCaps[index]!, row[index]! + group.instances.length);
    }
    suffixAvailability[groupIndex] = row;
  }

  const initial: Variant = {
    totalCounts: allHashes.map(() => 0),
    primaryCounts: primaryHashes.map(() => 0),
    usedSlots: 0,
    avoidOccurrences: 0,
    levelSum: 0,
    tieA: 0,
    tieB: 0,
    selections: [],
    signature: ''
  };
  let states = new Map<string, Variant[]>([['0', [initial]]]);
  let exploredStateCount = 1;

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]!;
    const next = new Map<string, Variant[]>();
    let layerVariantCount = 0;
    const suffix = suffixAvailability[groupIndex + 1]!;
    for (const variants of states.values()) {
      for (const variant of variants) {
        const maxCount = Math.min(group.instances.length, request.maxSlots - variant.usedSlots);
        let runningLevel = 0;
        for (let selectedCount = 0; selectedCount <= maxCount; selectedCount++) {
          candidateAttemptCount++;
          if ((candidateAttemptCount & 0x7ff) === 0
            && Date.now() - startedAt > MAX_SOLVE_MILLISECONDS) {
            throw new Error('solver.resource_limit');
          }
          if (selectedCount > 0) runningLevel += group.instances[selectedCount - 1]!.sigilLevel;
          const totalCounts = [...variant.totalCounts];
          const primaryCounts = [...variant.primaryCounts];
          if (selectedCount > 0) {
            for (const hash of [group.primary, group.secondary]) {
              const index = allIndex.get(hash);
              if (index !== undefined) totalCounts[index] = Math.min(
                allCaps[index]!, totalCounts[index]! + selectedCount);
            }
            const index = primaryIndex.get(group.primary);
            if (index !== undefined) primaryCounts[index] = Math.min(
              primaryCaps[index]!, primaryCounts[index]! + selectedCount);
          }

          const mandatoryStillPossible = allHashes.every((hash, index) =>
            totalCounts[index]! + suffix[index]! >= (mandatoryRequirements.get(hash) ?? 0));
          if (!mandatoryStillPossible) continue;

          const usedSlots = variant.usedSlots + selectedCount;
          const selection = selectedCount === 0
            ? variant.selections
            : [...variant.selections, [group, selectedCount] as [FactorGroup, number]];
          const signature = selectedCount === 0
            ? variant.signature
            : `${variant.signature}|${group.key}*${selectedCount}`;
          const candidate: Variant = {
            totalCounts,
            primaryCounts,
            usedSlots,
            avoidOccurrences: variant.avoidOccurrences + selectedCount
              * ((avoid.has(group.primary) ? 1 : 0) + (avoid.has(group.secondary) ? 1 : 0)),
            levelSum: variant.levelSum + runningLevel,
            tieA: variant.tieA + group.tieA * selectedCount,
            tieB: variant.tieB + group.tieB * selectedCount,
            selections: selection,
            signature
          };
          const key = `${totalCounts.join(',')}/${primaryCounts.join(',')}/${usedSlots}`;
          const bucket = next.get(key) ?? [];
          layerVariantCount += addVariant(bucket, candidate, resultLimit);
          next.set(key, bucket);
          if (next.size > MAX_LAYER_STATES || layerVariantCount > MAX_LAYER_VARIANTS) {
            throw new Error('solver.resource_limit');
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
      const selected = variant.selections.flatMap(([group, count]) => group.instances.slice(0, count));
      results.push({
        selected,
        signature: variant.selections
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
  return {
    status: ranked.length ? 'completed' : 'no-solution',
    results: ranked.slice(0, resultLimit),
    candidateTypeCount: groups.length,
    exploredStateCount
  };
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
