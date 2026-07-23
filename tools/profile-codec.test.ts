import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeProfile, encodeProfile } from '../desktop/src/domain/profile-codec.ts';
import type { BuildProfile, CatalogData } from '../desktop/src/domain/models.ts';

const catalog = JSON.parse(await readFile(new URL('../data/catalog/catalog.zh-CN.json', import.meta.url), 'utf8')) as CatalogData;
const fixture = JSON.parse(await readFile(new URL('../data/fixtures/screenshot-profile.json', import.meta.url), 'utf8')) as BuildProfile;

assert.deepEqual(decodeProfile(encodeProfile(fixture), catalog), {
  ...fixture,
  forbidden: [...fixture.forbidden].sort(),
  avoid: [...fixture.avoid].sort()
});

const legacyProfile = {
  schemaVersion: 2,
  catalogVersion: fixture.catalogVersion,
  name: '旧版方案',
  mandatory: fixture.mandatory,
  basicPrimary: fixture.basicPrimary,
  forceBasicPrimary: fixture.forceBasicPrimary,
  allowBasicSubstitution: fixture.allowBasicSubstitution,
  basicSubstitutionOrder: fixture.basicSubstitutionOrder,
  optional: fixture.optional,
  forbidden: fixture.forbidden,
  avoid: fixture.avoid
};
const legacyJson = JSON.stringify(legacyProfile);
let legacyHash = 2166136261;
for (let index = 0; index < legacyJson.length; index++) {
  legacyHash ^= legacyJson.charCodeAt(index);
  legacyHash = Math.imul(legacyHash, 16777619) >>> 0;
}
const bytes = new TextEncoder().encode(legacyJson);
let binary = '';
for (const byte of bytes) binary += String.fromCharCode(byte);
const legacyPayload = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const migrated = decodeProfile(
  `GBFR-RANK-2.${legacyPayload}.${legacyHash.toString(16).padStart(8, '0')}`,
  catalog);
assert.equal(migrated.schemaVersion, 3);
assert.deepEqual(migrated.attackPrimary, []);
assert.deepEqual(migrated.defensePrimary, []);

for (const invalid of [
  { ...fixture, schemaVersion: 1 },
  { ...fixture, name: '' },
  { ...fixture, forbidden: [...fixture.forbidden, fixture.forbidden[0]] },
  { ...fixture, attackPrimary: ['SKILL_085_00'] },
  { ...fixture, attackPrimary: Array(8).fill('SKILL_013_00') },
  { ...fixture, mandatory: Array(25).fill(fixture.mandatory[0]) },
  { ...fixture, unexpected: true }
]) {
  assert.throws(() => decodeProfile(encodeProfile(invalid as BuildProfile), catalog));
}

process.stdout.write('Profile codec accepted the fixture and rejected malformed structures.\n');
