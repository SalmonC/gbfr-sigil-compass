import type { BuildProfile, CatalogData, SolverAnalysis, SolverResult } from './models';
import { loadProfiles, removeLegacyProfileStorage, validateProfile } from './profile-codec.ts';
import {
  factorInstanceKey, instanceSetFingerprint, inventoryFingerprint, profileComputeFingerprint
} from './inventory-identity.ts';
import {
  countReservations, excludeReservations, groupInventory, mergeReservations,
  reservationFingerprint, reservationShortfall, type FactorGroupReservation
} from './inventory-groups.ts';
import type { ImportedInventory, RawSigil } from '../shared/contracts';

const STORAGE_KEY = 'gbfr-factor-planner.workspace.v4';
const LEGACY_STORAGE_KEY = 'gbfr-factor-planner.workspace.v3';
export const RANKING_VERSION = 'GBFR-RANK-4';

export interface CachedAnalysis {
  readonly rankingVersion: string;
  readonly requestKey: string;
  readonly profileFingerprint: string;
  readonly inventoryFingerprint: string;
  readonly excludedInstancesFingerprint: string;
  readonly excludedInstanceKeys: readonly string[];
  readonly runSeed: number;
  readonly computedAt: string;
  readonly analysis: SolverAnalysis;
  readonly manualResults?: Readonly<Record<string, SolverResult>>;
}

export interface ConfirmedLoadout {
  readonly displayName?: string;
  readonly sourceProfileName?: string;
  readonly profileSnapshot?: BuildProfile;
  readonly resultSignature: string;
  readonly inventoryFingerprint: string;
  /** Legacy v0.2.3 physical reservations. New records use groupReservations. */
  readonly instanceKeys: readonly string[];
  readonly groupReservations?: readonly FactorGroupReservation[];
  readonly result?: SolverResult;
  readonly confirmedAt: string;
}

export interface StoredProfile {
  readonly id: string;
  readonly profile: BuildProfile;
  readonly updatedAt: string;
  readonly cache?: CachedAnalysis;
  readonly confirmed?: ConfirmedLoadout;
}

export interface WorkspaceState {
  readonly schemaVersion: 4;
  readonly activeProfileId: string;
  readonly profiles: readonly StoredProfile[];
}

export interface AnalysisContext {
  readonly profileFingerprint: string;
  readonly inventoryFingerprint: string;
  readonly excludedInstancesFingerprint: string;
  readonly excludedInstanceKeys: readonly string[];
  readonly availableInventory: readonly RawSigil[];
  readonly unresolvedLegacyReservationProfiles: readonly string[];
  readonly requestKey: string;
}

export type CacheStatus = 'none' | 'current' | 'profile-changed' | 'inventory-changed' | 'allocations-changed';

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function validateStoredProfile(value: unknown, catalog: CatalogData): StoredProfile | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StoredProfile>;
  if (typeof record.id !== 'string' || typeof record.updatedAt !== 'string' || !record.profile) return null;
  try {
    const profile = validateProfile(record.profile, catalog);
    const cache = validateCachedAnalysis(record.cache);
    const confirmed = validateConfirmedLoadout(record.confirmed);
    return { id: record.id, updatedAt: record.updatedAt, profile, cache, confirmed };
  } catch {
    return null;
  }
}

function isStringArray(value: unknown, maxItems: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems
    && value.every(item => typeof item === 'string' && item.length <= 160);
}

