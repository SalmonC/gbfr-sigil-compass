import type { BuildProfile } from './models';
import type { FactorStock, LogicalSigil, RawSigil } from '../shared/contracts';

type FactorShape = Pick<RawSigil, 'primaryTraitHash' | 'secondaryTraitHash' | 'sigilLevel'>;

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

function hashText(value: string, seed: number): string {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function stableDigest(value: string): string {
  return `${hashText(value, 0x9e3779b9)}${hashText(value, 0x85ebca6b)}`;
}

/**
 * Identifies one physical inventory entry in the imported save snapshot.
 * Trait hashes guard against a game slot being reused for a different sigil.
 */
export function factorInstanceKey(sigil: LogicalSigil): string {
  return `logical-v1:${sigil.groupKey}:${sigil.stockOrdinal}`;
}

/** Groups interchangeable logical factor types without merging their instances. */
export function factorTypeKey(sigil: FactorShape): string {
  return `${hex(sigil.primaryTraitHash)}:${hex(sigil.secondaryTraitHash)}`;
}

/** Identifies one interchangeable factor group: ordered traits plus sigil level. */
export function factorFingerprint(sigil: FactorShape): string {
  return `${factorTypeKey(sigil)}:lv${sigil.sigilLevel}`;
}

export function inventoryFingerprint(stocks: readonly FactorStock[]): string {
  const canonical = stocks.map(stock => [
    stock.groupKey,
    stock.count,
    stock.wornCount
  ].join(':')).sort().join('|');
  const count = stocks.reduce((sum, stock) => sum + stock.count, 0);
  return `inventory-v2:${count}:${stableDigest(canonical)}`;
}

export function allocationSetFingerprint(keys: readonly string[]): string {
  return `allocations-v1:${keys.length}:${stableDigest([...keys].sort().join('|'))}`;
}

export function profileComputeFingerprint(profile: BuildProfile): string {
  const canonical = JSON.stringify({
    schemaVersion: profile.schemaVersion,
    catalogVersion: profile.catalogVersion,
    mandatory: profile.mandatory,
    basicPrimary: profile.basicPrimary,
    forceBasicPrimary: profile.forceBasicPrimary,
    allowBasicSubstitution: profile.allowBasicSubstitution,
    basicSubstitutionOrder: profile.forceBasicPrimary && profile.allowBasicSubstitution
      ? profile.basicSubstitutionOrder
      : [],
    attackPrimary: profile.attackPrimary,
    forceAttackPrimary: profile.forceAttackPrimary,
    defensePrimary: profile.defensePrimary,
    forceDefensePrimary: profile.forceDefensePrimary,
    optional: profile.optional,
    forbidden: [...profile.forbidden].sort(),
    avoid: [...profile.avoid].sort()
  });
  return `profile-v1:${stableDigest(canonical)}`;
}
