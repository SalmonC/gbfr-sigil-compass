import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const saveRoot = process.env.GBFR_SAVE_FIXTURE_DIR;
if (!saveRoot) throw new Error('Set GBFR_SAVE_FIXTURE_DIR to a local directory containing the save fixtures.');
const workerDll = path.join(
  repositoryRoot,
  'src/GBFRTool.SaveReader.Worker/bin/Release/net10.0/GBFRTool.SaveReader.Worker.dll'
);
const fixtureNames = [
  ['SaveData1.dat', 401],
  ['SaveData1_BackUp.dat', 399],
  ['SaveData1_BackUp2.dat', 399]
];

const originalHashes = new Map();
const parsed = new Map();
for (const [name, expectedCount] of fixtureNames) {
  const savePath = path.join(saveRoot, name);
  originalHashes.set(name, await sha256(savePath));
  const result = await parse(savePath);
  assert(result.saveFormatVersion === 'save-format-2.2', `${name}: unexpected format`);
  assert(result.sigils.length === expectedCount, `${name}: expected ${expectedCount} V+, got ${result.sigils.length}`);
  assert(new Set(result.sigils.map(item => item.gemUnitId)).size === result.sigils.length, `${name}: duplicate unit id`);
  assert(new Set(result.sigils.map(item => item.inventorySlotId)).size === result.sigils.length, `${name}: duplicate inventory slot id`);
  assert(result.sigils.every(item => item.primaryTraitHash && item.secondaryTraitHash), `${name}: non V+ result`);
  parsed.set(name, result);
}

const backupUnits = new Set(parsed.get('SaveData1_BackUp.dat').sigils.map(item => item.gemUnitId));
const mainOnly = parsed.get('SaveData1.dat').sigils
  .map(item => item.gemUnitId)
  .filter(unitId => !backupUnits.has(unitId))
  .sort((left, right) => left - right);
assert(mainOnly.includes(30446) && mainOnly.includes(30447), 'expected two known main-save additions');

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'gbfr-save-fixture-'));
try {
  const corruptPath = path.join(temporaryDirectory, 'corrupt.dat');
  const sourcePath = path.join(saveRoot, fixtureNames[0][0]);
  await copyFile(sourcePath, corruptPath);
  const sourceHeader = (await readFile(sourcePath)).subarray(0, 64);
  const slotOffset = Number(sourceHeader.readBigInt64LE(28));
  const corruptOffset = slotOffset + 0x100;
  const handle = await open(corruptPath, 'r+');
  try {
    const byte = Buffer.alloc(1);
    await handle.read(byte, 0, 1, corruptOffset);
    byte[0] ^= 0xff;
    await handle.write(byte, 0, 1, corruptOffset);
  } finally {
    await handle.close();
  }

  let rejected = false;
  try {
    await parse(corruptPath);
  } catch {
    rejected = true;
  }
  assert(rejected, 'checksum-corrupt fixture must fail closed');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

for (const [name] of fixtureNames) {
  const currentHash = await sha256(path.join(saveRoot, name));
  assert(currentHash === originalHashes.get(name), `${name}: source save changed during verification`);
}

console.log(`Verified ${fixtureNames.length} read-only saves, checksum rejection, and source immutability.`);

async function parse(savePath) {
  const { stdout } = await execFileAsync('dotnet', [workerDll, '--parse', savePath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, DOTNET_ROLL_FORWARD: 'Major' }
  });
  return JSON.parse(stdout);
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