function validateCachedAnalysis(value: unknown): CachedAnalysis | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const cache = value as Partial<CachedAnalysis>;
  if (typeof cache.profileFingerprint !== 'string'
    || cache.rankingVersion !== RANKING_VERSION
    || typeof cache.requestKey !== 'string'
    || typeof cache.inventoryFingerprint !== 'string'
    || typeof cache.excludedInstancesFingerprint !== 'string'
    || typeof cache.runSeed !== 'number'
    || typeof cache.computedAt !== 'string'
    || !isStringArray(cache.excludedInstanceKeys, 12 * 100)
    || !cache.analysis || typeof cache.analysis !== 'object'
    || !Array.isArray(cache.analysis.results)
    || cache.analysis.results.length > 10
    || cache.analysis.results.some(result => !Array.isArray(result?.selected) || result.selected.length > 12)) {
    return undefined;
  }
  const resultSignatures = new Set(cache.analysis.results.map(result => result.signature));
  const manualResults: Record<string, SolverResult> = {};
  if (cache.manualResults !== undefined) {
    if (!cache.manualResults || typeof cache.manualResults !== 'object'
      || Array.isArray(cache.manualResults)
      || Object.keys(cache.manualResults).length > 10) return undefined;
    for (const [sourceSignature, manualValue] of Object.entries(cache.manualResults)) {
      if (!resultSignatures.has(sourceSignature)) return undefined;
      const result = normalizeSolverResult(manualValue, false);
      if (!result || result.manuallyAdjusted !== true) return undefined;
      manualResults[sourceSignature] = result;
    }
  }
  return {
    ...(cache as CachedAnalysis),
    manualResults: Object.keys(manualResults).length ? manualResults : undefined
  };
}

function validateConfirmedLoadout(value: unknown): ConfirmedLoadout | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const confirmed = value as Partial<ConfirmedLoadout>;
  if (typeof confirmed.resultSignature !== 'string'
    || typeof confirmed.inventoryFingerprint !== 'string'
    || typeof confirmed.confirmedAt !== 'string'
    || !isStringArray(confirmed.instanceKeys, 12)) return undefined;
  const result = normalizeConfirmedResult(confirmed.result);
  if (confirmed.result && !result) return undefined;
  const suppliedReservations = validateGroupReservations(confirmed.groupReservations);
  if (confirmed.groupReservations !== undefined && !suppliedReservations) return undefined;
  // v3 confirmations stored physical keys. A saved result contains enough
  // information to migrate them without reopening the save file.
  const groupReservations = suppliedReservations
    ?? (result ? countReservations(result.selected) : undefined);
  return { ...confirmed, groupReservations, result } as ConfirmedLoadout;
}

function validateGroupReservations(value: unknown): FactorGroupReservation[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 12) return undefined;
  const reservations: FactorGroupReservation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return undefined;
    const record = item as Partial<FactorGroupReservation>;
    if (typeof record.groupKey !== 'string' || record.groupKey.length > 160
      || !Number.isInteger(record.count) || (record.count ?? 0) < 1 || (record.count ?? 0) > 12) {
      return undefined;
    }
    reservations.push({ groupKey: record.groupKey, count: record.count! });
  }
  return mergeReservations(reservations);
}

function normalizeConfirmedResult(value: unknown): SolverResult | undefined {
  return normalizeSolverResult(value, true);
}

function normalizeSolverResult(value: unknown, requireMandatory: boolean): SolverResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.selected) || result.selected.length > 12
    || typeof result.signature !== 'string'
    || typeof result.mandatorySatisfied !== 'boolean'
    || (requireMandatory && result.mandatorySatisfied !== true)
    || typeof result.optionalMatched !== 'number'
    || !Array.isArray(result.optionalCoverage)
    || typeof result.avoidOccurrences !== 'number'
    || typeof result.usedSlots !== 'number'
    || typeof result.levelSum !== 'number'
    || typeof result.tieA !== 'number'
    || typeof result.tieB !== 'number') return undefined;
  if (typeof result.primaryMatched === 'number'
    && typeof result.primaryRequired === 'number'
    && Array.isArray(result.exactPrimaryCoverage)
    && Array.isArray(result.basicSubstitutionUsage)) return result as unknown as SolverResult;
  if (typeof result.basicMatched !== 'number'
    || typeof result.basicRequired !== 'number'
    || !Array.isArray(result.exactBasicCoverage)
    || !Array.isArray(result.substitutionUsage)) return undefined;
  return {
    selected: result.selected as SolverResult['selected'],
    signature: result.signature,
    mandatorySatisfied: result.mandatorySatisfied,
    primaryMatched: result.basicMatched,
    primaryRequired: result.basicRequired,
    exactPrimaryCoverage: result.exactBasicCoverage as boolean[],
    basicSubstitutionUsage: result.substitutionUsage as number[],
    optionalMatched: result.optionalMatched,
    optionalCoverage: result.optionalCoverage as boolean[],
    avoidOccurrences: result.avoidOccurrences,
    usedSlots: result.usedSlots,
    levelSum: result.levelSum,
    tieA: result.tieA,
    tieB: result.tieB,
    manuallyAdjusted: result.manuallyAdjusted === true || undefined,
    forbiddenOccurrences: typeof result.forbiddenOccurrences === 'number'
      ? result.forbiddenOccurrences
      : undefined
  };
}

