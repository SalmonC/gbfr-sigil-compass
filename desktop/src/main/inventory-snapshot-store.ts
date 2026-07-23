import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DesktopDiagnostic, ImportedInventory, RawSigil } from '../shared/contracts';

const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_SIGILS = 20_000;

interface StoredInventorySnapshot {
  readonly schemaVersion: 1;
  readonly sourcePath: string;
  readonly sourceDisplayName: string;
  readonly cachedAt: string;
  readonly inventory: ImportedInventory;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isRawSigil(value: unknown): value is RawSigil {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RawSigil>;
  return isInteger(item.gemUnitId)
    && isInteger(item.inventorySlotId)
    && isInteger(item.sigilHash)
    && isInteger(item.sigilLevel)
    && isInteger(item.primaryTraitHash)
    && isInteger(item.primaryLevel)
    && isInteger(item.secondaryTraitHash)
    && isInteger(item.secondaryLevel)
    && isInteger(item.flags)
    && (item.wornByCharacterId === null || typeof item.wornByCharacterId === 'string');
}

function isDiagnostic(value: unknown): value is DesktopDiagnostic {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DesktopDiagnostic>;
  return typeof item.severity === 'string'
    && typeof item.code === 'string'
    && typeof item.message === 'string'
    && (item.metadata === null || (!!item.metadata && typeof item.metadata === 'object'));
}

function parseSnapshot(value: unknown): StoredInventorySnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StoredInventorySnapshot>;
  const inventory = record.inventory;
  if (record.schemaVersion !== 1
    || typeof record.sourcePath !== 'string' || !path.isAbsolute(record.sourcePath)
    || typeof record.sourceDisplayName !== 'string' || record.sourceDisplayName.length > 255
    || typeof record.cachedAt !== 'string'
    || !inventory || typeof inventory !== 'object'
    || typeof inventory.inventoryId !== 'string'
    || typeof inventory.parserVersion !== 'string'
    || typeof inventory.saveFormatVersion !== 'string'
    || !Array.isArray(inventory.sigils) || inventory.sigils.length > MAX_SIGILS
    || inventory.sigils.some(item => !isRawSigil(item))
    || !Array.isArray(inventory.diagnostics) || inventory.diagnostics.some(item => !isDiagnostic(item))) {
    return null;
  }
  return record as StoredInventorySnapshot;
}

function toPublicInventory(record: StoredInventorySnapshot): ImportedInventory {
  return {
    ...record.inventory,
    sourceDisplayName: record.sourceDisplayName,
    cachedAt: record.cachedAt
  };
}

export class InventorySnapshotStore {
  private readonly filePath: string;
  private cachedRecord: StoredInventorySnapshot | null | undefined;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<ImportedInventory | null> {
    const record = await this.loadRecord();
    return record ? toPublicInventory(record) : null;
  }

  async getLastSourcePath(): Promise<string | undefined> {
    return (await this.loadRecord())?.sourcePath;
  }

  async save(
    sourcePath: string,
    sourceDisplayName: string,
    inventory: ImportedInventory
  ): Promise<ImportedInventory> {
    const cachedAt = new Date().toISOString();
    const record: StoredInventorySnapshot = {
      schemaVersion: 1,
      sourcePath: path.resolve(sourcePath),
      sourceDisplayName: path.basename(sourceDisplayName),
      cachedAt,
      inventory: {
        inventoryId: inventory.inventoryId,
        parserVersion: inventory.parserVersion,
        saveFormatVersion: inventory.saveFormatVersion,
        sigils: inventory.sigils,
        diagnostics: inventory.diagnostics
      }
    };
    if (!parseSnapshot(record)) throw new Error('desktop.inventory_snapshot.invalid');

    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);
    const temporaryPath = path.join(directory, `.inventory-snapshot-${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600).catch(() => undefined);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    this.cachedRecord = record;
    return toPublicInventory(record);
  }

  private async loadRecord(): Promise<StoredInventorySnapshot | null> {
    if (this.cachedRecord !== undefined) return this.cachedRecord;
    const metadata = await stat(this.filePath).catch(() => null);
    if (!metadata || !metadata.isFile() || metadata.size > MAX_SNAPSHOT_BYTES) {
      this.cachedRecord = null;
      return null;
    }
    try {
      this.cachedRecord = parseSnapshot(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      this.cachedRecord = null;
    }
    return this.cachedRecord;
  }
}
