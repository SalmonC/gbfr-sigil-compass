import type { ReactNode } from 'react';
import type { CatalogTrait } from '../../domain/models';
import type { LogicalSigil } from '../../shared/contracts';
import { TraitIcon, TraitName } from './trait';

export interface FactorCardTag {
  readonly label: string;
  readonly tone: 'warning' | 'danger' | 'muted';
}

export interface FactorTraitOption {
  readonly value: string;
  readonly label: string;
}

function TraitRow({
  kind, trait, primary, tags = [], selection
}: {
  kind: string;
  trait: CatalogTrait | undefined;
  primary?: boolean;
  tags?: readonly FactorCardTag[];
  selection?: {
    readonly value: string;
    readonly options: readonly FactorTraitOption[];
    readonly onChange: (value: string) => void;
  };
}) {
  const hasDanger = tags.some(tag => tag.tone === 'danger');
  const hasWarning = tags.some(tag => tag.tone === 'warning');
  const hasMuted = tags.some(tag => tag.tone === 'muted');
  return <div className={`factor-trait ${primary ? 'primary' : ''} ${hasDanger ? 'avoid' : ''} ${hasWarning ? 'substitution' : ''} ${hasMuted ? 'non-target' : ''}`}>
    <TraitIcon trait={trait} size={primary ? 30 : 24} />
    <span>{kind}</span>
    {selection
      ? <select className="factor-trait-select" aria-label={`更换${kind}`}
        value={selection.value} disabled={selection.options.length <= 1}
        title={selection.options.length <= 1 ? `没有其他可用的${kind}` : `更换${kind}`}
        onChange={event => selection.onChange(event.target.value)}>
        {selection.options.map(option =>
          <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      : <TraitName trait={trait} />}
    {tags.length > 0 && <div className="factor-trait-tags">
      {tags.map(tag => <em className={`tag-${tag.tone}`} key={`${tag.tone}-${tag.label}`}>{tag.label}</em>)}
    </div>}
  </div>;
}

export function FactorCard({
  sigil, primary, secondary, label, mode = 'result', primaryTags, secondaryTags,
  footerStart, footerEnd, hasIssue = false, headerActions, primarySelection, secondarySelection
}: {
  sigil: LogicalSigil;
  primary: CatalogTrait | undefined;
  secondary: CatalogTrait | undefined;
  label: string;
  mode?: 'result' | 'inventory' | 'confirmed';
  primaryTags?: readonly FactorCardTag[];
  secondaryTags?: readonly FactorCardTag[];
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
  hasIssue?: boolean;
  headerActions?: ReactNode;
  primarySelection?: {
    readonly value: string;
    readonly options: readonly FactorTraitOption[];
    readonly onChange: (value: string) => void;
  };
  secondarySelection?: {
    readonly value: string;
    readonly options: readonly FactorTraitOption[];
    readonly onChange: (value: string) => void;
  };
}) {
  return <article className={`factor-card mode-${mode} ${hasIssue ? 'has-issue' : ''}`}>
    <header className="factor-card-head">
      <span>{label}</span>
      <div><strong>因子 Lv {sigil.sigilLevel}</strong>{headerActions}</div>
    </header>
    <TraitRow kind="主词条" trait={primary} primary tags={primaryTags} selection={primarySelection} />
    <TraitRow kind="副词条" trait={secondary} tags={secondaryTags} selection={secondarySelection} />
    {(footerStart || footerEnd) && <footer className="factor-card-footer">
      <span>{footerStart}</span>
      <div>{footerEnd}</div>
    </footer>}
  </article>;
}
