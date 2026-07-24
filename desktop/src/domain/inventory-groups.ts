import type { FactorStock, LogicalSigil, RawSigil } from '../shared/contracts';
import { factorFingerprint, factorInstanceKey, stableDigest } from './inventory-identity.ts';

export interface FactorGroupReservation {
  readonly groupKey: string;
  readonly count: number;
}

export interface FactorInventoryGroup {
  readonly groupKey: string;
  readonly representative: LogicalSigil;
  readonly members: readonly LogicalSigil[];
  readonly count: number;
}

export function factorGroupKey(
  sigil: Pick<RawSigil, 'primaryTraitHash' | 'secondaryTraitHash' | 'sigilLevel'>
): string {
  return `group-v1:${factorFingerprint(sigil)}`;
}

/** The only RawSigil -> inventory conversion. It runs immediately after parsing. */
export function aggregateRawInventory(sigils: readonly RawSigil[]): FactorStock[] {
  const grouped = new Map<string, FactorStock>();
  for (const sigil of sigils) {
    const groupKey = factorGroupKey(sigil);
    const current = grouped.get(groupKey);
    grouped.set(groupKey, {
      groupKey,
      primaryTraitHash: sigil.primaryTraitHash >>> 0,
      secondaryTraitHash: sigil.secondaryTraitHash >>> 0,
      sigilLevel: sigil.sigilLevel,
      count: (current?.count ?? 0) + 1,
      wornCount: (current?.wornCount ?? 0) + Number(!!sigil.wornByCharacterId)
    });
  }
  return [...grouped.values()].sort((left, right) => left.groupKey.localeCompare(right.groupKey));
}

export function expandStocks(
  stocks: readonly FactorStock[],
  reservations: readonly FactorGroupReservation[] = []
): LogicalSigil[] {
  const reserved = new Map(mergeReservations(reservations)
    .map(item => [item.groupKey, item.count] as const));
  return stocks.flatMap(stock => {
    const available = Math.max(0, stock.count - (reserved.get(stock.groupKey) ?? 0));
    return Array.from({ length: available }, (_, stockOrdinal): LogicalSigil => ({
      groupKey: stock.groupKey,
      stockOrdinal,
      primaryTraitHash: stock.primaryTraitHash,
      secondaryTraitHash: stock.secondaryTraitHash,
      sigilLevel: stock.sigilLevel
    }));
  });
}

export function groupInventory(sigils: readonly LogicalSigil[]): FactorInventoryGroup[] {
  const grouped = new Map<string, LogicalSigil[]>();
  for (const sigil of sigils) {
    const members = grouped.get(sigil.groupKey);
    if (members) members.push(sigil);
    else grouped.set(sigil.groupKey, [sigil]);
  }
  return [...grouped].map(([groupKey, unsorted]) => {
    const members = [...unsorted].sort((left, right) =>
      factorInstanceKey(left).localeCompare(factorInstanceKey(right)));
    return { groupKey, representative: members[0]!, members, count: members.length };
  }).sort((left, right) => left.groupKey.localeCompare(right.groupKey));
}

export function countReservations(sigils: readonly LogicalSigil[]): FactorGroupReservation[] {
  return mergeReservations(sigils.map(sigil => ({ groupKey: sigil.groupKey, count: 1 })));
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

export function excludeReservations(
  stocks: readonly FactorStock[],
  reservations: readonly FactorGroupReservation[]
): LogicalSigil[] {
  return expandStocks(stocks, reservations);
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
  stocks: readonly FactorStock[],
  reservations: readonly FactorGroupReservation[]
): number {
  const totals = new Map(stocks.map(stock => [stock.groupKey, stock.count] as const));
  return mergeReservations(reservations).reduce(
    (missing, item) => missing + Math.max(0, item.count - (totals.get(item.groupKey) ?? 0)),
    0
  );
}

export function chooseGroupMember(
  group: FactorInventoryGroup,
  preferredInstanceKey?: string
): LogicalSigil {
  if (preferredInstanceKey) {
    const preferred = group.members.find(item => factorInstanceKey(item) === preferredInstanceKey);
    if (preferred) return preferred;
  }
  return group.representative;
}
