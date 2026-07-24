import type { LogicalSigil } from '../shared/contracts';
import { stableDigest } from './inventory-identity.ts';
import type { BuildProfile, CatalogData, SolverResult } from './models';

function hashNumber(value: string): number {
  return Number.parseInt(value.slice(2), 16) >>> 0;
}

function countItems(values: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function logicalSelectionKey(selected: readonly LogicalSigil[]): string {
  return selected.map(sigil => sigil.groupKey).sort().join('|');
}

export function hasSameLogicalSelection(
  left: readonly LogicalSigil[],
  right: readonly LogicalSigil[]
): boolean {
  return logicalSelectionKey(left) === logicalSelectionKey(right);
}

/**
 * Re-evaluates a user-edited selection with the same token allocation rules as the
 * solver. It deliberately does not rank the result; the edited selection remains
 * attached to the solver result from which it was created.
 */
export function evaluateAdjustedResult(
  source: SolverResult,
  profile: BuildProfile,
  catalog: CatalogData,
  selected: readonly LogicalSigil[]
): SolverResult {
  if (selected.length > 12) throw new Error('一套配装最多使用 12 枚因子。');
  const traitById = new Map(catalog.traits.map(trait => [trait.id, hashNumber(trait.hash)]));
  const hashes = (ids: readonly string[]) => ids.map(id => {
    const hash = traitById.get(id);
    if (hash === undefined) throw new Error(`技能资料中找不到 ${id}。`);
    return hash;
  });

  const mandatoryHashes = hashes(profile.mandatory);
  const basicHashes = hashes(profile.basicPrimary);
  const attackHashes = hashes(profile.attackPrimary);
  const defenseHashes = hashes(profile.defensePrimary);
  const optionalHashes = hashes(profile.optional);
  const substitutionHashes = hashes(profile.basicSubstitutionOrder);
  const forbidden = new Set(hashes(profile.forbidden));
  const avoid = new Set(hashes(profile.avoid));
  const forceBasic = profile.forceBasicPrimary;
  const allowSubstitution = forceBasic && profile.allowBasicSubstitution;
  const primaryTargetHashes = [
    ...(forceBasic ? basicHashes : []),
    ...(profile.forceAttackPrimary ? attackHashes : []),
    ...(profile.forceDefensePrimary ? defenseHashes : [])
  ];
  const effectiveOptionalHashes = [
    ...optionalHashes,
    ...(!forceBasic ? basicHashes : []),
    ...(!profile.forceAttackPrimary ? attackHashes : []),
    ...(!profile.forceDefensePrimary ? defenseHashes : [])
  ];

  const total = new Map<number, number>();
  const primary = new Map<number, number>();
  let avoidOccurrences = 0;
  let forbiddenOccurrences = 0;
  for (const sigil of selected) {
    const primaryHash = sigil.primaryTraitHash >>> 0;
    const secondaryHash = sigil.secondaryTraitHash >>> 0;
    total.set(primaryHash, (total.get(primaryHash) ?? 0) + 1);
    total.set(secondaryHash, (total.get(secondaryHash) ?? 0) + 1);
    primary.set(primaryHash, (primary.get(primaryHash) ?? 0) + 1);
    avoidOccurrences += Number(avoid.has(primaryHash)) + Number(avoid.has(secondaryHash));
    forbiddenOccurrences += Number(forbidden.has(primaryHash)) + Number(forbidden.has(secondaryHash));
  }

  const mandatoryRequirements = countItems(mandatoryHashes);
  const mandatorySatisfied = [...mandatoryRequirements]
    .every(([hash, count]) => (total.get(hash) ?? 0) >= count);

  if (mandatorySatisfied) {
    // Consume mandatory occurrences from secondary traits first, preserving primary
    // occurrences for the higher-priority primary-trait targets.
    for (const [hash, required] of mandatoryRequirements) {
      const totalCount = total.get(hash) ?? 0;
      const primaryCount = primary.get(hash) ?? 0;
      const secondaryCount = totalCount - primaryCount;
      const primaryConsumed = Math.max(0, required - secondaryCount);
      total.set(hash, totalCount - required);
      if (primary.has(hash)) primary.set(hash, Math.max(0, primaryCount - primaryConsumed));
    }
  }

  let exactPrimaryMatched = 0;
  let substituted = 0;
  const exactPrimaryCoverage = primaryTargetHashes.map(hash => {
    if (!mandatorySatisfied) return false;
    const available = primary.get(hash) ?? 0;
    if (available <= 0) return false;
    primary.set(hash, available - 1);
    total.set(hash, (total.get(hash) ?? 0) - 1);
    exactPrimaryMatched += 1;
    return true;
  });

  const basicSubstitutionUsage = substitutionHashes.map(() => 0);
  if (mandatorySatisfied && allowSubstitution) {
    let missing = exactPrimaryCoverage.slice(0, basicHashes.length).filter(value => !value).length;
    for (let index = 0; index < substitutionHashes.length && missing > 0; index += 1) {
      const hash = substitutionHashes[index]!;
      const used = Math.min(missing, primary.get(hash) ?? 0);
      basicSubstitutionUsage[index] = used;
      substituted += used;
      missing -= used;
      primary.set(hash, (primary.get(hash) ?? 0) - used);
      total.set(hash, (total.get(hash) ?? 0) - used);
    }
  }

  const optionalCoverage = effectiveOptionalHashes.map(hash => {
    if (!mandatorySatisfied) return false;
    const available = total.get(hash) ?? 0;
    if (available <= 0) return false;
    total.set(hash, available - 1);
    return true;
  });
  const instanceDigest = stableDigest(logicalSelectionKey(selected));

  return {
    selected: [...selected],
    signature: `manual-v1:${instanceDigest}`,
    manuallyAdjusted: true,
    forbiddenOccurrences,
    mandatorySatisfied,
    primaryMatched: mandatorySatisfied ? exactPrimaryMatched + substituted : 0,
    primaryRequired: primaryTargetHashes.length,
    exactPrimaryCoverage,
    basicSubstitutionUsage: allowSubstitution ? basicSubstitutionUsage : [],
    optionalMatched: optionalCoverage.filter(Boolean).length,
    optionalCoverage,
    avoidOccurrences,
    usedSlots: selected.length,
    levelSum: selected.reduce((sum, sigil) => sum + sigil.sigilLevel, 0),
    tieA: source.tieA,
    tieB: source.tieB
  };
}
