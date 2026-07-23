import type { BuildProfile, CatalogData, SolverAnalysis, SolverResult } from './models';
import { loadProfiles, removeLegacyProfileStorage, validateProfile } from './profile-codec.ts';
import {
  factorInstanceKey, instanceSetFingerprint, inventoryFingerprint, profileComputeFingerprint
} from './inventory-identity.ts';
import type { ImportedInventory, RawSigil } from '../shared/contracts';

const STORAGE_KEY = 'gbfr-factor-planner.workspace.v3';
export const RANKING_VERSION = 'GBFR-RANK-3';

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
}

export interface ConfirmedLoadout {
  readonly displayName?: string;
  readonly sourceProfileName?: string;
  readonly profileSnapshot?: BuildProfile;
  readonly resultSignature: string;
  readonly inventoryFingerprint: string;
  readonly instanceKeys: readonly string[];
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
  readonly schemaVersion: 3;
  readonly activeProfileId: string;
  readonly profiles: readonly StoredProfile[];
}

export interface AnalysisContext {
  readonly profileFingerprint: string;
  readonly inventoryFingerprint: string;
  readonly excludedInstancesFingerprint: string;
  readonly excludedInstanceKeys: readonly string[];
  readonly availableInventory: readonly RawSigil[];
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
  return cache as CachedAnalysis;
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
  return { ...confirmed, result } as ConfirmedLoadout;
}

function normalizeConfirmedResult(value: unknown): SolverResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.selected) || result.selected.length > 12
    || typeof result.signature !== 'string'
    || result.mandatorySatisfied !== true
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
    mandatorySatisfied: true,
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
    tieB: result.tieB
  };
}

export function createWorkspace(catalog: CatalogData, fallback: BuildProfile): WorkspaceState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object') {
      const value = parsed as Partial<WorkspaceState>;
      if (value.schemaVersion === 3 && Array.isArray(value.profiles)) {
        const profiles = value.profiles.flatMap(item => {
          const validated = validateStoredProfile(item, catalog);
          return validated ? [validated] : [];
        });
        if (profiles.length) {
          const activeProfileId = profiles.some(item => item.id === value.activeProfileId)
            ? value.activeProfileId!
            : profiles[0]!.id;
          return { schemaVersion: 3, activeProfileId, profiles };
        }
      }
    }
  } catch {
    // Fall through to the v2 migration or bundled fixture.
  }

  const migrated = loadProfiles(catalog);
  const source = migrated.length ? migrated : [fallback];
  const profiles = source.map(profile => ({ id: newId(), profile, updatedAt: nowIso() }));
  return { schemaVersion: 3, activeProfileId: profiles[0]!.id, profiles };
}

export function storeWorkspace(workspace: WorkspaceState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
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
  return workspace.profiles.flatMap(item => item.id === exceptProfileId ? [] : (item.confirmed?.instanceKeys ?? []));
}

export function createAnalysisContext(
  profile: BuildProfile,
  profileId: string,
  inventory: ImportedInventory,
  workspace: WorkspaceState,
  knownInventoryFingerprint?: string
): AnalysisContext {
  const excludedInstanceKeys = reservedInstanceKeys(workspace, profileId).sort();
  const excluded = new Set(excludedInstanceKeys);
  const availableInventory = inventory.sigils.filter(sigil => !excluded.has(factorInstanceKey(sigil)));
  const profileFingerprint = profileComputeFingerprint(profile);
  const snapshotFingerprint = knownInventoryFingerprint ?? inventoryFingerprint(inventory.sigils);
  const excludedInstancesFingerprint = instanceSetFingerprint(excludedInstanceKeys);
  return {
    profileFingerprint,
    inventoryFingerprint: snapshotFingerprint,
    excludedInstancesFingerprint,
    excludedInstanceKeys,
    availableInventory,
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
    const cachedExcluded = new Set(Array.isArray(cache.excludedInstanceKeys) ? cache.excludedInstanceKeys : []);
    const currentExcluded = new Set(context.excludedInstanceKeys);
    const releasedSinceRun = [...cachedExcluded].some(key => !currentExcluded.has(key));
    if (releasedSinceRun) return 'allocations-changed';

    // Confirming another loadout only removes candidates. If none of the cached top
    // results uses the newly reserved physical instance, their order is unchanged.
    // Releasing a loadout is different: a newly available candidate may outrank the
    // cache, so that case remains stale until the user explicitly recalculates.
    const newlyReserved = new Set([...currentExcluded].filter(key => !cachedExcluded.has(key)));
    if (cacheUsesAny(cache, newlyReserved)) return 'allocations-changed';
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

export interface ReservationConflict {
  readonly profileId: string;
  readonly profileName: string;
  readonly instanceKeys: readonly string[];
}

export function findReservationConflicts(
  workspace: WorkspaceState,
  profileId: string,
  result: SolverResult
): ReservationConflict[] {
  const requested = new Set(result.selected.map(factorInstanceKey));
  return workspace.profiles.flatMap(item => {
    if (item.id === profileId || !item.confirmed) return [];
    const overlap = item.confirmed.instanceKeys.filter(key => requested.has(key));
    return overlap.length ? [{ profileId: item.id, profileName: item.profile.name, instanceKeys: overlap }] : [];
  });
}

export function confirmResult(
  workspace: WorkspaceState,
  profileId: string,
  result: SolverResult,
  currentInventoryFingerprint: string
): WorkspaceState {
  const conflicts = findReservationConflicts(workspace, profileId, result);
  if (conflicts.length) throw new Error(`这些因子已用于“${conflicts.map(item => item.profileName).join('、')}”。请先取消旧配装。`);
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
    instanceKeys: result.selected.map(factorInstanceKey).sort(),
    result,
    confirmedAt: nowIso()
  };
  return replaceStoredProfile(workspace, profileId, current => ({ ...current, confirmed }));
}

export function releaseConfirmedResult(workspace: WorkspaceState, profileId: string): WorkspaceState {
  return replaceStoredProfile(workspace, profileId, current => {
    const { confirmed: _confirmed, ...remaining } = current;
    return remaining;
  });
}

export function cacheUsesAny(cache: CachedAnalysis | undefined, instanceKeys: ReadonlySet<string>): boolean {
  return !!cache?.analysis.results.some(result => result.selected.some(sigil => instanceKeys.has(factorInstanceKey(sigil))));
}
