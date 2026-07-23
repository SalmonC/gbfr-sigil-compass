import { app } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import type { EngineHello, ImportedInventory } from '../shared/contracts';

const MAX_FRAME_BYTES = 16 * 1024 * 1024;

interface EngineManifest {
  readonly schemaVersion: number;
  readonly rid: string;
  readonly engineFile: string;
  readonly workerFile: string;
  readonly files: readonly { readonly path: string; readonly size: number; readonly sha256: string }[];
}

interface Envelope<T = unknown> {
  readonly protocolVersion: number;
  readonly messageType: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly payload: T;
}

interface PendingRequest {
  readonly resolve: (payload: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

function currentRid(): string {
  const key = `${process.platform}-${process.arch}`;
  const values: Record<string, string> = {
    'darwin-arm64': 'osx-arm64',
    'darwin-x64': 'osx-x64',
    'win32-x64': 'win-x64',
    'win32-arm64': 'win-arm64'
  };
  const rid = values[key];
  if (!rid) throw new Error(`desktop.engine.rid_unsupported:${key}`);
  return rid;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export class EngineClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: readline.Interface | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private hello: EngineHello | null = null;

  async start(): Promise<EngineHello> {
    if (this.hello) return this.hello;
    if (this.child) throw new Error('desktop.engine.start_in_progress');

    const rid = currentRid();
    const engineRoot = app.isPackaged
      ? path.join(process.resourcesPath, 'engine', rid)
      : path.join(app.getAppPath(), '.artifacts', 'engine', rid);
    const manifest = JSON.parse(
      await readFile(path.join(engineRoot, 'build-manifest.json'), 'utf8')) as EngineManifest;
    if (manifest.schemaVersion !== 2 || manifest.rid !== rid || manifest.files.length < 2) {
      throw new Error('desktop.engine.manifest_invalid');
    }

    for (const file of manifest.files) {
      if (!file.path || path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes('..')) {
        throw new Error('desktop.engine.manifest_path_invalid');
      }
      const filePath = path.join(engineRoot, file.path);
      const metadata = await stat(filePath);
      if (!metadata.isFile() || metadata.size !== file.size) throw new Error('desktop.engine.dependency_invalid');
      const actualHash = await sha256File(filePath);
      if (actualHash !== file.sha256) throw new Error('desktop.engine.integrity_failed');
    }

    const executablePath = path.join(engineRoot, manifest.engineFile);
    const executableMetadata = await stat(executablePath);
    if (!executableMetadata.isFile()) throw new Error('desktop.engine.executable_invalid');
    const executableHash = await sha256File(executablePath);

    const allowedEnvironment: NodeJS.ProcessEnv = {
      LANG: process.env.LANG ?? 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL,
      TMPDIR: process.env.TMPDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      GBFR_ENGINE_MANIFEST_SHA256: executableHash
    };
    for (const key of Object.keys(allowedEnvironment)) {
      if (allowedEnvironment[key] === undefined) delete allowedEnvironment[key];
    }

    const child = spawn(executablePath, [], {
      cwd: engineRoot,
      env: allowedEnvironment,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    const reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.reader = reader;
    reader.on('line', line => this.receive(line));
    child.once('exit', code => {
      reader.close();
      if (this.reader === reader) this.reader = null;
      this.child = null;
      this.hello = null;
      this.failAll(new Error(`desktop.engine.exited:${code ?? 'signal'}`));
    });
    child.stderr.on('data', data => {
      if (data.length > 64 * 1024) child.kill();
    });

    const hello = await this.request<EngineHello>('engine.hello', {});
    if (hello.buildManifestHash !== executableHash || hello.maxFrameBytes > MAX_FRAME_BYTES) {
      this.stop();
      throw new Error('desktop.engine.handshake_invalid');
    }
    this.hello = hello;
    return hello;
  }

  getHello(): EngineHello {
    if (!this.hello) throw new Error('desktop.engine.not_ready');
    return this.hello;
  }

  importInventory(snapshotPath: string): Promise<ImportedInventory> {
    return this.request<ImportedInventory>('inventory.import', { snapshotPath });
  }

  stop(): void {
    this.reader?.close();
    this.reader = null;
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
    this.hello = null;
    this.failAll(new Error('desktop.engine.stopped'));
  }

  private request<T>(messageType: string, payload: unknown): Promise<T> {
    if (!this.child) return Promise.reject(new Error('desktop.engine.not_started'));
    const requestId = randomBytes(16).toString('hex');
    const correlationId = randomBytes(16).toString('hex');
    const envelope: Envelope = { protocolVersion: 1, messageType, requestId, correlationId, payload };
    const line = JSON.stringify(envelope);
    if (Buffer.byteLength(line) > MAX_FRAME_BYTES) return Promise.reject(new Error('desktop.protocol.frame_too_large'));

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('desktop.engine.request_timeout'));
      }, 25_000);
      this.pending.set(requestId, { resolve: value => resolve(value as T), reject, timeout });
      this.child!.stdin.write(`${line}\n`, 'utf8', error => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        pending.reject(new Error('desktop.engine.write_failed'));
      });
    });
  }

  private receive(line: string): void {
    if (Buffer.byteLength(line) > MAX_FRAME_BYTES) {
      this.stop();
      return;
    }
    try {
      const envelope = JSON.parse(line) as Envelope;
      const pending = this.pending.get(envelope.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(envelope.requestId);
      if (envelope.messageType === 'desktop.failure') {
        pending.reject(new Error('desktop.engine.request_failed'));
      } else {
        pending.resolve(envelope.payload);
      }
    } catch {
      this.stop();
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
