import type { RawSigil } from '../shared/contracts';
import { factorFingerprint, factorInstanceKey, stableDigest } from './inventory-identity.ts';

export interface FactorGroupReservation {
  readonly groupKey: string;
  readonly count: number;
}

export interface FactorInventoryGroup {
  readonly groupKey: string;
  readonly representative: RawSigil;
  readonly members: readonly RawSigil[];
  readonly count: number;
}

export function factorGroupKey(sigil: RawSigil): string {
  return `group-v1:${factorFingerprint(sigil)}`;
}

function comparePhysicalIdentity(left: RawSigil, right: RawSigil): number {
  return factorInstanceKey(left).localeCompare(factorInstanceKey(right));
}

export function groupInventory(sigils: readonly RawSigil[]): FactorInventoryGroup[] {
  const grouped = new Map<string, RawSigil[]>();
  for (const sigil of sigils) {
    const key = factorGroupKey(sigil);
    const members = grouped.get(key);
    if (members) members.push(sigil);
    else grouped.set(key, [sigil]);
  }
  return [...grouped].map(([groupKey, unsorted]) => {
    const members = [...unsorted].sort(comparePhysicalIdentity);
    return {
      groupKey,
      representative: members[0]!,
      members,
      count: members.length
    };
  }).sort((left, right) => left.groupKey.localeCompare(right.groupKey));
}

export function countReservations(sigils: readonly RawSigil[]): FactorGroupReservation[] {
  const counts = new Map<string, number>();
  for (const sigil of sigils) {
    const key = factorGroupKey(sigil);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([groupKey, count]) => ({ groupKey, count }))
    .sort((left, right) => left.groupKey.localeCompare(right.groupKey));
}

export function mergeReservations(
  reservations: readonly FactorGroupReservation[]
): FactorGroupReservation[] {
  const counts = new Map<string, number>();
  for (const reservation of reservations) {
    if (!Number.isInteger(reservation.count) || reservation.count <= 0) continue;
    counts.set(reservation.groupKey, (counts.get(reservation.groupKey) ?? 0) + reservation.count);
  }
  return [...counts].map(([groupKey, count]) => ({ groupKey, count }))
    .sort((left, right) => left.groupKey.localeCompare(right.groupKey));
}

/**
 * Expands logical reservations to deterministic physical entries for the solver.
 * Inventory positions never become part of the business reservation.
 */
export function excludeReservations(
  sigils: readonly RawSigil[],
  reservations: readonly FactorGroupReservation[]
): RawSigil[] {
  const reserved = new Map(mergeReservations(reservations)
    .map(item => [item.groupKey, item.count] as const));
  const available: RawSigil[] = [];
  for (const group of groupInventory(sigils)) {
    const removeCount = Math.min(group.count, reserved.get(group.groupKey) ?? 0);
    available.push(...group.members.slice(removeCount));
  }
  return available;
}

export function reservationFingerprint(
  reservations: readonly FactorGroupReservation[]
): string {
  const canonical = mergeReservations(reservations)
    .map(item => `${item.groupKey}=${item.count}`)
    .join('|');
  return `group-reservations-v1:${stableDigest(canonical)}`;
}

export function reservationShortfall(
  sigils: readonly RawSigil[],
  reservations: readonly FactorGroupReservation[]
): number {
  const totals = new Map(groupInventory(sigils).map(group => [group.groupKey, group.count] as const));
  return mergeReservations(reservations).reduce(
    (missing, item) => missing + Math.max(0, item.count - (totals.get(item.groupKey) ?? 0)),
    0
  );
}

export function chooseGroupMember(
  group: FactorInventoryGroup,
  preferredInstanceKey?: string
): RawSigil {
  if (preferredInstanceKey) {
    const preferred = group.members.find(item => factorInstanceKey(item) === preferredInstanceKey);
    if (preferred) return preferred;
  }
  return group.representative;
}
