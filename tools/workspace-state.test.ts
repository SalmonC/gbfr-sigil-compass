import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  cacheAnalysis, confirmedAllocationShortfall, confirmedMissingFactorCount, confirmResult,
  createAnalysisContext, createWorkspace, findReservationConflicts,
  getCacheStatus, pruneInvalidAnalysisCaches, releaseConfirmedResult, updateStoredDraft,
  storeManualResult, type WorkspaceState
} from '../desktop/src/domain/workspace-store.ts';
import { factorInstanceKey, factorFingerprint } from '../desktop/src/domain/inventory-identity.ts';
import {
  countReservations, excludeReservations, factorGroupKey, groupInventory,
  reservationShortfall
} from '../desktop/src/domain/inventory-groups.ts';
import {
  evaluateAdjustedResult, hasSamePhysicalSelection
} from '../desktop/src/domain/result-adjustment.ts';
import {
  dedupeEquivalentResults, resultEquivalenceKey, searchFactorGroupKey, targetTraitHashes
} from '../desktop/src/domain/result-equivalence.ts';
import { initialAnalysisRunState, reduceAnalysisState } from '../desktop/src/domain/analysis-state.ts';
import type { BuildProfile, CatalogData, SolverAnalysis, SolverResult } from '../desktop/src/domain/models.ts';
import type { ImportedInventory, RawSigil } from '../desktop/src/shared/contracts.ts';

const catalog = JSON.parse(await readFile(new URL('../data/catalog/catalog.zh-CN.json', import.meta.url), 'utf8')) as CatalogData;
const profile = JSON.parse(await readFile(new URL('../data/fixtures/screenshot-profile.json', import.meta.url), 'utf8')) as BuildProfile;
const sigil = (gemUnitId: number, slot: number, level = 15): RawSigil => ({
  gemUnitId, inventorySlotId: slot, sigilHash: 1, sigilLevel: level,
  primaryTraitHash: 0xa7726190, primaryLevel: 15,
  secondaryTraitHash: 0x02000000, secondaryLevel: 15,
  flags: 0, wornByCharacterId: null
});
const inventory: ImportedInventory = {
  inventoryId: 'test', parserVersion: 'test', saveFormatVersion: 'test', diagnostics: [],
  sigils: [sigil(30001, 1), sigil(30002, 2)]
};
const result = (selected: RawSigil[]): SolverResult => ({
  selected, signature: selected.map(factorFingerprint).join('|'), mandatorySatisfied: true,
  primaryMatched: 0, primaryRequired: 0, exactPrimaryCoverage: [],
  basicSubstitutionUsage: [], optionalMatched: 0, optionalCoverage: [], avoidOccurrences: 0,
  usedSlots: selected.length, levelSum: selected.reduce((sum, item) => sum + item.sigilLevel, 0),
  tieA: 0, tieB: 0
});
const analysis: SolverAnalysis = { status: 'completed', results: [result([inventory.sigils[0]!])], candidateTypeCount: 1, exploredStateCount: 1 };
let workspace: WorkspaceState = {
  schemaVersion: 4,
  activeProfileId: 'one',
  profiles: [
    { id: 'one', profile: { ...profile, name: '角色一' }, updatedAt: new Date(0).toISOString() },
    { id: 'two', profile: { ...profile, name: '角色二' }, updatedAt: new Date(0).toISOString() }
  ]
};

const contextOne = createAnalysisContext(workspace.profiles[0]!.profile, 'one', inventory, workspace);
workspace = cacheAnalysis(workspace, 'one', contextOne, 1, analysis);
assert.equal(getCacheStatus(workspace.profiles[0]!.cache, contextOne), 'current');
const manualCachedResult = { ...analysis.results[0]!, signature: 'manual-v1:test', manuallyAdjusted: true };
workspace = storeManualResult(workspace, 'one', analysis.results[0]!.signature, manualCachedResult);
assert.equal(
  workspace.profiles[0]!.cache?.manualResults?.[analysis.results[0]!.signature]?.signature,
  'manual-v1:test'
);
workspace = storeManualResult(workspace, 'one', analysis.results[0]!.signature, undefined);
assert.equal(workspace.profiles[0]!.cache?.manualResults, undefined);

const renamed = updateStoredDraft(
  workspace, 'one', { ...workspace.profiles[0]!.profile, name: '只改名称' });
assert.ok(renamed.profiles[0]!.cache, 'renaming must retain a reusable analysis');
const retargeted = updateStoredDraft(
  renamed, 'one', {
    ...renamed.profiles[0]!.profile,
    optional: [...renamed.profiles[0]!.profile.optional, renamed.profiles[0]!.profile.optional[0]!]
  });
