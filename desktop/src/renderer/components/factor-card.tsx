import type { ReactNode } from 'react';
import type { CatalogTrait } from '../../domain/models';
import type { RawSigil } from '../../shared/contracts';
import { TraitIcon, TraitName } from './trait';

export interface FactorCardTag {
  readonly label: string;
  readonly tone: 'warning' | 'danger';
}

function TraitRow({
  kind, trait, primary, tags = []
}: {
  kind: string;
  trait: CatalogTrait | undefined;
  primary?: boolean;
  tags?: readonly FactorCardTag[];
}) {
  const hasDanger = tags.some(tag => tag.tone === 'danger');
  const hasWarning = tags.some(tag => tag.tone === 'warning');
  return <div className={`factor-trait ${primary ? 'primary' : ''} ${hasDanger ? 'avoid' : ''} ${hasWarning ? 'substitution' : ''}`}>
    <TraitIcon trait={trait} size={primary ? 30 : 24} />
    <span>{kind}</span>
    <TraitName trait={trait} />
    {tags.length > 0 && <div className="factor-trait-tags">
      {tags.map(tag => <em className={`tag-${tag.tone}`} key={`${tag.tone}-${tag.label}`}>{tag.label}</em>)}
    </div>}
  </div>;
}

export function FactorCard({
  sigil, primary, secondary, label, mode = 'result', primaryTags, secondaryTags,
  footerStart, footerEnd, hasIssue = false
}: {
  sigil: RawSigil;
  primary: CatalogTrait | undefined;
  secondary: CatalogTrait | undefined;
  label: string;
  mode?: 'result' | 'inventory' | 'confirmed';
  primaryTags?: readonly FactorCardTag[];
  secondaryTags?: readonly FactorCardTag[];
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
  hasIssue?: boolean;
}) {
  return <article className={`factor-card mode-${mode} ${hasIssue ? 'has-issue' : ''}`}>
    <header className="factor-card-head">
      <span>{label}</span>
      <strong>因子 Lv {sigil.sigilLevel}</strong>
    </header>
    <TraitRow kind="主词条" trait={primary} primary tags={primaryTags} />
    <TraitRow kind="副词条" trait={secondary} tags={secondaryTags} />
    {(footerStart || footerEnd) && <footer className="factor-card-footer">
      <span>{footerStart}</span>
      <div>{footerEnd}</div>
    </footer>}
  </article>;
}