export function createWorkspace(catalog: CatalogData, fallback: BuildProfile): WorkspaceState {
  const loadStored = (storageKey: string, schemaVersion: 3 | 4): WorkspaceState | null => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      if (!parsed || typeof parsed !== 'object') return null;
      const value = parsed as { schemaVersion?: number; activeProfileId?: string; profiles?: unknown[] };
      if (value.schemaVersion !== schemaVersion || !Array.isArray(value.profiles)) return null;
      const profiles = value.profiles.flatMap(item => {
        const validated = validateStoredProfile(item, catalog);
        if (!validated) return [];
        // Solver results in a v3 cache use physical identities. Drop them during
        // migration; named targets and confirmed group allocations are preserved.
        if (schemaVersion === 3) {
          const { cache: _cache, ...withoutCache } = validated;
          return [withoutCache];
        }
        return [validated];
      });
      if (!profiles.length) return null;
      const activeProfileId = profiles.some(item => item.id === value.activeProfileId)
        ? value.activeProfileId!
        : profiles[0]!.id;
      return { schemaVersion: 4, activeProfileId, profiles };
    } catch {
      return null;
    }
  };
  const current = loadStored(STORAGE_KEY, 4);
  if (current) return current;
  const legacy = loadStored(LEGACY_STORAGE_KEY, 3);
  if (legacy) return legacy;

  const migrated = loadProfiles(catalog);
  const source = migrated.length ? migrated : [fallback];
  const profiles = source.map(profile => ({ id: newId(), profile, updatedAt: nowIso() }));
  return { schemaVersion: 4, activeProfileId: profiles[0]!.id, profiles };
}

export function storeWorkspace(workspace: WorkspaceState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  removeLegacyProfileStorage();
}

export function replaceStoredProfile(
  workspace: WorkspaceState,
  profileId: string,
  update: (profile: StoredProfile) => StoredProfile
): WorkspaceState {
  return {
    ...workspace,
    profiles: workspace.profiles.map(item => item.id === profileId ? update(item) : item)
  };
}

export function addStoredProfile(workspace: WorkspaceState, profile: BuildProfile): WorkspaceState {
  const record: StoredProfile = { id: newId(), profile, updatedAt: nowIso() };
  return { ...workspace, activeProfileId: record.id, profiles: [...workspace.profiles, record] };
}

export function updateStoredDraft(workspace: WorkspaceState, profileId: string, profile: BuildProfile): WorkspaceState {
  return replaceStoredProfile(workspace, profileId, current => {
    if (profileComputeFingerprint(current.profile) === profileComputeFingerprint(profile)) {
      return { ...current, profile, updatedAt: nowIso() };
    }
    const { cache: _cache, ...withoutCache } = current;
    return { ...withoutCache, profile, updatedAt: nowIso() };
  });
}

export function deleteStoredProfile(workspace: WorkspaceState, profileId: string): WorkspaceState {
  const profiles = workspace.profiles.filter(item => item.id !== profileId);
  if (!profiles.length) throw new Error('至少保留一个方案。');
  return {
    ...workspace,
    activeProfileId: workspace.activeProfileId === profileId ? profiles[0]!.id : workspace.activeProfileId,
    profiles
  };
}

export function reservedInstanceKeys(workspace: WorkspaceState, exceptProfileId: string): string[] {
  return workspace.profiles.flatMap(item =>
    item.id === exceptProfileId || item.confirmed?.groupReservations
      ? []
      : (item.confirmed?.instanceKeys ?? []));
}