assert.equal(retargeted.profiles[0]!.cache, undefined, 'changing compute inputs must delete the stale analysis');

const changedInventory: ImportedInventory = {
  ...inventory,
  sigils: [inventory.sigils[0]!, sigil(30003, 3)]
};
const prunedInventory = pruneInvalidAnalysisCaches(workspace, changedInventory);
assert.equal(
  prunedInventory.profiles[0]!.cache,
  undefined,
  'loading a different inventory must physically remove stale analysis data'
);

const unrelatedReservationContext = {
  ...contextOne,
  excludedInstancesFingerprint: 'different',
  excludedInstanceKeys: ['unrelated-physical-instance']
};
assert.equal(
  getCacheStatus(workspace.profiles[0]!.cache, unrelatedReservationContext),
  'allocations-changed',
  'any grouped reservation change must conservatively invalidate the cache'
);

const selectedInstanceKey = factorInstanceKey(analysis.results[0]!.selected[0]!);
const overlappingReservationContext = {
  ...contextOne,
  excludedInstancesFingerprint: 'different-again',
  excludedInstanceKeys: [selectedInstanceKey]
};
assert.equal(
  getCacheStatus(workspace.profiles[0]!.cache, overlappingReservationContext),
  'allocations-changed',
  'reserving an instance used by a cached result must invalidate the cache'
);

workspace = confirmResult(
  workspace, 'one', analysis.results[0]!, contextOne.inventoryFingerprint, inventory);
assert.deepEqual(workspace.profiles[0]!.confirmed?.groupReservations, [
  { groupKey: factorGroupKey(inventory.sigils[0]!), count: 1 }
]);
assert.deepEqual(workspace.profiles[0]!.confirmed?.instanceKeys, []);
const contextTwo = createAnalysisContext(workspace.profiles[1]!.profile, 'two', inventory, workspace);
assert.deepEqual(contextTwo.availableInventory.map(factorInstanceKey), [factorInstanceKey(inventory.sigils[1]!)]);
assert.equal(findReservationConflicts(
  workspace, 'two', result([inventory.sigils[0]!, inventory.sigils[1]!]), inventory).length, 1);
assert.throws(() => confirmResult(
  workspace,
  'two',
  result([inventory.sigils[0]!, inventory.sigils[1]!]),
  contextTwo.inventoryFingerprint,
  inventory
));
workspace = releaseConfirmedResult(workspace, 'one');
assert.equal(findReservationConflicts(
  workspace, 'two', result([inventory.sigils[0]!]), inventory).length, 0);

const groupedInventory = groupInventory(inventory.sigils);
assert.equal(groupedInventory.length, 1);
assert.equal(groupedInventory[0]!.count, 2);
assert.deepEqual(countReservations(inventory.sigils), [
  { groupKey: factorGroupKey(inventory.sigils[0]!), count: 2 }
]);
assert.equal(excludeReservations(inventory.sigils, [
  { groupKey: factorGroupKey(inventory.sigils[0]!), count: 1 }
]).length, 1);
assert.equal(reservationShortfall(inventory.sigils, [
  { groupKey: factorGroupKey(inventory.sigils[0]!), count: 3 }
]), 1);
assert.equal(groupInventory([sigil(30004, 4, 11), sigil(30005, 5, 15)]).length, 2);
const oneFactorInventory = { ...inventory, sigils: [inventory.sigils[0]!] };
assert.throws(() => confirmResult(
  workspace,
  'two',
  result([inventory.sigils[0]!, inventory.sigils[1]!]),
  'inventory',
  oneFactorInventory
), 'a request that exceeds inventory must fail even without another confirmed profile');

let namingWorkspace: WorkspaceState = {
  schemaVersion: 4,
  activeProfileId: 'name-one',
  profiles: [
    { id: 'name-one', profile: { ...profile, name: '同名方案' }, updatedAt: new Date(0).toISOString() },
    { id: 'name-two', profile: { ...profile, name: '同名方案 -1' }, updatedAt: new Date(0).toISOString() },
    { id: 'name-three', profile: { ...profile, name: '同名方案' }, updatedAt: new Date(0).toISOString() }
  ]
};
const namingSigils = [sigil(31001, 11), sigil(31002, 12), sigil(31003, 13)];
const namingInventory: ImportedInventory = { ...inventory, sigils: namingSigils };
namingWorkspace = confirmResult(
  namingWorkspace, 'name-one', result([namingSigils[0]!]), 'inventory', namingInventory);
namingWorkspace = confirmResult(
  namingWorkspace, 'name-two', result([namingSigils[1]!]), 'inventory', namingInventory);
