import type { BuildProfile, CatalogData } from './models';

const PREFIX = 'GBFR-RANK-4';
const LEGACY_PREFIXES = new Set(['GBFR-RANK-3', 'GBFR-RANK-2']);
const domainNames = [
  'mandatory', 'basicPrimary', 'attackPrimary', 'defensePrimary', 'optional',
  'basicSubstitutionOrder', 'forbidden', 'avoid'
] as const;
const profileKeys = new Set([
  'schemaVersion', 'catalogVersion', 'name', 'mandatory',
  'basicPrimary', 'forceBasicPrimary', 'allowBasicSubstitution', 'basicSubstitutionOrder',
  'attackPrimary', 'forceAttackPrimary', 'defensePrimary', 'forceDefensePrimary',
  'optional', 'forbidden', 'avoid'
]);
const legacyProfileKeys = new Set([
  'schemaVersion', 'catalogVersion', 'name', 'mandatory', 'basicPrimary', 'forceBasicPrimary',
  'allowBasicSubstitution', 'basicSubstitutionOrder', 'optional', 'forbidden', 'avoid'
]);

function isSkillList(value: unknown, maxItems: number, unique: boolean): value is string[] {
  if (!Array.isArray(value) || value.length > maxItems
    || value.some(item => typeof item !== 'string' || item.length < 1 || item.length > 80)) return false;
  return !unique || new Set(value).size === value.length;
}

function migrateProfile(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.schemaVersion !== 2
    || keys.length !== legacyProfileKeys.size
    || !keys.every(key => legacyProfileKeys.has(key))) return value;
  return {
    ...record,
    schemaVersion: 3,
    attackPrimary: [],
    forceAttackPrimary: false,
    defensePrimary: [],
    forceDefensePrimary: false
  };
}

function hasValidStructure(value: unknown): value is BuildProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === profileKeys.size && keys.every(key => profileKeys.has(key))
    && record.schemaVersion === 3
    && typeof record.catalogVersion === 'string' && record.catalogVersion.length >= 1 && record.catalogVersion.length <= 120
    && typeof record.name === 'string' && record.name.length >= 1 && record.name.length <= 80
    && typeof record.forceBasicPrimary === 'boolean'
    && typeof record.allowBasicSubstitution === 'boolean'
    && typeof record.forceAttackPrimary === 'boolean'
    && typeof record.forceDefensePrimary === 'boolean'
    && isSkillList(record.mandatory, 24, false)
    && isSkillList(record.basicPrimary, 12, false)
    && isSkillList(record.attackPrimary, 12, false)
    && isSkillList(record.defensePrimary, 12, false)
    && isSkillList(record.optional, 24, false)
    && isSkillList(record.basicSubstitutionOrder, 256, true)
    && isSkillList(record.forbidden, 256, true)
    && isSkillList(record.avoid, 256, true);
}

function checksum(text: string): string {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

export function encodeProfile(profile: BuildProfile): string {
  const canonical = {
    ...profile,
    forbidden: [...profile.forbidden].sort(),
    avoid: [...profile.avoid].sort()
  };
  const json = JSON.stringify(canonical);
  const payload = toBase64Url(json);
  return `${PREFIX}.${payload}.${checksum(json)}`;
}

export function decodeProfile(code: string, catalog: CatalogData): BuildProfile {
  const [prefix, payload, expected, extra] = code.trim().split('.');
  if ((prefix !== PREFIX && !LEGACY_PREFIXES.has(prefix ?? '')) || !payload || !expected || extra) {
    throw new Error('分享字符串格式不正确。');
  }
  const json = fromBase64Url(payload);
  if (checksum(json) !== expected) throw new Error('分享字符串校验失败，内容可能不完整。');
  const profile: unknown = JSON.parse(json);
  return validateProfile(profile, catalog);
}

const STORAGE_KEY = 'gbfr-factor-planner.profiles.v2';

export function loadProfiles(catalog: CatalogData): BuildProfile[] {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const profiles: unknown = JSON.parse(value);
    if (!Array.isArray(profiles)) return [];
    return profiles.flatMap(profile => {
      try { return [validateProfile(profile, catalog)]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

export function storeProfiles(profiles: readonly BuildProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function removeLegacyProfileStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function validateProfile(value: unknown, catalog: CatalogData): BuildProfile {
  const migrated = migrateProfile(value);
  if (!hasValidStructure(migrated)) throw new Error('分享字符串的内容结构不正确。');
  const profile = migrated;
  if (profile.catalogVersion !== catalog.catalogVersion) {
    throw new Error(`方案目录版本不匹配：${profile.catalogVersion}`);
  }

  const primaryCount = profile.basicPrimary.length + profile.attackPrimary.length + profile.defensePrimary.length;
  const targetCount = profile.mandatory.length + primaryCount + profile.optional.length;
  if (targetCount === 0) throw new Error('方案至少需要一个目标技能。');
  if (targetCount > 24) throw new Error('方案的目标技能总数不能超过 24。');
  if (primaryCount > 12) throw new Error('主词条目标合计不能超过 12 项。');

  const traits = new Map(catalog.traits.map(trait => [trait.id, trait]));
  for (const domain of domainNames) {
    for (const id of profile[domain]) {
      if (!traits.has(id)) throw new Error(`方案包含当前目录中不存在的技能：${id}`);
    }
  }
  const categoryDomains = [
    ['basic', [...profile.basicPrimary, ...profile.basicSubstitutionOrder]],
    ['attack', profile.attackPrimary],
    ['defense', profile.defensePrimary]
  ] as const;
  for (const [category, ids] of categoryDomains) {
    for (const id of ids) {
      const trait = traits.get(id)!;
      if (trait.category !== category || !trait.canPrimary) {
        throw new Error(`主词条目标中包含不可用技能：${trait.nameZh}`);
      }
    }
  }

  for (let leftIndex = 0; leftIndex < domainNames.length; leftIndex++) {
    const left = domainNames[leftIndex]!;
    if (left === 'basicSubstitutionOrder'
      && (!profile.forceBasicPrimary || !profile.allowBasicSubstitution)) continue;
    const leftIds = new Set(profile[left]);
    for (let rightIndex = leftIndex + 1; rightIndex < domainNames.length; rightIndex++) {
      const right = domainNames[rightIndex]!;
      if (right === 'basicSubstitutionOrder'
        && (!profile.forceBasicPrimary || !profile.allowBasicSubstitution)) continue;
      if ((left === 'mandatory' && right === 'optional')
        || (left === 'optional' && right === 'mandatory')) continue;
      const conflict = profile[right].find(id => leftIds.has(id));
      if (conflict) throw new Error(`同一技能不能同时出现在“${left}”和“${right}”：${conflict}`);
    }
  }
  return profile;
}