export function reservedGroupCounts(
  workspace: WorkspaceState,
  exceptProfileId?: string
): FactorGroupReservation[] {
  return mergeReservations(workspace.profiles.flatMap(item =>
    exceptProfileId !== undefined && item.id === exceptProfileId
      ? []
      : (item.confirmed?.groupReservations ?? [])));
}

function resolveReservationState(
  workspace: WorkspaceState,
  inventory: ImportedInventory,
  exceptProfileId?: string
): {
  readonly reservations: readonly FactorGroupReservation[];
  readonly unresolvedProfileIds: readonly string[];
  readonly unresolvedProfileNames: readonly string[];
} {
  const inventoryByInstance = new Map(inventory.sigils.map(sigil =>
    [factorInstanceKey(sigil), sigil] as const));
  const reservations: FactorGroupReservation[] = [];
  const unresolvedProfileIds: string[] = [];
  const unresolvedProfileNames: string[] = [];
  for (const record of workspace.profiles) {
    if (exceptProfileId !== undefined && record.id === exceptProfileId) continue;
    const confirmed = record.confirmed;
    if (!confirmed) continue;
    if (confirmed.groupReservations) {
      reservations.push(...confirmed.groupReservations);
      continue;
    }
    const resolved = confirmed.instanceKeys.flatMap(key => {
      const sigil = inventoryByInstance.get(key);
      return sigil ? [sigil] : [];
    });
    if (resolved.length !== confirmed.instanceKeys.length) {
      unresolvedProfileIds.push(record.id);
      unresolvedProfileNames.push(confirmed.displayName ?? record.profile.name);
      continue;
    }
    reservations.push(...countReservations(resolved));
  }
  return {
    reservations: mergeReservations(reservations),
    unresolvedProfileIds,
    unresolvedProfileNames
  };
}

export function createAnalysisContext(
  profile: BuildProfile,
  profileId: string,
  inventory: ImportedInventory,
  workspace: WorkspaceState,
  knownInventoryFingerprint?: string
): AnalysisContext {
  const legacyInstanceKeys = reservedInstanceKeys(workspace, profileId).sort();
  const reservationState = resolveReservationState(workspace, inventory, profileId);
  const groupReservations = reservationState.reservations;
  const availableInventory = reservationState.unresolvedProfileIds.length
    ? []
    : excludeReservations(inventory.sigils, groupReservations);
  const excludedInstanceKeys = [
    ...groupReservations.map(item => `${item.groupKey}=${item.count}`),
    ...reservationState.unresolvedProfileIds.map(id => `unresolved-legacy:${id}`)
  ].sort();
  const profileFingerprint = profileComputeFingerprint(profile);
  const snapshotFingerprint = knownInventoryFingerprint ?? inventoryFingerprint(inventory.sigils);
  const excludedInstancesFingerprint = groupReservations.length && legacyInstanceKeys.length === 0
    ? reservationFingerprint(groupReservations)
    : instanceSetFingerprint(excludedInstanceKeys);
  return {
    profileFingerprint,
    inventoryFingerprint: snapshotFingerprint,
    excludedInstancesFingerprint,
    excludedInstanceKeys,
    availableInventory,
    unresolvedLegacyReservationProfiles: reservationState.unresolvedProfileNames,
    requestKey: `${RANKING_VERSION}:${profileFingerprint}:${snapshotFingerprint}:${excludedInstancesFingerprint}`
  };
}

export function pruneInvalidAnalysisCaches(
  workspace: WorkspaceState,
  inventory: ImportedInventory,
  knownInventoryFingerprint = inventoryFingerprint(inventory.sigils)
): WorkspaceState {
  let changed = false;
  const profiles = workspace.profiles.map(record => {
    if (!record.cache) return record;
    const context = createAnalysisContext(
      record.profile, record.id, inventory, workspace, knownInventoryFingerprint);
    if (getCacheStatus(record.cache, context) === 'current') return record;
    changed = true;
    const { cache: _cache, ...withoutCache } = record;
    return withoutCache;
  });
  return changed ? { ...workspace, profiles } : workspace;
}