namingWorkspace = confirmResult(
  namingWorkspace, 'name-three', result([namingSigils[2]!]), 'inventory', namingInventory);
assert.deepEqual(
  namingWorkspace.profiles.map(item => item.confirmed?.displayName),
  ['同名方案', '同名方案 -1', '同名方案 -2']
);
assert.equal(namingWorkspace.profiles[0]!.confirmed?.profileSnapshot?.name, '同名方案');
assert.equal(namingWorkspace.profiles[0]!.confirmed?.result?.selected[0]?.gemUnitId, 31001);
assert.equal(confirmedMissingFactorCount(
  namingWorkspace.profiles[0]!.confirmed!,
  { ...namingInventory, sigils: [sigil(31999, 999)] }
), 0, 'moving an interchangeable factor to another physical slot must not break confirmation');
const reducedNamingInventory = { ...namingInventory, sigils: namingSigils.slice(0, 2) };
assert.equal(confirmedAllocationShortfall(
  namingWorkspace, 'name-one', reducedNamingInventory), 1);
assert.equal(confirmedAllocationShortfall(
  namingWorkspace, 'name-two', reducedNamingInventory), 1);
assert.equal(confirmedAllocationShortfall(
  namingWorkspace, 'name-three', reducedNamingInventory), 1);
assert.throws(() => confirmResult(
  namingWorkspace,
  'name-one',
  result([namingSigils[0]!, namingSigils[1]!]),
  'inventory',
  namingInventory
), 'a replacement must not exceed total inventory after returning its own old allocation');

const testTraits = catalog.traits.slice(0, 5);
assert.equal(testTraits.length, 5);
const traitHash = (index: number) => Number.parseInt(testTraits[index]!.hash.slice(2), 16) >>> 0;
const positionedSigil = (
  id: number,
  slot: number,
  primaryHash: number,
  secondaryHash: number,
  level = 15
): RawSigil => ({
  gemUnitId: id,
  inventorySlotId: slot,
  sigilHash: id,
  sigilLevel: level,
  primaryTraitHash: primaryHash,
  primaryLevel: level,
  secondaryTraitHash: secondaryHash,
  secondaryLevel: level,
  flags: 0,
  wornByCharacterId: null
});
const manualProfile: BuildProfile = {
  ...profile,
  mandatory: [testTraits[0]!.id],
  basicPrimary: [],
  forceBasicPrimary: false,
  allowBasicSubstitution: false,
  basicSubstitutionOrder: [],
  attackPrimary: [],
  forceAttackPrimary: false,
  defensePrimary: [],
  forceDefensePrimary: false,
  optional: [testTraits[2]!.id],
  forbidden: [testTraits[4]!.id],
  avoid: [testTraits[3]!.id]
};
const positionedOne = [
  positionedSigil(40001, 21, traitHash(0), traitHash(2)),
  positionedSigil(40002, 22, traitHash(1), traitHash(3))
];
const adjusted = evaluateAdjustedResult(result([]), manualProfile, catalog, positionedOne);
assert.equal(adjusted.mandatorySatisfied, true);
assert.equal(adjusted.optionalMatched, 1);
assert.equal(adjusted.avoidOccurrences, 1);
assert.equal(adjusted.manuallyAdjusted, true);
assert.equal(
  evaluateAdjustedResult(result([]), manualProfile, catalog, positionedOne.slice(1)).mandatorySatisfied,
  false
);
assert.throws(() => confirmResult(
  workspace,
  'one',
  evaluateAdjustedResult(result([]), manualProfile, catalog, positionedOne.slice(1)),
  'inventory',
  { ...inventory, sigils: positionedOne }
));
assert.equal(hasSamePhysicalSelection(positionedOne, [...positionedOne].reverse()), true);

const positionedTwo = [
  positionedSigil(40003, 23, traitHash(0), traitHash(2)),
  positionedSigil(40004, 24, traitHash(1), traitHash(4))
];
const movedUnmatchedPosition = [
  positionedSigil(40005, 25, traitHash(0), traitHash(3)),
  positionedSigil(40006, 26, traitHash(1), traitHash(2))
];
const targetHashes = targetTraitHashes(manualProfile, catalog);
const equivalentOne = { ...adjusted, selected: positionedOne, avoidOccurrences: 0 };
const equivalentTwo = { ...adjusted, selected: positionedTwo, avoidOccurrences: 0 };
const differentPosition = { ...adjusted, selected: movedUnmatchedPosition, avoidOccurrences: 0 };
assert.equal(resultEquivalenceKey(equivalentOne, targetHashes), resultEquivalenceKey(equivalentTwo, targetHashes));
assert.notEqual(resultEquivalenceKey(equivalentOne, targetHashes), resultEquivalenceKey(differentPosition, targetHashes));
assert.deepEqual(dedupeEquivalentResults(
  [equivalentOne, equivalentTwo, differentPosition], targetHashes), [equivalentOne, differentPosition]);
