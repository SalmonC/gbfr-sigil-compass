import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

const rid = process.platform === 'darwin' ? `osx-${process.arch}` : `win-${process.arch}`;
const extension = process.platform === 'win32' ? '.exe' : '';
const enginePath = path.resolve(import.meta.dirname, '..', '.artifacts', 'engine', rid, `GBFRTool.Engine.Host${extension}`);
const savePath = process.env.GBFR_TEST_SAVE;
if (!savePath) throw new Error('Set GBFR_TEST_SAVE to a read-only SaveData*.dat fixture.');

const child = spawn(enginePath, [], {
  cwd: path.dirname(enginePath),
  shell: false,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { LANG: 'zh_CN.UTF-8', GBFR_ENGINE_MANIFEST_SHA256: 'integration-test' }
});
const reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
const responses = [];
reader.on('line', line => responses.push(JSON.parse(line)));

send('engine.hello', {});
send('inventory.import', { snapshotPath: savePath });
child.stdin.end();
await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Engine exited ${code}`)));
});

const inventory = responses.find(response => response.messageType === 'inventory.import.ok')?.payload;
if (!inventory || inventory.sigils.length !== 401 || inventory.parserVersion !== 'gbfr-readonly-flatbuffer-v2') {
  throw new Error(`Unexpected import response: ${JSON.stringify(inventory)}`);
}
if (inventory.sigils[0].gemUnitId === inventory.sigils[0].inventorySlotId) {
  throw new Error('Gem UnitID and inventory slot ID were incorrectly collapsed.');
}
console.log(`Engine/Worker integration passed: ${inventory.sigils.length} V+ sigils.`);

function send(messageType, payload) {
  const requestId = crypto.randomUUID().replaceAll('-', '');
  child.stdin.write(`${JSON.stringify({
    protocolVersion: 1,
    messageType,
    requestId,
    correlationId: requestId,
    payload
  })}\n`);
}