export function getCacheStatus(cache: CachedAnalysis | undefined, context: AnalysisContext): CacheStatus {
  if (!cache) return 'none';
  if (cache.rankingVersion !== RANKING_VERSION) return 'profile-changed';
  if (cache.profileFingerprint !== context.profileFingerprint) return 'profile-changed';
  if (cache.inventoryFingerprint !== context.inventoryFingerprint) return 'inventory-changed';
  if (cache.excludedInstancesFingerprint !== context.excludedInstancesFingerprint) {
    // Group reservations change candidate multiplicities. Reusing a result based on
    // physical instance overlap would be unsound because identical instances are interchangeable.
    return 'allocations-changed';
  }
  return 'current';
}

export function cacheAnalysis(
  workspace: WorkspaceState,
  profileId: string,
  context: AnalysisContext,
  runSeed: number,
  analysis: SolverAnalysis
): WorkspaceState {
  const cache: CachedAnalysis = {
    rankingVersion: RANKING_VERSION,
    requestKey: context.requestKey,
    profileFingerprint: context.profileFingerprint,
    inventoryFingerprint: context.inventoryFingerprint,
    excludedInstancesFingerprint: context.excludedInstancesFingerprint,
    excludedInstanceKeys: context.excludedInstanceKeys,
    runSeed,
    computedAt: nowIso(),
    analysis
  };
  return replaceStoredProfile(workspace, profileId, current => ({ ...current, cache }));
}

export function storeManualResult(
  workspace: WorkspaceState,
  profileId: string,
  sourceSignature: string,
  result: SolverResult | undefined
): WorkspaceState {
  return replaceStoredProfile(workspace, profileId, current => {
    if (!current.cache
      || !current.cache.analysis.results.some(item => item.signature === sourceSignature)) {
      throw new Error('找不到这套计算结果，请重新计算。');
    }
    const manualResults = { ...(current.cache.manualResults ?? {}) };
    if (result) manualResults[sourceSignature] = result;
    else delete manualResults[sourceSignature];
    return {
      ...current,
      cache: {
        ...current.cache,
        manualResults: Object.keys(manualResults).length ? manualResults : undefined
      }
    };
  });
}

export interface ReservationConflict {
  readonly profileId: string;
  readonly profileName: string;
  readonly shortage: number;
}

export function findReservationConflicts(
  workspace: WorkspaceState,
  profileId: string,
  result: SolverResult,
  inventory: ImportedInventory
): ReservationConflict[] {
  const requested = countReservations(result.selected);
  const reservationState = resolveReservationState(workspace, inventory, profileId);
  if (reservationState.unresolvedProfileIds.length) {
    return reservationState.unresolvedProfileIds.map((id, index) => ({
      profileId: id,
      profileName: reservationState.unresolvedProfileNames[index] ?? '旧版已确认配装',
      shortage: 1
    }));
  }
  const reservedByOthers = reservationState.reservations;
  const shortage = reservationShortfall(
    inventory.sigils,
    mergeReservations([...reservedByOthers, ...requested])
  );
  if (shortage <= 0) return [];
  const requestedKeys = new Set(requested.map(item => item.groupKey));
  const related = workspace.profiles.flatMap(item =>
    item.id === profileId || !item.confirmed
      || !(item.confirmed.groupReservations ?? []).some(allocation =>
        requestedKeys.has(allocation.groupKey))
      ? []
      : [{ profileId: item.id, profileName: item.profile.name, shortage }]);
  return related.length
    ? related
    : [{ profileId: '', profileName: '', shortage }];
}