assert.equal(
  searchFactorGroupKey(positionedOne[1]!, targetHashes, new Set()),
  searchFactorGroupKey(positionedTwo[1]!, targetHashes, new Set())
);

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage });
memoryStorage.setItem('gbfr-factor-planner.workspace.v3', JSON.stringify({
  schemaVersion: 3,
  activeProfileId: 'legacy',
  profiles: [{
    id: 'legacy',
    profile,
    updatedAt: new Date(0).toISOString(),
    cache: workspace.profiles[0]?.cache,
    confirmed: {
      resultSignature: analysis.results[0]!.signature,
      inventoryFingerprint: 'legacy-inventory',
      instanceKeys: [factorInstanceKey(inventory.sigils[0]!)],
      result: analysis.results[0],
      confirmedAt: new Date(0).toISOString()
    }
  }]
}));
const migratedWorkspace = createWorkspace(catalog, profile);
assert.equal(migratedWorkspace.schemaVersion, 4);
assert.equal(migratedWorkspace.profiles[0]!.cache, undefined);
assert.deepEqual(migratedWorkspace.profiles[0]!.confirmed?.groupReservations, [
  { groupKey: factorGroupKey(inventory.sigils[0]!), count: 1 }
]);
const legacyWithoutResult: WorkspaceState = {
  schemaVersion: 4,
  activeProfileId: 'legacy',
  profiles: [
    {
      id: 'legacy',
      profile: { ...profile, name: '旧配装' },
      updatedAt: new Date(0).toISOString(),
      confirmed: {
        resultSignature: 'legacy',
        inventoryFingerprint: 'legacy',
        instanceKeys: [factorInstanceKey(inventory.sigils[0]!)],
        confirmedAt: new Date(0).toISOString()
      }
    },
    { id: 'new', profile, updatedAt: new Date(0).toISOString() }
  ]
};
const resolvedLegacyContext = createAnalysisContext(profile, 'new', inventory, legacyWithoutResult);
assert.equal(resolvedLegacyContext.unresolvedLegacyReservationProfiles.length, 0);
assert.equal(resolvedLegacyContext.availableInventory.length, 1);
const mixedLegacyWorkspace: WorkspaceState = {
  ...legacyWithoutResult,
  profiles: [
    legacyWithoutResult.profiles[0]!,
    {
      ...legacyWithoutResult.profiles[1]!,
      confirmed: {
        resultSignature: 'new',
        inventoryFingerprint: 'new',
        instanceKeys: [],
        groupReservations: [{
          groupKey: factorGroupKey(inventory.sigils[0]!),
          count: 1
        }],
        result: result([inventory.sigils[1]!]),
        confirmedAt: new Date(0).toISOString()
      }
    }
  ]
};
assert.equal(confirmedAllocationShortfall(
  mixedLegacyWorkspace, 'legacy', oneFactorInventory), 1);
assert.equal(confirmedAllocationShortfall(
  mixedLegacyWorkspace, 'new', oneFactorInventory), 1);
const movedLegacyInventory = {
  ...inventory,
  sigils: [sigil(32001, 101), sigil(32002, 102)]
};
const unresolvedLegacyContext = createAnalysisContext(
  profile, 'new', movedLegacyInventory, legacyWithoutResult);
assert.deepEqual(unresolvedLegacyContext.unresolvedLegacyReservationProfiles, ['旧配装']);
assert.equal(unresolvedLegacyContext.availableInventory.length, 0);
assert.throws(() => confirmResult(
  legacyWithoutResult,
  'new',
  result([movedLegacyInventory.sigils[0]!]),
  'inventory',
  movedLegacyInventory
));

let machine = reduceAnalysisState(initialAnalysisRunState, { type: 'start', requestKey: 'A' });
const firstRun = machine.runId;
machine = reduceAnalysisState(machine, { type: 'invalidate', message: '目标已修改。' });
machine = reduceAnalysisState(machine, { type: 'resolve', runId: firstRun, requestKey: 'A' });
assert.equal(machine.phase, 'stale');
machine = reduceAnalysisState(machine, { type: 'start', requestKey: 'B' });
assert.equal(reduceAnalysisState(machine, { type: 'resolve', runId: firstRun, requestKey: 'A' }).phase, 'running');

assert.equal(catalog.gameVersion, '2.0.2');
process.stdout.write('Workspace cache, grouped reservations and analysis state transitions passed.\n');
