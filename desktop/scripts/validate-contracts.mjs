import Ajv2020 from 'ajv/dist/2020.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const contractRoot = path.join(repositoryRoot, 'contracts', 'desktop', 'v1');
const envelopeSchema = JSON.parse(await readFile(path.join(contractRoot, 'envelope.schema.json'), 'utf8'));
const lines = (await readFile(path.join(contractRoot, 'examples', 'target-draft.ndjson'), 'utf8'))
  .split(/\r?\n/u).filter(Boolean);
const validate = new Ajv2020({ strict: true }).compile(envelopeSchema);

for (const [index, line] of lines.entries()) {
  const value = JSON.parse(line);
  if (!validate(value)) throw new Error(`Envelope example ${index + 1} failed: ${JSON.stringify(validate.errors)}`);
}
process.stdout.write(`Validated ${lines.length} desktop contract examples.\n`);
