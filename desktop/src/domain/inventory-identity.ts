import type { BuildProfile } from './models';
import type { RawSigil } from '../shared/contracts';

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
export function factorInstanceKey(sigil: RawSigil): string {
  return `factor-v1:${sigil.gemUnitId}:${sigil.inventorySlotId}:${hex(sigil.primaryTraitHash)}:${hex(sigil.secondaryTraitHash)}`;
}

/** Groups interchangeable logical factor types without merging their instances. */
export function factorTypeKey(sigil: RawSigil): string {
  return `${hex(sigil.primaryTraitHash)}:${hex(sigil.secondaryTraitHash)}`;
}

/** Used for display and diagnostics, not as the physical reservation identity. */
export function factorFingerprint(sigil: RawSigil): string {
  return `${factorTypeKey(sigil)}:lv${sigil.sigilLevel}`;
}

export function inventoryFingerprint(sigils: readonly RawSigil[]): string {
  const canonical = sigils.map(sigil => [
    factorInstanceKey(sigil),
    sigil.sigilHash >>> 0,
    sigil.sigilLevel,
    sigil.primaryLevel,
    sigil.secondaryLevel,
    sigil.flags,
    sigil.wornByCharacterId ?? ''
  ].join(':')).sort().join('|');
  return `inventory-v1:${sigils.length}:${stableDigest(canonical)}`;
}

export function instanceSetFingerprint(instanceKeys: readonly string[]): string {
  return `instances-v1:${instanceKeys.length}:${stableDigest([...instanceKeys].sort().join('|'))}`;
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