export function confirmResult(
  workspace: WorkspaceState,
  profileId: string,
  result: SolverResult,
  currentInventoryFingerprint: string,
  inventory: ImportedInventory
): WorkspaceState {
  if (!result.mandatorySatisfied) throw new Error('必须满足的技能没有全部带上，不能确认这套配装。');
  if ((result.forbiddenOccurrences ?? 0) > 0) throw new Error('这套配装带有不能出现的技能，不能确认。');
  if (result.selected.length < 1 || result.selected.length > 12) throw new Error('配装使用的因子数量不正确。');
  const conflicts = findReservationConflicts(workspace, profileId, result, inventory);
  if (conflicts.length) {
    const names = [...new Set(conflicts.map(item => item.profileName).filter(Boolean))];
    throw new Error(names.length
      ? `可用数量不足，相关占用来自“${names.join('、')}”。请先取消旧配装。`
      : '当前库存数量不足，不能确认这套配装。');
  }
  const sourceRecord = workspace.profiles.find(item => item.id === profileId);
  if (!sourceRecord) throw new Error('找不到当前目标方案。');
  const existingName = sourceRecord.confirmed?.displayName;
  const baseName = sourceRecord.profile.name.trim() || '未命名方案';
  const usedNames = new Set(workspace.profiles.flatMap(item =>
    item.id === profileId || !item.confirmed ? [] : [item.confirmed.displayName ?? item.profile.name]));
  let displayName = existingName ?? baseName;
  let suffix = 1;
  while (!existingName && usedNames.has(displayName)) displayName = `${baseName} -${suffix++}`;
  const confirmed: ConfirmedLoadout = {
    displayName,
    sourceProfileName: sourceRecord.profile.name,
    profileSnapshot: sourceRecord.profile,
    resultSignature: result.signature,
    inventoryFingerprint: currentInventoryFingerprint,
    instanceKeys: [],
    groupReservations: countReservations(result.selected),
    result,
    confirmedAt: nowIso()
  };
  return replaceStoredProfile(workspace, profileId, current => ({ ...current, confirmed }));
}

export function confirmedFactorCount(confirmed: ConfirmedLoadout): number {
  return confirmed.groupReservations
    ? confirmed.groupReservations.reduce((sum, item) => sum + item.count, 0)
    : confirmed.instanceKeys.length;
}

export function confirmedMissingFactorCount(
  confirmed: ConfirmedLoadout,
  inventory: ImportedInventory
): number {
  if (confirmed.groupReservations) {
    return reservationShortfall(inventory.sigils, confirmed.groupReservations);
  }
  const current = new Set(inventory.sigils.map(factorInstanceKey));
  return confirmed.instanceKeys.filter(key => !current.has(key)).length;
}

export function confirmedAllocationShortfall(
  workspace: WorkspaceState,
  profileId: string,
  inventory: ImportedInventory
): number {
  const record = workspace.profiles.find(item => item.id === profileId);
  if (!record?.confirmed) return 0;
  let ownReservations = record.confirmed.groupReservations;
  if (!ownReservations) {
    const inventoryByInstance = new Map(inventory.sigils.map(sigil =>
      [factorInstanceKey(sigil), sigil] as const));
    const resolved = record.confirmed.instanceKeys.flatMap(key => {
      const sigil = inventoryByInstance.get(key);
      return sigil ? [sigil] : [];
    });
    const physicallyMissing = record.confirmed.instanceKeys.length - resolved.length;
    if (physicallyMissing > 0) return physicallyMissing;
    ownReservations = countReservations(resolved);
  }
  const totals = new Map(groupInventory(inventory.sigils)
    .map(group => [group.groupKey, group.count] as const));
  const allReservations = resolveReservationState(workspace, inventory).reservations;
  const overbooked = new Map(allReservations.flatMap(item => {
    const shortage = item.count - (totals.get(item.groupKey) ?? 0);
    return shortage > 0 ? [[item.groupKey, shortage] as const] : [];
  }));
  return ownReservations.reduce(
    (sum, item) => sum + Math.min(item.count, overbooked.get(item.groupKey) ?? 0),
    0
  );
}

export function releaseConfirmedResult(workspace: WorkspaceState, profileId: string): WorkspaceState {
  return replaceStoredProfile(workspace, profileId, current => {
    const { confirmed: _confirmed, ...remaining } = current;
    return remaining;
  });
}

export function cacheUsesAny(cache: CachedAnalysis | undefined, instanceKeys: ReadonlySet<string>): boolean {
  if (!cache) return false;
  const results = [
    ...cache.analysis.results,
    ...Object.values(cache.manualResults ?? {})
  ];
  return results.some(result => result.selected.some(sigil => instanceKeys.has(factorInstanceKey(sigil))));
}
