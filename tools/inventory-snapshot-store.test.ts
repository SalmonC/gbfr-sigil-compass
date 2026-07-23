import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InventorySnapshotStore } from '../desktop/src/main/inventory-snapshot-store.ts';
import type { ImportedInventory } from '../desktop/src/shared/contracts.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'gbfr-inventory-snapshot-test-'));
const filePath = path.join(root, 'inventory-snapshot.v1.json');
const sourcePath = path.join(root, 'SaveData1.dat');
const inventory: ImportedInventory = {
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
assert.equal(saved.sigils.length, 1);
assert.equal(await store.getLastSourcePath(), sourcePath);

const restored = await new InventorySnapshotStore(filePath).load();
assert.deepEqual(restored, saved);
const disk = JSON.parse(await readFile(filePath, 'utf8'));
assert.equal(disk.sourcePath, sourcePath);
assert.equal(disk.inventory.sourceDisplayName, undefined, 'public metadata must not be nested in engine inventory');

await writeFile(filePath, '{"schemaVersion":1,"sourcePath":"relative"}');
assert.equal(await new InventorySnapshotStore(filePath).load(), null, 'malformed cache must be ignored');

await rm(root, { recursive: true });
process.stdout.write('Inventory snapshot cache restores parsed data without reopening the source save.\n');
