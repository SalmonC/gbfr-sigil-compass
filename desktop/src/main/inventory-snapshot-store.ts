import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DesktopDiagnostic, FactorStock, ImportedInventory, ParsedInventory, RawSigil
} from '../shared/contracts';

const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_SIGILS = 20_000;

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

function stockGroupKey(
  sigil: Pick<RawSigil, 'primaryTraitHash' | 'secondaryTraitHash' | 'sigilLevel'>
): string {
  return `group-v1:${hex(sigil.primaryTraitHash)}:${hex(sigil.secondaryTraitHash)}:lv${sigil.sigilLevel}`;
}

function aggregateRawInventory(sigils: readonly RawSigil[]): FactorStock[] {
  const grouped = new Map<string, FactorStock>();
  for (const sigil of sigils) {
    const groupKey = stockGroupKey(sigil);
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

interface StoredInventorySnapshot {
  readonly schemaVersion: 2;
  readonly sourcePath: string;
  readonly sourceDisplayName: string;
  readonly cachedAt: string;
  readonly inventory: ImportedInventory;
}

interface LegacyStoredInventorySnapshot {
  readonly schemaVersion: 1;
  readonly sourcePath: string;
  readonly sourceDisplayName: string;
  readonly cachedAt: string;
  readonly inventory: ParsedInventory;
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

function isFactorStock(value: unknown): value is FactorStock {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<FactorStock>;
  return typeof item.groupKey === 'string'
    && item.groupKey.length <= 160
    && isInteger(item.primaryTraitHash)
    && isInteger(item.secondaryTraitHash)
    && isInteger(item.sigilLevel)
    && isInteger(item.count) && item.count > 0 && item.count <= MAX_SIGILS
    && isInteger(item.wornCount) && item.wornCount >= 0 && item.wornCount <= item.count
    && item.groupKey === stockGroupKey({
      primaryTraitHash: item.primaryTraitHash,
      secondaryTraitHash: item.secondaryTraitHash,
      sigilLevel: item.sigilLevel
    });
}

function parseSnapshot(value: unknown): StoredInventorySnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StoredInventorySnapshot>;
  const inventory = record.inventory;
  if (record.schemaVersion !== 2
    || typeof record.sourcePath !== 'string' || !path.isAbsolute(record.sourcePath)
    || typeof record.sourceDisplayName !== 'string' || record.sourceDisplayName.length > 255
    || typeof record.cachedAt !== 'string'
    || !inventory || typeof inventory !== 'object'
    || typeof inventory.inventoryId !== 'string'
    || typeof inventory.parserVersion !== 'string'
    || typeof inventory.saveFormatVersion !== 'string'
    || !Array.isArray(inventory.stocks) || inventory.stocks.length > MAX_SIGILS
    || inventory.stocks.some(item => !isFactorStock(item))
    || new Set(inventory.stocks.map(stock => stock.groupKey)).size !== inventory.stocks.length
    || inventory.stocks.reduce((sum, stock) => sum + stock.count, 0) > MAX_SIGILS
    || !Array.isArray(inventory.diagnostics) || inventory.diagnostics.some(item => !isDiagnostic(item))) {
    return null;
  }
  return record as StoredInventorySnapshot;
}

function parseLegacySnapshot(value: unknown): LegacyStoredInventorySnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<LegacyStoredInventorySnapshot>;
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
    || new Set(inventory.sigils.map(item =>
      `${item.gemUnitId}:${item.inventorySlotId}`)).size !== inventory.sigils.length
    || !Array.isArray(inventory.diagnostics) || inventory.diagnostics.some(item => !isDiagnostic(item))) {
    return null;
  }
  return record as LegacyStoredInventorySnapshot;
}

function migrateLegacySnapshot(record: LegacyStoredInventorySnapshot): StoredInventorySnapshot {
  return {
    schemaVersion: 2,
    sourcePath: record.sourcePath,
    sourceDisplayName: record.sourceDisplayName,
    cachedAt: record.cachedAt,
    inventory: {
      inventoryId: record.inventory.inventoryId,
      parserVersion: record.inventory.parserVersion,
      saveFormatVersion: record.inventory.saveFormatVersion,
      stocks: aggregateRawInventory(record.inventory.sigils),
      diagnostics: record.inventory.diagnostics
    }
  };
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
    inventory: ParsedInventory
  ): Promise<ImportedInventory> {
    const cachedAt = new Date().toISOString();
    const record: StoredInventorySnapshot = {
      schemaVersion: 2,
      sourcePath: path.resolve(sourcePath),
      sourceDisplayName: path.basename(sourceDisplayName),
      cachedAt,
      inventory: {
        inventoryId: inventory.inventoryId,
        parserVersion: inventory.parserVersion,
        saveFormatVersion: inventory.saveFormatVersion,
        stocks: aggregateRawInventory(inventory.sigils),
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
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.cachedRecord = parseSnapshot(parsed)
        ?? ((legacy => legacy ? migrateLegacySnapshot(legacy) : null)(parseLegacySnapshot(parsed)));
    } catch {
      this.cachedRecord = null;
    }
    return this.cachedRecord;
  }
}
