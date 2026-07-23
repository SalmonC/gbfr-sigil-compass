import { CircleHelp } from 'lucide-react';
import type { CatalogTrait } from '../../domain/models';
import { externalTraitLevelRule } from '../../domain/trait-level-rules';

const skillIconContext = require.context('../skill-icons', false, /\.png$/i);
const skillIconSources = new Map(skillIconContext.keys().map(key => {
  const loaded = skillIconContext(key);
  return [key.slice(2), typeof loaded === 'string' ? loaded : loaded.default] as const;
}));

export function TraitIcon({ trait, size = 28 }: { trait: CatalogTrait | undefined; size?: number }) {
  const source = trait?.iconFile ? skillIconSources.get(trait.iconFile) : undefined;
  if (source) {
    return <img className="trait-icon" src={source} width={size} height={size} alt="" aria-hidden="true" />;
  }
  return <span className={`trait-icon fallback cat-${trait?.category ?? 'unknown'}`}
    style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * .38)) }}
    aria-hidden="true">
    {trait?.nameZh.slice(0, 1) ?? '？'}
  </span>;
}

export function TraitName({ trait }: { trait: CatalogTrait | undefined }) {
  const levelRule = externalTraitLevelRule(trait?.id);
  return <div className="trait-name-line">
    <b>{trait?.nameZh ?? '未知词条'}</b>
    {levelRule && <span className="trait-level-note" title={levelRule.explanation}
      aria-label={`${levelRule.shortLabel}：${levelRule.explanation}`}>
      <CircleHelp size={12} aria-hidden="true" />{levelRule.shortLabel}
    </span>}
  </div>;
}
