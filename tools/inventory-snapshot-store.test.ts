import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InventorySnapshotStore } from '../desktop/src/main/inventory-snapshot-store.ts';
import { factorGroupKey } from '../desktop/src/domain/inventory-groups.ts';
import type { ParsedInventory } from '../desktop/src/shared/contracts.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'gbfr-inventory-snapshot-test-'));
const filePath = path.join(root, 'inventory-snapshot.v1.json');
const sourcePath = path.join(root, 'SaveData1.dat');
const inventory: ParsedInventory = {
  inventoryId: 'fixture-inventory',
  parserVersion: 'test-parser',
  saveFormatVersion: 'test-format',
  diagnostics: [],
  sigils: [{
    gemUnitId: 1,
    inventorySlotId: 4,
    sigilHash: 2,
    sigilLevel: 15,
    primaryTraitHash: 3,
    primaryLevel: 15,
    secondaryTraitHash: 4,
    secondaryLevel: 11,
    flags: 0,
    wornByCharacterId: null
  }]
};

const store = new InventorySnapshotStore(filePath);
assert.equal(await store.load(), null);
const saved = await store.save(sourcePath, 'SaveData1.dat', inventory);
assert.equal(saved.sourceDisplayName, 'SaveData1.dat');
assert.equal(saved.stocks.length, 1);
assert.equal(saved.stocks[0]?.count, 1);
assert.equal(saved.stocks[0]?.groupKey, factorGroupKey(inventory.sigils[0]!));
assert.equal(await store.getLastSourcePath(), sourcePath);

const restored = await new InventorySnapshotStore(filePath).load();
assert.deepEqual(restored, saved);
const disk = JSON.parse(await readFile(filePath, 'utf8'));
assert.equal(disk.schemaVersion, 2);
assert.equal(disk.sourcePath, sourcePath);
assert.equal(disk.inventory.sourceDisplayName, undefined, 'public metadata must not be nested in engine inventory');
assert.equal(JSON.stringify(disk).includes('inventorySlotId'), false, 'physical save positions must not be persisted');

await writeFile(filePath, JSON.stringify({
  schemaVersion: 1,
  sourcePath,
  sourceDisplayName: 'SaveData1.dat',
  cachedAt: new Date(0).toISOString(),
  inventory
}));
const migratedLegacy = await new InventorySnapshotStore(filePath).load();
assert.equal(migratedLegacy?.stocks.length, 1);
assert.equal(migratedLegacy?.stocks[0]?.count, 1);

await writeFile(filePath, JSON.stringify({
  schemaVersion: 1,
  sourcePath,
  sourceDisplayName: 'SaveData1.dat',
  cachedAt: new Date(0).toISOString(),
  inventory: { ...inventory, sigils: [inventory.sigils[0], inventory.sigils[0]] }
}));
assert.equal(
  await new InventorySnapshotStore(filePath).load(),
  null,
  'legacy snapshots must not inflate counts by repeating one physical row'
);

await writeFile(filePath, '{"schemaVersion":1,"sourcePath":"relative"}');
assert.equal(await new InventorySnapshotStore(filePath).load(), null, 'malformed cache must be ignored');

await rm(root, { recursive: true });
process.stdout.write('Inventory snapshot cache restores grouped stock data without reopening the source save.\n');
