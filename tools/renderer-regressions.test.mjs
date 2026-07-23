import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const renderer = await readFile(path.join(root, 'desktop/src/renderer/index.tsx'), 'utf8');
const styles = await readFile(path.join(root, 'desktop/src/renderer/styles.css'), 'utf8');
const solver = await readFile(path.join(root, 'desktop/src/domain/solver.ts'), 'utf8');
const worker = await readFile(path.join(root, 'desktop/src/domain/solver-worker.ts'), 'utf8');
const webpack = await readFile(path.join(root, 'desktop/webpack.renderer.cjs'), 'utf8');

assert.match(renderer, /%LOCALAPPDATA%\\\\GBFR\\\\Saved\\\\SaveGames\\\\/);
assert.match(renderer, /通常选择 SaveData1\.dat/);
assert.match(renderer, /timeLimitMs: solveTimeLimitSeconds \* 1_000/);
assert.match(renderer, /MAX_SOLVE_TIME_LIMIT_SECONDS = 600/);
assert.match(renderer, /DEFAULT_MEMORY_LIMIT_MIB = 512/);
assert.match(renderer, /memoryLimitMiB/);
assert.match(renderer, /profileMenuRef/);
assert.match(renderer, /document\.addEventListener\('pointerdown', closeProfileMenu\)/);
assert.match(styles, /\.topbar:has\(\.profile-menu\[open\]\) \{ z-index: var\(--z-menu\); \}/);
assert.match(styles, /\.modal-backdrop \{[^}]*z-index: var\(--z-dialog\)/s);
assert.match(solver, /DEFAULT_SOLVE_MILLISECONDS = 30_000/);
assert.match(solver, /solver\.time_limit/);
assert.match(solver, /solver\.memory_limit/);
assert.match(solver, /solveBuildMilpInBrowser/);
assert.match(worker, /await solveBuildWithFallback\(request\)/);
assert.match(webpack, /test: \/\\\.wasm\$\/i, type: 'asset\/resource'/);
assert.match(styles, /\.pool \{[^}]*height: 100%[^}]*overflow: hidden/s);
assert.match(styles, /\.skill-grid \{[^}]*flex: 1 1 0[^}]*min-height: 0[^}]*overflow-y: auto/s);
assert.doesNotMatch(styles, /\.skill-grid \{[^}]*max-height: 650px/s);

process.stdout.write('renderer regression checks passed\n');
