import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const ridMap = {
  'darwin-arm64': 'osx-arm64',
  'darwin-x64': 'osx-x64',
  'win32-x64': 'win-x64'
};
const ridArgumentIndex = process.argv.indexOf('--rid');
const rid = ridArgumentIndex >= 0 ? process.argv[ridArgumentIndex + 1] : ridMap[`${process.platform}-${process.arch}`];
if (!rid || !Object.values(ridMap).includes(rid)) throw new Error(`Unsupported target RID: ${rid ?? 'missing'}`);

const desktopRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(desktopRoot, '..');
const stagingRoot = path.join(desktopRoot, '.artifacts', 'staging', rid);
const engineRoot = path.join(desktopRoot, '.artifacts', 'engine');
const outputDirectory = path.join(engineRoot, rid);
const projects = [
  ['host', path.join(repositoryRoot, 'src', 'GBFRTool.Engine.Host', 'GBFRTool.Engine.Host.csproj')],
  ['worker', path.join(repositoryRoot, 'src', 'GBFRTool.SaveReader.Worker', 'GBFRTool.SaveReader.Worker.csproj')]
];

await rm(stagingRoot, { recursive: true, force: true });
// Forge copies the complete engine resource directory. Keeping only the active
// RID avoids shipping another platform's runtime in a portable package.
await rm(engineRoot, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const [name, projectPath] of projects) {
  const projectOutput = path.join(stagingRoot, name);
  await run('dotnet', [
    'publish', projectPath, '-c', 'Release', '-r', rid,
    '--self-contained', 'true', '-o', projectOutput
  ]);
  await mergeDirectory(projectOutput, outputDirectory);
}

const isWindows = rid.startsWith('win-');
const engineFile = isWindows ? 'GBFRTool.Engine.Host.exe' : 'GBFRTool.Engine.Host';
const workerFile = isWindows ? 'GBFRTool.SaveReader.Worker.exe' : 'GBFRTool.SaveReader.Worker';
const files = [];
for (const relativePath of await listFiles(outputDirectory)) {
  const absolutePath = path.join(outputDirectory, relativePath);
  const bytes = await readFile(absolutePath);
  files.push({
    path: relativePath.split(path.sep).join('/'),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  });
}
const manifest = { schemaVersion: 2, rid, engineFile, workerFile, files };
await writeFile(path.join(outputDirectory, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await rm(stagingRoot, { recursive: true, force: true });

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: 'inherit',
      env: { ...process.env, DOTNET_ROLL_FORWARD: 'Major' }
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function mergeDirectory(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: true });
      await mergeDirectory(sourcePath, destinationPath);
      continue;
    }
    try {
      const existing = await readFile(destinationPath);
      const incoming = await readFile(sourcePath);
      if (!existing.equals(incoming)) throw new Error(`Conflicting publish file: ${entry.name}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await cp(sourcePath, destinationPath, { preserveTimestamps: true });
      const metadata = await stat(sourcePath);
      if ((metadata.mode & 0o111) !== 0) await import('node:fs/promises').then(fs => fs.chmod(destinationPath, metadata.mode));
    }
  }
}

async function listFiles(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, relativePath));
    else result.push(relativePath);
  }
  return result.sort();
}
