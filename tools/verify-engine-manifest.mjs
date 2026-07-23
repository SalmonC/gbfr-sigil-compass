import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

if (process.argv.length < 3) {
  throw new Error('Usage: node tools/verify-engine-manifest.mjs <engine-directory> [...]');
}

for (const root of process.argv.slice(2)) {
  const manifest = JSON.parse(await readFile(path.join(root, 'build-manifest.json'), 'utf8'));
  for (const item of manifest.files) {
    const bytes = await readFile(path.join(root, item.path));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== item.size || hash !== item.sha256) {
      throw new Error(`Manifest mismatch: ${root}/${item.path}`);
    }
  }
  console.log(`Verified ${manifest.files.length} engine files for ${manifest.rid}.`);
}
