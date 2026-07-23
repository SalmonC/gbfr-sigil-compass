import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const MAX_IMPORT_FILE_BYTES = 128 * 1024 * 1024;

interface StoredGrant {
  readonly ownerId: number;
  readonly purpose: 'importInventory';
  readonly canonicalPath: string;
  readonly size: number;
  readonly deviceId: number;
  readonly inode: number;
  readonly modifiedAtMs: number;
  readonly expiresAtMs: number;
}

export interface PublicGrant {
  readonly grantId: string;
  readonly displayName: string;
  readonly size: number;
  readonly expiresAt: string;
}

export class PathGrantRegistry {
  private readonly grants = new Map<string, StoredGrant>();

  async create(ownerId: number, selectedPath: string, nowMs = Date.now()): Promise<PublicGrant> {
    this.pruneExpired(nowMs);
    const ownerGrants = [...this.grants.entries()]
      .filter(([, grant]) => grant.ownerId === ownerId)
      .sort((left, right) => left[1].expiresAtMs - right[1].expiresAtMs);
    while (ownerGrants.length >= 8) {
      const oldest = ownerGrants.shift();
      if (oldest) this.grants.delete(oldest[0]);
    }
    const canonicalPath = await realpath(selectedPath);
    const metadata = await stat(canonicalPath);
    if (!metadata.isFile()) throw new Error('desktop.grant.not_regular_file');
    if (metadata.size < 64 || metadata.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error('desktop.grant.file_size_invalid');
    }

    const grantId = randomBytes(16).toString('hex');
    const expiresAtMs = nowMs + 10 * 60 * 1000;
    this.grants.set(grantId, {
      ownerId,
      purpose: 'importInventory',
      canonicalPath,
      size: metadata.size,
      deviceId: metadata.dev,
      inode: metadata.ino,
      modifiedAtMs: metadata.mtimeMs,
      expiresAtMs
    });
    return {
      grantId,
      displayName: path.basename(canonicalPath),
      size: metadata.size,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  async consume(
    ownerId: number,
    grantId: string,
    purpose: 'importInventory',
    nowMs = Date.now()
  ): Promise<string> {
    this.pruneExpired(nowMs);
    const grant = this.grants.get(grantId);
    this.grants.delete(grantId);
    if (!grant || grant.ownerId !== ownerId || grant.purpose !== purpose || grant.expiresAtMs < nowMs) {
      throw new Error('desktop.grant.invalid_or_expired');
    }

    const canonicalPath = await realpath(grant.canonicalPath);
    const metadata = await stat(canonicalPath);
    if (canonicalPath !== grant.canonicalPath || !metadata.isFile() || metadata.size !== grant.size
      || metadata.dev !== grant.deviceId || metadata.ino !== grant.inode
      || metadata.mtimeMs !== grant.modifiedAtMs) {
      throw new Error('desktop.grant.file_changed');
    }
    if (metadata.size < 64 || metadata.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error('desktop.grant.file_size_invalid');
    }
    return canonicalPath;
  }

  revokeOwner(ownerId: number): void {
    for (const [grantId, grant] of this.grants) {
      if (grant.ownerId === ownerId) this.grants.delete(grantId);
    }
  }

  private pruneExpired(nowMs: number): void {
    for (const [grantId, grant] of this.grants) {
      if (grant.expiresAtMs < nowMs) this.grants.delete(grantId);
    }
  }
}
