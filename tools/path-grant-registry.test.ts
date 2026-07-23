import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_IMPORT_FILE_BYTES,
  PathGrantRegistry
} from '../desktop/src/main/path-grant-registry.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'gbfr-grant-test-'));
const filePath = path.join(root, 'SaveData1.dat');
await writeFile(filePath, 'fixture'.repeat(16));
const registry = new PathGrantRegistry();
const grants = [];
for (let index = 0; index < 10; index++) {
  grants.push(await registry.create(7, filePath, 1_000 + index));
}
await assert.rejects(() => registry.consume(7, grants[0]!.grantId, 'importInventory', 2_000));
await assert.rejects(() => registry.consume(7, grants[1]!.grantId, 'importInventory', 2_000));
assert.equal(
  await registry.consume(7, grants.at(-1)!.grantId, 'importInventory', 2_000),
  await realpath(filePath));

const expired = await registry.create(8, filePath, 1_000);
await assert.rejects(() => registry.consume(8, expired.grantId, 'importInventory', 1_000 + 10 * 60 * 1000 + 1));

const oversizedPath = path.join(root, 'Oversized.dat');
await writeFile(oversizedPath, 'fixture');
await truncate(oversizedPath, MAX_IMPORT_FILE_BYTES + 1);
await assert.rejects(
  () => registry.create(9, oversizedPath),
  /desktop\.grant\.file_size_invalid/
);
await rm(root, { recursive: true });
process.stdout.write('Path grants are owner-bound, expiring, count-bounded and size-bounded.\n');
