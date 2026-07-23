import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const releaseRoot = path.join(repositoryRoot, 'release');
const artifacts = [
  {
    source: path.join(repositoryRoot, 'desktop/out/make/zip/win32/x64/Sigil Compass-win32-x64-0.1.0.zip'),
    name: 'Sigil-Compass-0.1.0-win-x64-portable.zip'
  },
  {
    source: path.join(repositoryRoot, 'desktop/out/make/zip/darwin/arm64/Sigil Compass-darwin-arm64-0.1.0.zip'),
    name: 'Sigil-Compass-0.1.0-macos-arm64.zip'
  }
];

await mkdir(releaseRoot, { recursive: true });
const sums = [];
for (const artifact of artifacts) {
  const destination = path.join(releaseRoot, artifact.name);
  await copyFile(artifact.source, destination);
  const bytes = await readFile(destination);
  sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${artifact.name}`);
}
await writeFile(path.join(releaseRoot, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
console.log(sums.join('\n'));
