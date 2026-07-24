import type { RawSigil } from '../shared/contracts';
import type { BuildProfile, CatalogData, SolverResult } from './models';

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

export function targetTraitHashes(profile: BuildProfile, catalog: CatalogData): ReadonlySet<number> {
  const traitById = new Map(catalog.traits.map(trait =>
    [trait.id, Number.parseInt(trait.hash.slice(2), 16) >>> 0]));
  return new Set([
    ...profile.mandatory,
    ...profile.basicPrimary,
    ...profile.attackPrimary,
    ...profile.defensePrimary,
    ...profile.optional
  ].flatMap(id => {
    const hash = traitById.get(id);
    return hash === undefined ? [] : [hash];
  }));
}

/**
 * Merges search groups whose only difference is a secondary trait outside every
 * target. The primary trait is always retained because it determines both scheme
 * identity and which secondary replacements are available.
 *
 * Soft-avoid status stays in the search key so ranking can retain the better
 * representative. It is intentionally omitted from the final equivalence key.
 */
export function searchFactorGroupKey(
  sigil: RawSigil,
  targetHashes: ReadonlySet<number>,
  avoidHashes: ReadonlySet<number>
): string {
  const primary = sigil.primaryTraitHash >>> 0;
  const secondary = sigil.secondaryTraitHash >>> 0;
  const secondaryRole = targetHashes.has(secondary)
    ? hex(secondary)
    : avoidHashes.has(secondary) ? '*avoid' : '*';
  return `${hex(primary)}:${secondaryRole}`;
}

function factorPositionRole(
  sigil: RawSigil,
  targetHashes: ReadonlySet<number>
): string {
  const primary = sigil.primaryTraitHash >>> 0;
  const secondary = sigil.secondaryTraitHash >>> 0;
  return `${hex(primary)}:${targetHashes.has(secondary) ? hex(secondary) : '*'}`;
}

export function resultEquivalenceKey(
  result: SolverResult,
  targetHashes: ReadonlySet<number>
): string {
  const coverage = [
    Number(result.mandatorySatisfied),
    result.primaryMatched,
    result.primaryRequired,
    result.exactPrimaryCoverage.map(Number).join(''),
    result.basicSubstitutionUsage.join(','),
    result.optionalCoverage.map(Number).join('')
  ].join('/');
  const positions = result.selected.map(sigil => factorPositionRole(sigil, targetHashes)).sort().join('|');
  return `${coverage}/${positions}`;
}

export function dedupeEquivalentResults(
  results: readonly SolverResult[],
  targetHashes: ReadonlySet<number>
): SolverResult[] {
  const seen = new Set<string>();
  return results.filter(result => {
    const key = resultEquivalenceKey(result, targetHashes);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
