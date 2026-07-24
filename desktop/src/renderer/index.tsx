import { createRoot } from 'react-dom/client';
import {
  AlertTriangle, Archive, BarChart3, Check, CheckCircle2, ChevronDown, ExternalLink,
  ChevronLeft, ChevronRight, Clipboard, Database, Eraser, FileUp, LayoutList,
  ListChecks, LockKeyhole, MoreHorizontal, MoveDown, MoveUp, Pencil, Play, Plus, RotateCcw,
  Search, ShieldCheck, Sparkles, Trash2, X
} from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import catalogJson from '../../../data/catalog/catalog.zh-CN.json';
import fixtureJson from '../../../data/fixtures/screenshot-profile.json';
import type {
  BuildProfile, CatalogData, CatalogTrait, SolverAnalysis, SolverRequest, SolverResult
} from '../domain/models';
import { decodeProfile, encodeProfile } from '../domain/profile-codec';
import { factorInstanceKey, inventoryFingerprint } from '../domain/inventory-identity.ts';
import {
  chooseGroupMember, groupInventory
} from '../domain/inventory-groups.ts';
import { evaluateAdjustedResult, hasSameLogicalSelection } from '../domain/result-adjustment.ts';
import { externalTraitLevelRule } from '../domain/trait-level-rules';
import {
  addStoredProfile, cacheAnalysis, confirmResult, createAnalysisContext, createWorkspace,
  confirmedAllocationShortfall, confirmedFactorCount, deleteStoredProfile,
  findReservationConflicts, getCacheStatus, releaseConfirmedResult,
  pruneInvalidAnalysisCaches, replaceStoredProfile, storeManualResult, storeWorkspace, updateStoredDraft, type CacheStatus,
  type StoredProfile, type WorkspaceState
} from '../domain/workspace-store.ts';
import {
  initialAnalysisRunState, reduceAnalysisState
} from '../domain/analysis-state';
import type { EngineHello, ImportedInventory, LogicalSigil } from '../shared/contracts';
import {
  FactorCard, type FactorCardTag, type FactorTraitOption
} from './components/factor-card';
import { AccessibleTabs, Dialog, HelpPopover } from './components/primitives';
import { TraitIcon } from './components/trait';
import './tokens.css';
import './styles.css';

type Domain = 'mandatory' | 'basicPrimary' | 'attackPrimary' | 'defensePrimary' |
  'optional' | 'basicSubstitutionOrder' | 'forbidden' | 'avoid';
type PageSection = 'targets' | 'results';
type AppPage = 'planner' | 'inventory' | 'loadouts';
type SaveStatus = 'saving' | 'saved' | 'failed';
type FactorPickerState = {
  readonly sourceSignature: string;
  readonly mode: 'add' | 'replace';
  readonly index?: number;
};

const catalog = catalogJson as CatalogData;
const fixture = fixtureJson as BuildProfile;
const SOLVE_TIME_LIMIT_STORAGE_KEY = 'sigil-compass.solve-time-limit-seconds';
const DEFAULT_SOLVE_TIME_LIMIT_SECONDS = 30;
const MIN_SOLVE_TIME_LIMIT_SECONDS = 5;
const MAX_SOLVE_TIME_LIMIT_SECONDS = 600;
const MEMORY_LIMIT_STORAGE_KEY = 'sigil-compass.memory-limit-mib';
const DEFAULT_MEMORY_LIMIT_MIB = 512;
const MIN_MEMORY_LIMIT_MIB = 128;
const MAX_MEMORY_LIMIT_MIB = 2_048;
let solverWorker: Worker | null = null;
let nextSolverRequestId = 1;
const pendingSolverRequests = new Map<number, {
  resolve: (result: SolverAnalysis) => void;
  reject: (error: Error) => void;
  timeoutId: number;
}>();

function rejectPendingSolverRequests(message: string): void {
  for (const pending of pendingSolverRequests.values()) {
    window.clearTimeout(pending.timeoutId);
    pending.reject(new Error(message));
  }
  pendingSolverRequests.clear();
}

function getSolverWorker(): Worker {
  if (solverWorker) return solverWorker;
  const worker = new Worker(new URL('../domain/solver-worker.ts', import.meta.url));
  worker.onmessage = (event: MessageEvent<{
    requestId: number;
    result?: SolverAnalysis;
    error?: string;
  }>) => {
    const pending = pendingSolverRequests.get(event.data.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    pendingSolverRequests.delete(event.data.requestId);
    if (pendingSolverRequests.size === 0) disposeSolverWorker(worker);
    if (event.data.result) pending.resolve(event.data.result);
    else pending.reject(new Error(event.data.error ?? 'solver.no_result'));
  };
  worker.onerror = () => {
    rejectPendingSolverRequests('solver.worker_failed');
    disposeSolverWorker(worker);
  };
  solverWorker = worker;
  return worker;
}

function disposeSolverWorker(worker: Worker): void {
  worker.onmessage = null;
  worker.onerror = null;
  worker.terminate();
  if (solverWorker === worker) solverWorker = null;
}

function cancelSolverWork(): void {
  if (solverWorker) disposeSolverWorker(solverWorker);
  rejectPendingSolverRequests('solver.cancelled');
}

function solveInWorker(request: SolverRequest): Promise<SolverAnalysis> {
  const requestId = nextSolverRequestId++;
  const timeoutMs = Math.max(10_000, Math.min(
    (request.timeLimitMs ?? DEFAULT_SOLVE_TIME_LIMIT_SECONDS * 1_000) + 5_000,
    MAX_SOLVE_TIME_LIMIT_SECONDS * 1_000 + 5_000));
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    try {
      worker = getSolverWorker();
      const timeoutId = window.setTimeout(() => {
        if (!pendingSolverRequests.has(requestId)) return;
        rejectPendingSolverRequests('solver.time_limit');
        if (worker) disposeSolverWorker(worker);
      }, timeoutMs);
      pendingSolverRequests.set(requestId, { resolve, reject, timeoutId });
      worker.postMessage({ requestId, request });
    } catch (error) {
      const pending = pendingSolverRequests.get(requestId);
      if (pending) window.clearTimeout(pending.timeoutId);
      pendingSolverRequests.delete(requestId);
      if (worker && pendingSolverRequests.size === 0) disposeSolverWorker(worker);
      reject(error);
    }
  });
}

function readSolveTimeLimitSeconds(): number {
  const stored = Number.parseInt(window.localStorage.getItem(SOLVE_TIME_LIMIT_STORAGE_KEY) ?? '', 10);
  if (!Number.isFinite(stored)) return DEFAULT_SOLVE_TIME_LIMIT_SECONDS;
  return Math.max(MIN_SOLVE_TIME_LIMIT_SECONDS, Math.min(stored, MAX_SOLVE_TIME_LIMIT_SECONDS));
}

function readMemoryLimitMiB(): number {
  const stored = Number.parseInt(window.localStorage.getItem(MEMORY_LIMIT_STORAGE_KEY) ?? '', 10);
  if (!Number.isFinite(stored)) return DEFAULT_MEMORY_LIMIT_MIB;
  return Math.max(MIN_MEMORY_LIMIT_MIB, Math.min(stored, MAX_MEMORY_LIMIT_MIB));
}

const sectionMeta: Record<Domain, { title: string; help: string; tone: string }> = {
  mandatory: {
    title: '必须满足',
    help: '这里的技能必须全部带上，否则不会显示方案。同一技能可以重复添加。',
    tone: 'required'
  },
  basicPrimary: {
    title: '基础属性主词条',
    help: '这里的技能需要出现在因子的第一个词条。开启优先满足后，会先保证这些主词条，再考虑可选目标。',
    tone: 'basic'
  },
  attackPrimary: {
    title: '攻击类主词条',
    help: '这里可指定攻击类技能，并要求它们出现在因子的第一个词条。开启优先满足后，完成数量会先于可选目标比较。',
    tone: 'attack'
  },
  defensePrimary: {
    title: '防御类主词条',
    help: '这里可指定防御类技能，并要求它们出现在因子的第一个词条。开启优先满足后，完成数量会先于可选目标比较。',
    tone: 'defense'
  },
  optional: {
    title: '可选目标',
    help: '满足必须项和指定主词条后，工具会尽量多带上这些技能。列表越靠前，越优先。',
    tone: 'optional'
  },
  basicSubstitutionOrder: {
    title: '可接受的替代主词条',
    help: '指定的主词条凑不齐时，可以用这里的基础属性补足。越靠前的技能越优先，每种技能只能添加一次。',
    tone: 'basic'
  },
  forbidden: {
    title: '不能出现的技能',
    help: '所选因子的主词条或副词条只要包含这里的技能，整套方案就会被排除。',
    tone: 'danger'
  },
  avoid: {
    title: '尽量避开的技能',
    help: '这些技能允许出现，但目标完成情况相同时，带得越少的方案越靠前。',
    tone: 'warning'
  }
};

const primaryDomains = new Set<Domain>(['basicPrimary', 'attackPrimary', 'defensePrimary']);
const duplicateDomains = new Set<Domain>(['mandatory', 'basicPrimary', 'attackPrimary', 'defensePrimary', 'optional']);

function FactorGrid({
  result, profile, traitById, traitByHash, mode = 'result', editing
}: {
  result: SolverResult;
  profile: BuildProfile;
  traitById: ReadonlyMap<string, CatalogTrait>;
  traitByHash: ReadonlyMap<number, CatalogTrait>;
  mode?: 'result' | 'confirmed';
  editing?: {
    readonly availableInventory: readonly LogicalSigil[];
    readonly onSelectInstance: (index: number, instanceKey: string) => void;
    readonly onReplace: (index: number) => void;
    readonly onDelete: (index: number) => void;
    readonly onAdd: () => void;
  };
}) {
  const targetIds = new Set([
    ...profile.mandatory,
    ...profile.basicPrimary,
    ...profile.attackPrimary,
    ...profile.defensePrimary,
    ...profile.optional
  ]);
  const forbiddenHashes = new Set(profile.forbidden.flatMap(id => {
    const trait = traitById.get(id);
    return trait ? [Number.parseInt(trait.hash.slice(2), 16) >>> 0] : [];
  }));
  const selectableOptions = (
    sigil: LogicalSigil,
    index: number,
    kind: 'primary' | 'secondary'
  ): FactorTraitOption[] => {
    if (!editing) return [];
    const currentKey = factorInstanceKey(sigil);
    const usedElsewhere = new Set(result.selected
      .filter((_, selectedIndex) => selectedIndex !== index)
      .map(factorInstanceKey));
    const candidates = editing.availableInventory
      .filter(candidate => {
        const candidateKey = factorInstanceKey(candidate);
        if (usedElsewhere.has(candidateKey)) return false;
        if (forbiddenHashes.has(candidate.primaryTraitHash >>> 0)
          || forbiddenHashes.has(candidate.secondaryTraitHash >>> 0)) return false;
        return kind === 'primary'
          ? (candidate.secondaryTraitHash >>> 0) === (sigil.secondaryTraitHash >>> 0)
          : (candidate.primaryTraitHash >>> 0) === (sigil.primaryTraitHash >>> 0);
      });
    return groupInventory(candidates)
      .sort((left, right) => {
        const leftCurrent = left.members.some(item => factorInstanceKey(item) === currentKey);
        const rightCurrent = right.members.some(item => factorInstanceKey(item) === currentKey);
        if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
        const leftHash = kind === 'primary'
          ? left.representative.primaryTraitHash : left.representative.secondaryTraitHash;
        const rightHash = kind === 'primary'
          ? right.representative.primaryTraitHash : right.representative.secondaryTraitHash;
        const leftName = traitByHash.get(leftHash >>> 0)?.nameZh ?? '未知词条';
        const rightName = traitByHash.get(rightHash >>> 0)?.nameZh ?? '未知词条';
        return leftName.localeCompare(rightName, 'zh-CN')
          || right.representative.sigilLevel - left.representative.sigilLevel
          || left.groupKey.localeCompare(right.groupKey);
      })
      .map(group => {
        const candidate = chooseGroupMember(group, currentKey);
        const hash = kind === 'primary' ? candidate.primaryTraitHash : candidate.secondaryTraitHash;
        const trait = traitByHash.get(hash >>> 0);
        return {
          value: factorInstanceKey(candidate),
          label: `${trait?.nameZh ?? '未知词条'} · Lv ${candidate.sigilLevel} · 可用 ${group.count}`
        };
      });
  };
  const substitutionRemaining = new Map<number, number>();
  result.basicSubstitutionUsage.forEach((count, index) => {
    const id = profile.basicSubstitutionOrder[index];
    const trait = id ? traitById.get(id) : undefined;
    if (trait && count > 0) substitutionRemaining.set(Number.parseInt(trait.hash.slice(2), 16) >>> 0, count);
  });
  return <div className="factor-grid">
    {result.selected.map((sigil, index) => {
      const primary = traitByHash.get(sigil.primaryTraitHash >>> 0);
      const secondary = traitByHash.get(sigil.secondaryTraitHash >>> 0);
      const primaryAvoid = !!primary && profile.avoid.includes(primary.id);
      const secondaryAvoid = !!secondary && profile.avoid.includes(secondary.id);
      const primaryNonTarget = !primary || !targetIds.has(primary.id);
      const secondaryNonTarget = !secondary || !targetIds.has(secondary.id);
      const substitutionCount = substitutionRemaining.get(sigil.primaryTraitHash >>> 0) ?? 0;
      const isSubstitution = substitutionCount > 0;
      if (isSubstitution) substitutionRemaining.set(sigil.primaryTraitHash >>> 0, substitutionCount - 1);
      const primaryTags: FactorCardTag[] = [];
      const secondaryTags: FactorCardTag[] = [];
      if (isSubstitution) primaryTags.push({ label: '替代主词条', tone: 'warning' });
      if (primaryNonTarget && !primaryAvoid) primaryTags.push({ label: '未列入目标', tone: 'muted' });
      if (secondaryNonTarget && !secondaryAvoid) secondaryTags.push({ label: '未列入目标', tone: 'muted' });
      if (primaryAvoid) primaryTags.push({ label: '尽量避开', tone: 'danger' });
      if (secondaryAvoid) secondaryTags.push({ label: '尽量避开', tone: 'danger' });
      const instanceKey = factorInstanceKey(sigil);
      return <FactorCard key={factorInstanceKey(sigil)}
        sigil={sigil} primary={primary} secondary={secondary}
        label={`因子 ${index + 1}`} mode={mode}
        primaryTags={primaryTags} secondaryTags={secondaryTags}
        hasIssue={primaryAvoid || secondaryAvoid || isSubstitution}
        headerActions={editing && <span className="factor-card-actions">
          <button type="button" aria-label={`更换因子 ${index + 1}`} title="更换整枚因子"
            onClick={() => editing.onReplace(index)}><Pencil size={13} /></button>
          <button type="button" aria-label={`删除因子 ${index + 1}`} title="删除这枚因子"
            onClick={() => editing.onDelete(index)}><Trash2 size={13} /></button>
        </span>}
        primarySelection={editing ? {
          value: instanceKey,
          options: selectableOptions(sigil, index, 'primary'),
          onChange: value => editing.onSelectInstance(index, value)
        } : undefined}
        secondarySelection={editing ? {
          value: instanceKey,
          options: selectableOptions(sigil, index, 'secondary'),
          onChange: value => editing.onSelectInstance(index, value)
        } : undefined} />;
    })}
    {editing && result.selected.length < 12 && <button type="button" className="factor-add-card"
      onClick={editing.onAdd}><Plus size={19} /><strong>添加因子</strong><span>从未占用的库存中选择</span></button>}
  </div>;
}

function SkillLevelSummary({
  result, profile, traitByHash
}: {
  result: SolverResult;
  profile: BuildProfile;
  traitByHash: ReadonlyMap<number, CatalogTrait>;
}) {
  const targetOrder = [
    ...profile.mandatory,
    ...profile.basicPrimary,
    ...profile.attackPrimary,
    ...profile.defensePrimary,
    ...profile.optional
  ];
  const targetIds = new Set(targetOrder);
  const avoid = new Set(profile.avoid);
  const levels = new Map<number, {
    hash: number;
    trait: CatalogTrait | undefined;
    level: number;
    count: number;
  }>();
  for (const sigil of result.selected) {
    for (const hash of [sigil.primaryTraitHash >>> 0, sigil.secondaryTraitHash >>> 0]) {
      const current = levels.get(hash) ?? {
        hash,
        trait: traitByHash.get(hash),
        level: 0,
        count: 0
      };
      current.level += sigil.sigilLevel;
      current.count += 1;
      levels.set(hash, current);
    }
  }
  const categoryRank: Readonly<Record<string, number>> = {
    basic: 0,
    attack: 1,
    defense: 2,
    support: 3,
    special: 3,
    character: 4
  };
  const entries = [...levels.values()].sort((left, right) => {
    const leftCategory = left.trait?.category ?? 'unknown';
    const rightCategory = right.trait?.category ?? 'unknown';
    const categoryDifference = (categoryRank[leftCategory] ?? 5) - (categoryRank[rightCategory] ?? 5);
    if (categoryDifference !== 0) return categoryDifference;
    const catalogDifference = (catalog.categories.find(item => item.id === leftCategory)?.order ?? 99)
      - (catalog.categories.find(item => item.id === rightCategory)?.order ?? 99);
    return catalogDifference
      || (left.trait?.nameZh ?? '').localeCompare(right.trait?.nameZh ?? '', 'zh-CN');
  });
  return <section className="skill-level-summary" aria-label="本套配装的技能等级">
    <header><strong>技能汇总</strong><span>相同技能的等级已经合并</span></header>
    <div>
      {entries.map(entry => {
        const trait = entry.trait;
        const externalRule = externalTraitLevelRule(trait?.id);
        const isTarget = !!trait && targetIds.has(trait.id);
        const isAvoid = !!trait && avoid.has(trait.id);
        return <span key={trait?.hash ?? `unknown-${entry.hash}`}
          className={`skill-level-chip ${!isTarget ? 'non-target' : ''} ${isAvoid ? 'avoid' : ''}`}
          title={externalRule?.explanation}>
          <TraitIcon trait={trait} size={20} />
          <b>{trait?.nameZh ?? '未知词条'}</b>
          <em>{externalRule ? externalRule.shortLabel : `Lv ${entry.level}`}</em>
          {externalRule && entry.count > 1 && <small>×{entry.count}</small>}
        </span>;
      })}
    </div>
  </section>;
}

function confirmedDisplayNames(profiles: readonly StoredProfile[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const record of profiles) {
    if (!record.confirmed) continue;
    const persisted = record.confirmed.displayName?.trim();
    const base = persisted || record.confirmed.sourceProfileName?.trim() || record.profile.name.trim() || '未命名方案';
    let candidate = base;
    let suffix = 1;
    while (used.has(candidate)) candidate = `${base} -${suffix++}`;
    used.add(candidate);
    names.set(record.id, candidate);
  }
  return names;
}

function targetList(profile: BuildProfile, domain: Domain): readonly string[] {
  return profile[domain];
}

function withTargetList(profile: BuildProfile, domain: Domain, values: readonly string[]): BuildProfile {
  return { ...profile, [domain]: values };
}

function targetOccurrenceKey(values: readonly string[], index: number): string {
  const id = values[index] ?? 'unknown';
  let occurrence = 0;
  for (let cursor = 0; cursor <= index; cursor += 1) {
    if (values[cursor] === id) occurrence += 1;
  }
  return `${id}-${occurrence}`;
}

function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function cacheStatusText(status: CacheStatus, hasCache: boolean): string {
  if (!hasCache) return '未计算';
  if (status === 'current') return '已有结果';
  if (status === 'profile-changed') return '目标已修改';
  if (status === 'inventory-changed') return '库存已更新';
  if (status === 'allocations-changed') return '占用已变化';
  return '未计算';
}

function resultIssueLabels(result: SolverResult, profile: BuildProfile): string[] {
  const issues: string[] = [];
  if (!result.mandatorySatisfied) issues.push('必须满足的技能没有全部带上');
  if ((result.forbiddenOccurrences ?? 0) > 0) issues.push('带有不能出现的技能');
  if (result.primaryMatched < result.primaryRequired) issues.push('优先主词条没有全部满足');
  if (result.basicSubstitutionUsage.some(count => count > 0)) issues.push('使用了替代主词条');
  if (result.avoidOccurrences > 0) issues.push('带有尽量避开的技能');
  return issues;
}

function firstRankDifference(current: SolverResult, previous: SolverResult | undefined, forcePrimary: boolean): string {
  if (!previous) return '综合结果最好';
  if (forcePrimary && current.primaryMatched !== previous.primaryMatched) return '优先主词条完成数';
  if (forcePrimary && current.exactPrimaryCoverage.some((value, index) => value !== previous.exactPrimaryCoverage[index])) {
    return '指定主词条顺序';
  }
  if (forcePrimary && current.basicSubstitutionUsage.some((value, index) => value !== previous.basicSubstitutionUsage[index])) {
    return '替代主词条顺序';
  }
  if (current.optionalMatched !== previous.optionalMatched) return '可选目标完成数';
  if (current.avoidOccurrences !== previous.avoidOccurrences) return '需避开技能数量';
  if (current.optionalCoverage.some((value, index) => value !== previous.optionalCoverage[index])) return '可选目标顺序';
  if (current.usedSlots !== previous.usedSlots) return '使用因子数';
  if (current.levelSum !== previous.levelSum) return '因子强化等级';
  return '同分后的稳定顺序';
}

function App() {
  const [hello, setHello] = useState<EngineHello | null>(null);
  const [workspace, setWorkspaceState] = useState(() => createWorkspace(catalog, fixture));
  const [appPage, setAppPage] = useState<AppPage>('planner');
  const [activeDomain, setActiveDomain] = useState<Domain | null>('mandatory');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [inventory, setInventory] = useState<ImportedInventory | null>(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryCategory, setInventoryCategory] = useState('all');
  const [inventoryStatus, setInventoryStatus] = useState<'all' | 'available' | 'reserved' | 'equipped'>('all');
  const [inventorySort, setInventorySort] = useState<'level' | 'primary' | 'secondary'>('primary');
  const [inventoryPage, setInventoryPage] = useState(0);
  const [importing, setImporting] = useState(false);
  const [analysisRun, dispatchAnalysis] = useReducer(reduceAnalysisState, initialAnalysisRunState);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [factorPicker, setFactorPicker] = useState<FactorPickerState | null>(null);
  const [factorPickerSearch, setFactorPickerSearch] = useState('');
  const [notice, setNotice] = useState('已载入截图测试方案。读取存档后即可分析。');
  const [shareCode, setShareCode] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedLoadoutProfileId, setSelectedLoadoutProfileId] = useState<string | null>(null);
  const [activePageSection, setActivePageSection] = useState<PageSection>('targets');
  const [resultScrollRequest, setResultScrollRequest] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [solveTimeLimitSeconds, setSolveTimeLimitSeconds] = useState(readSolveTimeLimitSeconds);
  const [memoryLimitMiB, setMemoryLimitMiB] = useState(readMemoryLimitMiB);
  const targetsRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const profileMenuRef = useRef<HTMLDetailsElement>(null);
  const activeRunRef = useRef<{ runId: number; requestKey: string } | null>(null);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  function updateWorkspace(transform: (current: WorkspaceState) => WorkspaceState): void {
    const next = transform(workspaceRef.current);
    workspaceRef.current = next;
    setWorkspaceState(next);
  }

  const activeRecord = workspace.profiles.find(item => item.id === workspace.activeProfileId)
    ?? workspace.profiles[0]!;
  const profile = activeRecord.profile;
  const analysis = activeRecord.cache?.analysis ?? null;
  const currentInventoryFingerprint = useMemo(
    () => inventory ? inventoryFingerprint(inventory.stocks) : null,
    [inventory]);
  const confirmedMissingCount = activeRecord.confirmed && inventory
    ? confirmedAllocationShortfall(workspace, activeRecord.id, inventory)
    : 0;

  const traitById = useMemo(() => new Map(catalog.traits.map(trait => [trait.id, trait])), []);
  const traitByHash = useMemo(() => new Map(catalog.traits.map(trait =>
    [Number.parseInt(trait.hash.slice(2), 16) >>> 0, trait])), []);
  const analysisContext = useMemo(() => inventory
    ? createAnalysisContext(
      profile, activeRecord.id, inventory, workspace, currentInventoryFingerprint ?? undefined)
    : null, [activeRecord.id, currentInventoryFingerprint, inventory, profile, workspace]);
  const cacheStatus: CacheStatus = analysisContext
    ? getCacheStatus(activeRecord.cache, analysisContext)
    : activeRecord.cache ? 'inventory-changed' : 'none';

  useEffect(() => {
    window.localStorage.setItem(SOLVE_TIME_LIMIT_STORAGE_KEY, String(solveTimeLimitSeconds));
  }, [solveTimeLimitSeconds]);

  useEffect(() => {
    window.localStorage.setItem(MEMORY_LIMIT_STORAGE_KEY, String(memoryLimitMiB));
  }, [memoryLimitMiB]);

  useEffect(() => {
    const closeProfileMenu = (event: PointerEvent) => {
      const menu = profileMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.removeAttribute('open');
      }
    };
    document.addEventListener('pointerdown', closeProfileMenu);
    return () => document.removeEventListener('pointerdown', closeProfileMenu);
  }, []);

  useEffect(() => {
    if (!window.gbfrDesktop) {
      setNotice('桌面接口没有加载。请从应用程序启动本工具。');
      return;
    }
    void window.gbfrDesktop.getEngineHello().then(setHello)
      .catch(() => setNotice('配装引擎没有启动。请重新打开应用。'));
    void window.gbfrDesktop.getCachedInventory().then(cached => {
      if (!cached) return;
      const cachedFingerprint = inventoryFingerprint(cached.stocks);
      setInventory(cached);
      updateWorkspace(current => pruneInvalidAnalysisCaches(current, cached, cachedFingerprint));
      const time = cached.cachedAt ? new Date(cached.cachedAt).toLocaleString('zh-CN') : '上次';
      const count = cached.stocks.reduce((sum, stock) => sum + stock.count, 0);
      setNotice(`已恢复 ${time} 读取的 ${cached.sourceDisplayName ?? '存档'} 库存，共 ${count} 个双词条因子；原存档没有重新读取。`);
    }).catch(() => setNotice('上次读取的因子缓存无法使用，请重新选择存档。'));
  }, []);

  useEffect(() => {
    if (resultScrollRequest === 0 || appPage !== 'planner') return undefined;
    const frame = window.requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
      setActivePageSection('results');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [appPage, resultScrollRequest]);

  useEffect(() => {
    setSaveStatus('saving');
    const timeout = window.setTimeout(() => {
      try {
        storeWorkspace(workspace);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('failed');
        setNotice('方案未能写入本地。请先复制分享字符串，再检查磁盘空间或应用数据权限。');
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [workspace]);

  useEffect(() => {
    const releaseResources = () => {
      try {
        storeWorkspace(workspaceRef.current);
      } catch {
        // The page is closing, so there is no reliable surface left for an error message.
      }
      activeRunRef.current = null;
      cancelSolverWork();
    };
    window.addEventListener('beforeunload', releaseResources);
    return () => {
      window.removeEventListener('beforeunload', releaseResources);
      cancelSolverWork();
    };
  }, []);

  useEffect(() => {
    setSelectedResultIndex(0);
    if (activeRunRef.current) cancelSolverWork();
    activeRunRef.current = null;
    dispatchAnalysis({
      type: 'restore',
      requestKey: activeRecord.cache ? `${activeRecord.id}:${activeRecord.cache.computedAt}` : null,
      current: cacheStatus === 'current'
    });
  }, [activeRecord.id]);

  useEffect(() => {
    if (activeDomain === 'basicSubstitutionOrder'
      && (!profile.forceBasicPrimary || !profile.allowBasicSubstitution)) {
      setActiveDomain('basicPrimary');
    }
  }, [activeDomain, profile.allowBasicSubstitution, profile.forceBasicPrimary]);

  useEffect(() => {
    if (appPage !== 'planner') return undefined;
    const targets = targetsRef.current;
    const results = resultsRef.current;
    if (!targets || !results) return undefined;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (visible?.target === results) setActivePageSection('results');
      if (visible?.target === targets) setActivePageSection('targets');
    }, { rootMargin: '-18% 0px -58% 0px', threshold: [0, 0.15, 0.4] });
    observer.observe(targets);
    observer.observe(results);
    return () => observer.disconnect();
  }, [appPage]);

  const primaryTargetCount = profile.basicPrimary.length + profile.attackPrimary.length + profile.defensePrimary.length;
  const targetCount = profile.mandatory.length + primaryTargetCount + profile.optional.length;
  const optionalLimit = Math.max(0, 24 - profile.mandatory.length - primaryTargetCount);
  const hasForcedPrimary = (profile.forceBasicPrimary && profile.basicPrimary.length > 0)
    || (profile.forceAttackPrimary && profile.attackPrimary.length > 0)
    || (profile.forceDefensePrimary && profile.defensePrimary.length > 0);
  const targetGroups: readonly { title: string; help: string; domains: readonly Domain[] }[] = [
    {
      title: '想要的技能',
      help: '必须满足、指定主词条和可选目标都属于配装目标。',
      domains: [
        'mandatory', 'basicPrimary', 'attackPrimary', 'defensePrimary',
        ...(profile.forceBasicPrimary && profile.allowBasicSubstitution ? ['basicSubstitutionOrder' as const] : []),
        'optional'
      ]
    },
    {
      title: '需要避开的技能',
      help: '“不能出现”会直接排除整套方案；“尽量避开”只会降低结果排名。',
      domains: ['forbidden', 'avoid']
    }
  ];
  const filteredTraits = useMemo(() => catalog.traits.filter(trait => {
    const normalized = search.trim().toLocaleLowerCase('zh-CN');
    return (category === 'all' || trait.category === category)
      && (!normalized || trait.nameZh.toLocaleLowerCase('zh-CN').includes(normalized)
        || trait.nameEn.toLocaleLowerCase('en-US').includes(normalized));
  }), [category, search]);

  function persistWorkspaceNow(next: WorkspaceState): boolean {
    workspaceRef.current = next;
    try {
      storeWorkspace(next);
      setSaveStatus('saved');
      return true;
    } catch {
      setSaveStatus('failed');
      setNotice('方案未能写入本地。请先复制分享字符串，再检查磁盘空间或应用数据权限。');
      return false;
    }
  }

  function invalidateAnalysis(message: string): void {
    if (activeRunRef.current) cancelSolverWork();
    activeRunRef.current = null;
    dispatchAnalysis({ type: 'invalidate', message });
    setSelectedResultIndex(0);
  }

  function cancelActiveRun(message: string): void {
    if (!activeRunRef.current) return;
    cancelSolverWork();
    activeRunRef.current = null;
    dispatchAnalysis({ type: 'invalidate', message });
  }

  function editProfile(update: (current: BuildProfile) => BuildProfile, message = '目标已修改，需要重新计算。'): void {
    updateWorkspace(current => {
      const record = current.profiles.find(item => item.id === current.activeProfileId)!;
      return updateStoredDraft(current, record.id, update(record.profile));
    });
    invalidateAnalysis(message);
  }

  function disabledReason(trait: CatalogTrait): string | null {
    if (!activeDomain) return '请先选择右侧要编辑的目标。';
    if (activeDomain === 'basicSubstitutionOrder'
      && (!profile.forceBasicPrimary || !profile.allowBasicSubstitution)) {
      return '请先勾选“数量不够时允许补位”。';
    }
    const requiredCategory = activeDomain === 'basicPrimary' || activeDomain === 'basicSubstitutionOrder'
      ? 'basic'
      : activeDomain === 'attackPrimary'
        ? 'attack'
        : activeDomain === 'defensePrimary' ? 'defense' : null;
    if (requiredCategory && trait.category !== requiredCategory) {
      const categoryName = catalog.categories.find(item => item.id === requiredCategory)?.nameZh ?? requiredCategory;
      return `这里仅可添加${categoryName}技能。`;
    }
    if (primaryDomains.has(activeDomain) && !trait.canPrimary) return '这个技能不能放在因子的第一个词条。';
    const current = targetList(profile, activeDomain);
    if (primaryDomains.has(activeDomain) && primaryTargetCount >= 12) return '一套配装最多只有 12 个主词条位置。';
    if (!duplicateDomains.has(activeDomain) && current.includes(trait.id)) return '这里不能重复添加同一技能。';
    if (activeDomain === 'optional' && current.length >= optionalLimit) return `可选目标当前最多添加 ${optionalLimit} 项。`;
    if (activeDomain !== 'optional' && duplicateDomains.has(activeDomain)
      && targetCount >= 24) {
      return '24 个目标位置已经用完。';
    }
    const allDomains: Domain[] = [
      'mandatory', 'basicPrimary', 'attackPrimary', 'defensePrimary',
      'optional', 'basicSubstitutionOrder', 'forbidden', 'avoid'
    ];
    for (const domain of allDomains) {
      if (domain === activeDomain) continue;
      if (domain === 'basicSubstitutionOrder'
        && (!profile.forceBasicPrimary || !profile.allowBasicSubstitution)) continue;
      if ((domain === 'mandatory' && activeDomain === 'optional')
        || (domain === 'optional' && activeDomain === 'mandatory')) continue;
      if (targetList(profile, domain).includes(trait.id)) return `已添加到“${sectionMeta[domain].title}”。`;
    }
    return null;
  }

  function addTrait(trait: CatalogTrait): void {
    const reason = disabledReason(trait);
    if (reason || !activeDomain) return;
    editProfile(current => withTargetList(current, activeDomain, [...targetList(current, activeDomain), trait.id]));
  }

  function removeTrait(domain: Domain, index: number): void {
    editProfile(current => withTargetList(current, domain,
      targetList(current, domain).filter((_, itemIndex) => itemIndex !== index)));
  }

  function moveTrait(domain: Domain, index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    const values = targetList(profile, domain);
    if (nextIndex < 0 || nextIndex >= values.length) return;
    editProfile(current => {
      const reordered = [...targetList(current, domain)];
      const [moved] = reordered.splice(index, 1);
      if (!moved) return current;
      reordered.splice(nextIndex, 0, moved);
      return withTargetList(current, domain, reordered);
    }, `已调整“${sectionMeta[domain].title}”的优先顺序，需要重新计算。`);
  }

  function clearDomain(domain: Domain): void {
    if (!targetList(profile, domain).length) return;
    editProfile(current => withTargetList(current, domain, []), `已清空“${sectionMeta[domain].title}”，需要重新计算。`);
    setNotice(`已清空“${sectionMeta[domain].title}”。`);
  }

  function setPrimaryPriority(domain: Domain, enabled: boolean): void {
    if (!primaryDomains.has(domain)) return;
    editProfile(current => {
      if (domain === 'basicPrimary') {
        return {
          ...current,
          forceBasicPrimary: enabled,
          allowBasicSubstitution: enabled ? current.allowBasicSubstitution : false
        };
      }
      if (domain === 'attackPrimary') return { ...current, forceAttackPrimary: enabled };
      return { ...current, forceDefensePrimary: enabled };
    });
  }

  async function importSave(): Promise<void> {
    if (!window.gbfrDesktop) {
      setNotice('桌面接口没有加载，请重新打开应用。');
      return;
    }
    setImporting(true);
    try {
      const grant = await window.gbfrDesktop.chooseSaveFile();
      if (!grant) return;
      const imported = await window.gbfrDesktop.importSaveFile(grant.grantId);
      setInventory(imported);
      const importedFingerprint = inventoryFingerprint(imported.stocks);
      updateWorkspace(current => pruneInvalidAnalysisCaches(current, imported, importedFingerprint));
      invalidateAnalysis('库存已更新，需要重新计算。');
      const count = imported.stocks.reduce((sum, stock) => sum + stock.count, 0);
      setNotice(`${grant.displayName}：读到 ${count} 个双词条因子。原文件没有改动；建议你另行保留游戏存档备份。`);
    } catch {
      setNotice('存档读取失败。请确认选择的是 SaveData*.dat，且文件没有损坏。');
    } finally {
      setImporting(false);
    }
  }

  function scrollToSection(section: PageSection): void {
    const target = section === 'targets' ? targetsRef.current : resultsRef.current;
    target?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
    setActivePageSection(section);
  }

  async function analyze(force = false): Promise<void> {
    if (!inventory || analysisRun.phase === 'running') return;
    const context = createAnalysisContext(
      profile, activeRecord.id, inventory, workspace, currentInventoryFingerprint ?? undefined);
    if (context.unresolvedLegacyReservationProfiles.length) {
      setNotice(`“${context.unresolvedLegacyReservationProfiles.join('、')}”是旧版确认记录，当前库存无法核对。请先检查并取消旧配装，再开始分析。`);
      return;
    }
    const currentStatus = getCacheStatus(activeRecord.cache, context);
    if (!force && activeRecord.cache && currentStatus === 'current') {
      dispatchAnalysis({ type: 'restore', requestKey: context.requestKey, current: true });
      setNotice('已打开上次计算结果。');
      setResultScrollRequest(current => current + 1);
      return;
    }

    const validatedProfile = decodeProfile(encodeProfile({ ...profile, name: profile.name.trim() }), catalog);
    const runSeed = Date.now() >>> 0;
    const runId = analysisRun.runId + 1;
    activeRunRef.current = { runId, requestKey: context.requestKey };
    dispatchAnalysis({ type: 'start', requestKey: context.requestKey });
    setNotice(`正在从 ${context.availableInventory.length} 个可用因子中组合方案…`);
    try {
      const result = await solveInWorker({
        profile: validatedProfile,
        catalog,
        inventory: context.availableInventory,
        maxSlots: 12,
        resultLimit: 10,
        runSeed,
        timeLimitMs: solveTimeLimitSeconds * 1_000,
        memoryLimitMiB
      });
      const activeRun = activeRunRef.current;
      if (!activeRun || activeRun.runId !== runId || activeRun.requestKey !== context.requestKey) return;
      updateWorkspace(current => cacheAnalysis(current, activeRecord.id, context, runSeed, result));
      activeRunRef.current = null;
      dispatchAnalysis({ type: 'resolve', runId, requestKey: context.requestKey });
      setSelectedResultIndex(0);
      setNotice(result.status === 'completed'
        ? `计算完成，找到 ${result.results.length} 套方案。`
        : '没有方案能满足所有必须项。');
      setResultScrollRequest(current => current + 1);
    } catch (error) {
      if (!activeRunRef.current || activeRunRef.current.runId !== runId) return;
      activeRunRef.current = null;
      const errorCode = error instanceof Error ? error.message : '未知错误';
      const message = errorCode === 'solver.time_limit'
        ? `计算达到 ${solveTimeLimitSeconds} 秒上限。可以提高计算上限，或减少可选目标后重试。`
        : errorCode === 'solver.memory_limit'
          ? `计算达到 ${memoryLimitMiB} MB 内存预算。可以谨慎提高内存预算，或减少可选目标后重试。`
        : errorCode === 'solver.complexity_limit'
          ? '组合状态超过安全容量。延长时间通常无效，请减少可选目标，或增加“不能出现”的技能后重试。'
          : errorCode === 'solver.resource_limit'
            ? '计算达到安全上限。请简化目标后重试。'
            : errorCode;
      dispatchAnalysis({ type: 'reject', runId, message });
      setNotice(`计算失败：${message}`);
    }
  }

  function saveProfileNow(): void {
    try {
      const validated = decodeProfile(encodeProfile({ ...profile, name: profile.name.trim() }), catalog);
      const next = updateStoredDraft(workspace, activeRecord.id, validated);
      updateWorkspace(() => next);
      if (persistWorkspaceNow(next)) setNotice(`“${validated.name}”已保存。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '当前方案无法保存。');
    }
  }

  function createProfileCopy(): void {
    const baseName = profile.name.trim() || '未命名方案';
    let name = `${baseName} 副本`;
    let suffix = 2;
    while (workspace.profiles.some(item => item.profile.name === name)) name = `${baseName} 副本 ${suffix++}`;
    const next = addStoredProfile(workspace, { ...profile, name });
    updateWorkspace(() => next);
    if (persistWorkspaceNow(next)) setNotice(`已新建“${name}”。`);
  }

  function deleteProfile(): void {
    if (workspace.profiles.length <= 1) {
      setNotice('至少保留一个方案。');
      return;
    }
    if (activeRecord.confirmed && !window.confirm('这个方案已经确认配装。删除后会释放它占用的因子，是否继续？')) return;
    if (!activeRecord.confirmed && !window.confirm(`确定删除“${profile.name}”吗？`)) return;
    let next = deleteStoredProfile(workspace, activeRecord.id);
    if (inventory && currentInventoryFingerprint) {
      next = pruneInvalidAnalysisCaches(next, inventory, currentInventoryFingerprint);
    }
    updateWorkspace(() => next);
    if (persistWorkspaceNow(next)) setNotice('方案已删除。');
  }

  function openShare(): void {
    try {
      const validated = decodeProfile(encodeProfile({ ...profile, name: profile.name.trim() }), catalog);
      setShareCode(encodeProfile(validated));
      setShareOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '当前方案无法分享。');
    }
  }

  function importShare(): void {
    try {
      const imported = decodeProfile(shareCode, catalog);
      const next = addStoredProfile(workspace, imported);
      updateWorkspace(() => next);
      if (!persistWorkspaceNow(next)) return;
      setShareOpen(false);
      setNotice(`已导入“${imported.name}”。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '分享字符串无法读取。');
    }
  }

  function confirmSelectedResult(result: SolverResult): void {
    if (!inventory || !analysisContext || cacheStatus !== 'current') {
      setNotice('当前结果已经过期，请重新计算后再确认。');
      return;
    }
    const conflicts = findReservationConflicts(workspace, activeRecord.id, result, inventory);
    if (conflicts.length) {
      const names = [...new Set(conflicts.map(item => item.profileName).filter(Boolean))];
      setNotice(names.length
        ? `无法确认：可用数量不足，相关占用来自“${names.join('、')}”。`
        : '无法确认：当前库存数量不足。');
      return;
    }
    try {
      cancelActiveRun('因子占用已变化，本次计算已停止。');
      const confirmed = confirmResult(
        workspace, activeRecord.id, result, analysisContext.inventoryFingerprint, inventory);
      const next = pruneInvalidAnalysisCaches(
        confirmed, inventory, currentInventoryFingerprint ?? analysisContext.inventoryFingerprint);
      updateWorkspace(() => next);
      if (persistWorkspaceNow(next)) {
        setNotice(`已确认“${profile.name}”的配装。其他方案计算时会扣除对应库存数量。`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '这套配装无法确认。');
    }
  }

  function releaseLoadoutFor(profileId: string): void {
    const record = workspace.profiles.find(item => item.id === profileId);
    if (!record?.confirmed) return;
    if (!window.confirm(`取消“${record.profile.name}”的已确认配装，并释放这些因子吗？`)) return;
    cancelActiveRun('因子占用已变化，本次计算已停止。');
    const released = releaseConfirmedResult(workspace, profileId);
    const next = inventory && currentInventoryFingerprint
      ? pruneInvalidAnalysisCaches(released, inventory, currentInventoryFingerprint)
      : released;
    updateWorkspace(() => next);
    if (persistWorkspaceNow(next)) setNotice('已取消确认，因子可以用于其他方案。');
  }

  function releaseLoadout(): void {
    releaseLoadoutFor(activeRecord.id);
  }

  function applyManualSelection(
    source: SolverResult,
    current: SolverResult,
    selected: readonly LogicalSigil[],
    message: string
  ): void {
    if (!inventory || !analysisContext || cacheStatus !== 'current') {
      setNotice('当前结果已经过期，请重新计算后再调整。');
      return;
    }
    const allowedKeys = new Set(analysisContext.availableInventory.map(factorInstanceKey));
    const selectedKeys = selected.map(factorInstanceKey);
    if (new Set(selectedKeys).size !== selectedKeys.length) {
      setNotice('同一枚因子不能在一套配装中重复使用。');
      return;
    }
    if (selectedKeys.some(key => !allowedKeys.has(key))) {
      setNotice('所选因子已经不在可用库存中，请重新计算。');
      return;
    }
    try {
      const adjusted = evaluateAdjustedResult(source, profile, catalog, selected);
      const stored = hasSameLogicalSelection(source.selected, selected) ? undefined : adjusted;
      updateWorkspace(currentWorkspace =>
        storeManualResult(currentWorkspace, activeRecord.id, source.signature, stored));
      setNotice(stored ? `${message}；目标完成情况已更新。` : '已恢复为原计算结果。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法调整这套配装。');
    }
  }

  function replaceManualInstance(
    source: SolverResult,
    current: SolverResult,
    index: number,
    instanceKey: string
  ): void {
    const replacement = analysisContext?.availableInventory
      .find(sigil => factorInstanceKey(sigil) === instanceKey);
    if (!replacement) {
      setNotice('这枚因子已经不可用，请重新选择。');
      return;
    }
    const selected = current.selected.map((sigil, selectedIndex) =>
      selectedIndex === index ? replacement : sigil);
    applyManualSelection(source, current, selected, `已更换因子 ${index + 1}`);
  }

  function deleteManualInstance(source: SolverResult, current: SolverResult, index: number): void {
    applyManualSelection(
      source,
      current,
      current.selected.filter((_, selectedIndex) => selectedIndex !== index),
      `已删除因子 ${index + 1}`
    );
  }

  function resetManualResult(sourceSignature: string): void {
    updateWorkspace(current =>
      storeManualResult(current, activeRecord.id, sourceSignature, undefined));
    setFactorPicker(null);
    setNotice('已恢复为原计算结果。');
  }

  const recordStatus = useMemo(() => new Map(workspace.profiles.map(record => {
    if (record.confirmed) {
      const missing = inventory
        ? confirmedAllocationShortfall(workspace, record.id, inventory) > 0
        : false;
      return [record.id, missing ? '确认需检查' : '已确认'] as const;
    }
    if (!record.cache) return [record.id, '未计算'] as const;
    if (!inventory || !currentInventoryFingerprint) return [record.id, '有缓存'] as const;
    const context = createAnalysisContext(
      record.profile, record.id, inventory, workspace, currentInventoryFingerprint);
    return [record.id, cacheStatusText(getCacheStatus(record.cache, context), true)] as const;
  })), [currentInventoryFingerprint, inventory, workspace]);

  const canAnalyze = !!inventory
    && targetCount > 0
    && analysisRun.phase !== 'running';
  const selectedSourceResult = analysis?.results[
    Math.min(selectedResultIndex, Math.max(0, analysis.results.length - 1))];
  const selectedResult = selectedSourceResult
    ? activeRecord.cache?.manualResults?.[selectedSourceResult.signature] ?? selectedSourceResult
    : undefined;
  const confirmedRecords = workspace.profiles.filter(record => record.confirmed);
  const loadoutNames = useMemo(() => confirmedDisplayNames(workspace.profiles), [workspace.profiles]);
  const selectedLoadoutRecord = confirmedRecords.find(record => record.id === selectedLoadoutProfileId)
    ?? confirmedRecords[0];
  const selectedLoadoutResult = selectedLoadoutRecord?.confirmed?.result
    ?? selectedLoadoutRecord?.cache?.analysis.results.find(result =>
      result.signature === selectedLoadoutRecord.confirmed?.resultSignature);

  useEffect(() => {
    if (appPage !== 'loadouts') return;
    if (selectedLoadoutProfileId && confirmedRecords.some(record => record.id === selectedLoadoutProfileId)) return;
    setSelectedLoadoutProfileId(confirmedRecords[0]?.id ?? null);
  }, [appPage, confirmedRecords, selectedLoadoutProfileId]);
  const reservationsByGroup = useMemo(() => {
    const reservations = new Map<string, { count: number; names: string[] }>();
    for (const record of workspace.profiles) {
      if (!record.confirmed) continue;
      const name = loadoutNames.get(record.id) ?? record.profile.name;
      const grouped = record.confirmed.groupReservations ?? [];
      for (const allocation of grouped) {
        const current = reservations.get(allocation.groupKey) ?? { count: 0, names: [] };
        current.count += allocation.count;
        if (!current.names.includes(name)) current.names.push(name);
        reservations.set(allocation.groupKey, current);
      }
    }
    return reservations;
  }, [loadoutNames, workspace.profiles]);
  const filteredInventory = useMemo(() => {
    if (!inventory) return [];
    const normalized = inventorySearch.trim().toLocaleLowerCase('zh-CN');
    return inventory.stocks.map(stock => {
      const reservation = reservationsByGroup.get(stock.groupKey);
      const representative: LogicalSigil = {
        groupKey: stock.groupKey,
        stockOrdinal: 0,
        primaryTraitHash: stock.primaryTraitHash,
        secondaryTraitHash: stock.secondaryTraitHash,
        sigilLevel: stock.sigilLevel
      };
      return {
        groupKey: stock.groupKey,
        representative,
        members: [representative],
        count: stock.count,
        reservedCount: reservation?.count ?? 0,
        availableCount: Math.max(0, stock.count - (reservation?.count ?? 0)),
        reservedNames: reservation?.names ?? [],
        wornCount: stock.wornCount
      };
    }).filter(group => {
      const sigil = group.representative;
      const primary = traitByHash.get(sigil.primaryTraitHash >>> 0);
      const secondary = traitByHash.get(sigil.secondaryTraitHash >>> 0);
      if (inventoryCategory !== 'all'
        && primary?.category !== inventoryCategory
        && secondary?.category !== inventoryCategory) return false;
      if (inventoryStatus === 'available' && group.availableCount <= 0) return false;
      if (inventoryStatus === 'reserved' && group.reservedCount <= 0) return false;
      if (inventoryStatus === 'equipped' && group.wornCount <= 0) return false;
      if (normalized && ![
        primary?.nameZh, primary?.nameEn, secondary?.nameZh, secondary?.nameEn,
        String(sigil.sigilLevel)
      ].some(value => value?.toLocaleLowerCase('zh-CN').includes(normalized))) return false;
      return true;
    }).sort((left, right) => {
      const leftSigil = left.representative;
      const rightSigil = right.representative;
      if (inventorySort === 'level') {
        return rightSigil.sigilLevel - leftSigil.sigilLevel
          || left.groupKey.localeCompare(right.groupKey);
      }
      if (inventorySort === 'primary') {
        const leftName = traitByHash.get(leftSigil.primaryTraitHash >>> 0)?.nameZh ?? '未知词条';
        const rightName = traitByHash.get(rightSigil.primaryTraitHash >>> 0)?.nameZh ?? '未知词条';
        return leftName.localeCompare(rightName, 'zh-CN') || left.groupKey.localeCompare(right.groupKey);
      }
      const leftName = traitByHash.get(leftSigil.secondaryTraitHash >>> 0)?.nameZh ?? '未知词条';
      const rightName = traitByHash.get(rightSigil.secondaryTraitHash >>> 0)?.nameZh ?? '未知词条';
      return leftName.localeCompare(rightName, 'zh-CN') || left.groupKey.localeCompare(right.groupKey);
    });
  }, [
    inventory, inventoryCategory, inventorySearch, inventorySort, inventoryStatus,
    reservationsByGroup, traitByHash
  ]);
  const inventoryPageSize = 48;
  const inventoryPageCount = Math.max(1, Math.ceil(filteredInventory.length / inventoryPageSize));
  const safeInventoryPage = Math.min(inventoryPage, inventoryPageCount - 1);
  const visibleInventory = filteredInventory.slice(
    safeInventoryPage * inventoryPageSize,
    (safeInventoryPage + 1) * inventoryPageSize);

  useEffect(() => {
    setInventoryPage(0);
  }, [inventory?.inventoryId, inventoryCategory, inventorySearch, inventorySort, inventoryStatus]);

  return <main>
    <header className="topbar">
      <div className="topbar-leading">
        <div className="brand"><Sparkles size={20} aria-hidden="true" /><div><h1>因子罗盘</h1><p>GBFR Ver. {catalog.gameVersion} · 离线只读</p></div></div>
        <nav className="app-nav" aria-label="主要页面">
          <button type="button" aria-current={appPage === 'planner' ? 'page' : undefined}
            className={appPage === 'planner' ? 'active' : ''} onClick={() => setAppPage('planner')}>
            <ListChecks size={16} />配装设计
          </button>
          <button type="button" aria-current={appPage === 'inventory' ? 'page' : undefined}
            className={appPage === 'inventory' ? 'active' : ''} onClick={() => setAppPage('inventory')}>
            <LayoutList size={16} />持有因子
          </button>
          <button type="button" aria-current={appPage === 'loadouts' ? 'page' : undefined}
            className={appPage === 'loadouts' ? 'active' : ''} onClick={() => {
            setSelectedLoadoutProfileId(current => current && confirmedRecords.some(item => item.id === current)
              ? current
              : confirmedRecords[0]?.id ?? null);
            setAppPage('loadouts');
          }}>
            <CheckCircle2 size={16} />已确认配装{confirmedRecords.length ? ` ${confirmedRecords.length}` : ''}
          </button>
        </nav>
      </div>
      {appPage === 'planner' && <div className="profile-tools">
        <label className="sr-only" htmlFor="profile-name">方案名称</label>
        <input id="profile-name" className="profile-name" value={profile.name} maxLength={60}
          onChange={event => updateWorkspace(current => updateStoredDraft(current, activeRecord.id,
            { ...profile, name: event.target.value }))} />
        <div className="saved-picker">
          <Archive size={16} aria-hidden="true" />
          <select aria-label="切换本地方案" value={activeRecord.id} onChange={event => {
            const nextId = event.target.value;
            if (activeRunRef.current) cancelSolverWork();
            activeRunRef.current = null;
            updateWorkspace(current => ({ ...current, activeProfileId: nextId }));
            setActiveDomain('mandatory');
            setNotice('已切换方案。');
          }}>{workspace.profiles.map(item => <option key={item.id} value={item.id}>
            {item.profile.name} · {recordStatus.get(item.id) ?? '未计算'}
          </option>)}</select>
          <ChevronDown size={14} aria-hidden="true" />
        </div>
        <span className={`autosave-status ${saveStatus}`} role="status">
          {saveStatus === 'failed' ? <AlertTriangle size={14} /> : <Check size={14} />}
          {saveStatus === 'saving' ? '保存中…' : saveStatus === 'failed' ? '保存失败' : '已自动保存'}
        </span>
        <details className="profile-menu" ref={profileMenuRef}>
          <summary className="secondary-action"><MoreHorizontal size={17} />方案操作</summary>
          <div className="profile-menu-panel">
            <button type="button" onClick={createProfileCopy}><Plus size={16} />复制为新方案</button>
            <button type="button" onClick={saveProfileNow}><Check size={16} />检查并保存</button>
            <button type="button" onClick={openShare}><Clipboard size={16} />分享或导入</button>
            <button type="button" className="danger-action" onClick={deleteProfile}><Trash2 size={16} />删除当前方案</button>
          </div>
        </details>
      </div>}
    </header>

    <section className="commandbar">
      <div className={`engine-status ${hello ? 'ready' : ''}`}><ShieldCheck size={17} />
        {hello ? `技能资料 ${catalog.gameVersion}` : '正在启动引擎'}</div>
      <button className="secondary-action" type="button" disabled={importing} onClick={() => void importSave()}>
        <FileUp size={17} />{importing ? '读取中…' : '读取存档'}
      </button>
      <HelpPopover label="存档位置" text={'Windows 默认位置：%LOCALAPPDATA%\\GBFR\\Saved\\SaveGames\\。通常选择 SaveData1.dat；如果有多个 SaveData*.dat，请选择修改时间最新的一个。应用只读取，不会修改存档；操作前仍建议自行备份。'} />
      <div className="inventory-summary">{inventory
        ? <>
          <span className="inventory-summary-line">
            <Database size={17} /><strong>{inventory.stocks.reduce((sum, stock) => sum + stock.count, 0)}</strong>
            个双词条因子 · {analysisContext?.availableInventory.length ?? 0} 个当前可用
          </span>
          {inventory.cachedAt && <span className="inventory-summary-line">
            · 读取于 {new Date(inventory.cachedAt).toLocaleString('zh-CN')}
          </span>}
        </>
        : <span className="inventory-summary-line">尚未读取存档</span>}</div>
      {appPage === 'planner' && <label className="solve-time-limit">
        <span>计算上限</span>
        <input type="number" min={MIN_SOLVE_TIME_LIMIT_SECONDS} max={MAX_SOLVE_TIME_LIMIT_SECONDS}
          disabled={analysisRun.phase === 'running'}
          value={solveTimeLimitSeconds} onChange={event => {
            const value = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(value)) setSolveTimeLimitSeconds(Math.max(
              MIN_SOLVE_TIME_LIMIT_SECONDS, Math.min(value, MAX_SOLVE_TIME_LIMIT_SECONDS)));
          }} />
        <span>秒</span>
        <HelpPopover label="计算上限说明" text="单次计算默认最多运行 30 秒，可设为 5–600 秒。复杂配置会自动改用更省内存的精确计算；如果仍超时，可适当提高这里的时间。" />
      </label>}
      {appPage === 'planner' && <label className="solve-time-limit">
        <span>快速计算内存</span>
        <input type="number" min={MIN_MEMORY_LIMIT_MIB} max={MAX_MEMORY_LIMIT_MIB} step={128}
          disabled={analysisRun.phase === 'running'}
          value={memoryLimitMiB} onChange={event => {
            const value = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(value)) setMemoryLimitMiB(Math.max(
              MIN_MEMORY_LIMIT_MIB, Math.min(value, MAX_MEMORY_LIMIT_MIB)));
          }} />
        <span>MB</span>
        <HelpPopover label="内存预算说明" text="默认 512 MB，可设为 128–2048 MB。快速计算达到该值后会自动切换为更省内存的精确计算，不会仅因组合数量太多而停止。此数值不是系统硬限制，实际占用会有浮动。" />
      </label>}
      <button className="secondary-action" type="button" onClick={() => void window.gbfrDesktop.openProjectPage()}>
        <ExternalLink size={17} />GitHub
      </button>
      {appPage === 'planner' && <button className="primary-action" type="button" disabled={!canAnalyze} onClick={() => void analyze(false)}>
        <Play size={17} fill="currentColor" />{analysisRun.phase === 'running' ? '计算中…' : '开始分析'}
      </button>}
    </section>

    <div className="noticebar" role="status">{notice}</div>

    {appPage === 'planner' ? <>
    <section className="workspace" aria-label="目标编辑器" ref={targetsRef} id="target-editor">
      <aside className="pool">
        <label className="active-target-picker">
          <span>当前添加到</span>
          <select value={activeDomain ?? ''} onChange={event =>
            setActiveDomain((event.target.value || null) as Domain | null)}>
            <option value="">暂不添加</option>
            {targetGroups.flatMap(group => group.domains).map(domain =>
              <option value={domain} key={domain}>{sectionMeta[domain].title}</option>)}
          </select>
        </label>
        <div className="search-wrap"><Search size={18} /><label className="sr-only" htmlFor="skill-search">搜索技能</label>
          <input id="skill-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索技能名称" />
          {search && <button type="button" aria-label="清空搜索" onClick={() => setSearch('')}><X size={16} /></button>}</div>
        <AccessibleTabs ariaLabel="技能分类" className="category-tabs" itemClassName="category-tab"
          value={category} onChange={setCategory} panelId="skill-options"
          items={[
            { id: 'all', label: '全部' },
            ...catalog.categories.filter(item => item.id !== 'unknown')
              .map(item => ({ id: item.id, label: item.nameZh }))
          ]} />
        <div className="pool-context">{activeDomain ? <>点击技能添加到 <strong>{sectionMeta[activeDomain].title}</strong></> : '先选择右侧一个目标'}</div>
        <div className="skill-grid" id="skill-options" role="tabpanel">
          {filteredTraits.map(trait => {
            const reason = disabledReason(trait);
            return <button type="button" key={trait.id} className={`skill-option cat-${trait.category} ${reason ? 'disabled' : ''}`}
              aria-disabled={!!reason} aria-label={reason ? `${trait.nameZh}，不可选择：${reason}` : trait.nameZh}
              title={reason ?? `${trait.nameZh} · ${trait.nameEn}`} onClick={() => addTrait(trait)}>
              <TraitIcon trait={trait} size={27} />
              <span>{trait.nameZh}</span>
              {reason && <LockKeyhole className="skill-lock" size={13} aria-hidden="true" />}
            </button>;
          })}
        </div>
      </aside>

      <div className="targets">
        {targetGroups.map(group => <section className="target-group" key={group.title}>
          <header className="target-group-heading">
            <div><h2>{group.title}</h2><p>{group.help}</p></div>
          </header>
          <div className="target-group-grid">
            {group.domains.map(domain => {
              const meta = sectionMeta[domain];
              const values = targetList(profile, domain);
              const active = activeDomain === domain;
              const forcePrimary = domain === 'basicPrimary'
                ? profile.forceBasicPrimary
                : domain === 'attackPrimary'
                  ? profile.forceAttackPrimary
                  : domain === 'defensePrimary' ? profile.forceDefensePrimary : false;
              return <section key={domain} className={`target tone-${meta.tone} ${active ? 'active' : ''}`}
                aria-label={`${meta.title}${active ? '，当前正在编辑' : ''}`}
                onClick={() => setActiveDomain(current => current === domain ? null : domain)}>
                <div className="target-title">
                  <h3>{meta.title}</h3>
                  {domain === 'optional' && <span className="capacity">{values.length} / {optionalLimit}</span>}
                  <button className="target-toggle" type="button" aria-pressed={active}
                    aria-label={active ? `停止编辑${meta.title}` : `编辑${meta.title}`}
                    onClick={event => {
                      event.stopPropagation();
                      setActiveDomain(current => current === domain ? null : domain);
                    }}>{active ? <Check size={14} /> : '选择'}</button>
                  <button className="clear-target" type="button" disabled={!values.length} title={`清空${meta.title}`}
                    onClick={event => { event.stopPropagation(); clearDomain(domain); }}><Eraser size={14} />清空</button>
                  <HelpPopover label={meta.title} text={domain === 'optional'
                    ? `${meta.help} 最多可选 ${optionalLimit} 项，因为一套配装只有 24 个技能位置，必须满足和三类主词条目标已经占用 ${24 - optionalLimit} 个。`
                    : meta.help} />
                </div>
                {primaryDomains.has(domain) && <div className="inline-options" onClick={event => event.stopPropagation()}>
                  <label><input type="checkbox" checked={forcePrimary}
                    onChange={event => setPrimaryPriority(domain, event.target.checked)} />优先满足这些主词条</label>
                  {domain === 'basicPrimary' && profile.forceBasicPrimary && <label><input type="checkbox" checked={profile.allowBasicSubstitution} onChange={event => editProfile(current => ({
                    ...current, allowBasicSubstitution: event.target.checked
                  }))} />凑不齐时允许其他基础主词条补足数量</label>}
                </div>}
                {active && <span className="active-hint"><Check size={13} />正在添加到这里</span>}
                <div className="target-items">
                  {values.length === 0 && <span className="empty">选择此区域，再从左侧添加技能</span>}
                  {values.map((id, index) => {
                    const trait = traitById.get(id);
                    const ordered = domain !== 'mandatory' && domain !== 'forbidden' && domain !== 'avoid';
                    return <div key={targetOccurrenceKey(values, index)} className="target-chip"
                      onClick={event => event.stopPropagation()}>
                      {ordered && <span className="target-order" aria-label={`优先级 ${index + 1}`}>{index + 1}</span>}
                      <TraitIcon trait={trait} size={22} /><span className="target-chip-name">{trait?.nameZh ?? id}</span>
                      {ordered && <span className="target-chip-moves">
                        <button type="button" disabled={index === 0}
                          aria-label={`上移${trait?.nameZh ?? id}`}
                          onClick={event => { event.stopPropagation(); moveTrait(domain, index, -1); }}>
                          <MoveUp size={13} />
                        </button>
                        <button type="button" disabled={index === values.length - 1}
                          aria-label={`下移${trait?.nameZh ?? id}`}
                          onClick={event => { event.stopPropagation(); moveTrait(domain, index, 1); }}>
                          <MoveDown size={13} />
                        </button>
                      </span>}
                      <button type="button" className="target-chip-delete" aria-label={`删除${trait?.nameZh ?? id}`}
                        onClick={event => { event.stopPropagation(); removeTrait(domain, index); }}>
                        <X size={13} />
                      </button>
                    </div>;
                  })}
                </div>
              </section>;
            })}
          </div>
        </section>)}
      </div>
    </section>

    <section className="results" aria-label="分析结果" ref={resultsRef} id="build-results">
      <div className="results-heading">
        <div><h2>配装方案</h2><p>一次查看一套方案。每张卡是一枚配装因子。</p></div>
        <div className="results-heading-actions">
          {analysis && <HelpPopover label="结果标记"
            text="灰色词条没有出现在任何配装目标中；红色提示表示尽量避开或不能出现的问题，优先级高于灰色标记。" />}
          {analysis && <HelpPopover label="本次计算"
            text={`本次从 ${analysis.candidateTypeCount} 种相关因子中检索了 ${analysis.exploredStateCount.toLocaleString('zh-CN')} 个组合状态。排序时先满足必须项和已开启优先满足的主词条，再比较可选目标、需避开的技能、因子数量与等级。`} />}
          {inventory && analysis && <button className="secondary-action compact" type="button" disabled={analysisRun.phase === 'running'} onClick={() => void analyze(true)}>
            <RotateCcw size={15} />重新计算
          </button>}
        </div>
      </div>

      {activeRecord.cache && cacheStatus !== 'current' && <div className="stale-results" role="status">
        <AlertTriangle size={18} />
        <div><strong>这份结果需要重新计算</strong><span>{cacheStatusText(cacheStatus, true)}。旧结果仍可查看，但不能确认配装。</span></div>
      </div>}
      {!analysis && <div className="empty-results"><Database size={28} /><p>读取存档并开始分析后，结果会显示在这里。</p></div>}
      {analysis?.status === 'no-solution' && <div className="no-solution"><AlertTriangle size={22} />没有方案能同时满足所有必须项，并避开不能出现的技能。</div>}
      {analysis?.status === 'completed' && <>
        <AccessibleTabs ariaLabel="切换配装方案" className="result-tabs" itemClassName="result-tab"
          value={selectedSourceResult?.signature ?? ''} panelId="selected-result" tabIdPrefix="result-tab"
          onChange={signature => {
            const index = analysis.results.findIndex(result => result.signature === signature);
            if (index >= 0) {
              setSelectedResultIndex(index);
              setFactorPicker(null);
            }
          }}
          items={analysis.results.map((result, index) => {
            const displayed = activeRecord.cache?.manualResults?.[result.signature] ?? result;
            const issues = resultIssueLabels(displayed, profile);
            return {
              id: result.signature,
              label: <>{issues.length > 0 && <AlertTriangle size={14} />}
                {displayed.manuallyAdjusted && <Pencil size={13} />}方案 {index + 1}</>,
              className: `${issues.length ? 'has-issue' : ''} ${displayed.manuallyAdjusted ? 'is-manual' : ''}`.trim(),
              title: issues.length ? issues.join('；') : '没有明显问题'
            };
          })} />

        {selectedResult && selectedSourceResult && (() => {
          const issues = resultIssueLabels(selectedResult, profile);
          const confirmedHere = activeRecord.confirmed?.resultSignature === selectedResult.signature;
          const canEdit = !!inventory && !!analysisContext && cacheStatus === 'current';
          const selectedKeys = new Set(selectedResult.selected.map(factorInstanceKey));
          const forbiddenHashes = new Set(profile.forbidden.flatMap(id => {
            const trait = traitById.get(id);
            return trait ? [Number.parseInt(trait.hash.slice(2), 16) >>> 0] : [];
          }));
          const normalizedPickerSearch = factorPickerSearch.trim().toLocaleLowerCase('zh-CN');
          const pickerCandidates = factorPicker?.sourceSignature === selectedSourceResult.signature
            ? groupInventory((analysisContext?.availableInventory ?? [])
              .filter(sigil => {
                const key = factorInstanceKey(sigil);
                const replacingKey = factorPicker.mode === 'replace' && factorPicker.index !== undefined
                  ? factorInstanceKey(selectedResult.selected[factorPicker.index]!)
                  : null;
                if (selectedKeys.has(key) && key !== replacingKey) return false;
                if (key === replacingKey) return false;
                if (forbiddenHashes.has(sigil.primaryTraitHash >>> 0)
                  || forbiddenHashes.has(sigil.secondaryTraitHash >>> 0)) return false;
                if (!normalizedPickerSearch) return true;
                const primary = traitByHash.get(sigil.primaryTraitHash >>> 0)?.nameZh ?? '未知词条';
                const secondary = traitByHash.get(sigil.secondaryTraitHash >>> 0)?.nameZh ?? '未知词条';
                return `${primary} ${secondary} ${sigil.sigilLevel}`
                  .toLocaleLowerCase('zh-CN').includes(normalizedPickerSearch);
              }))
              .sort((left, right) =>
                right.representative.sigilLevel - left.representative.sigilLevel
                || left.groupKey.localeCompare(right.groupKey))
            : [];
          return <article className="result-detail" role="tabpanel" id="selected-result"
            aria-labelledby={`result-tab-${selectedResultIndex}`}>
            <div className={`result-problems ${issues.length ? 'visible' : 'clear'}`}>
              {issues.length
                ? <><AlertTriangle size={19} /><div><strong>这套方案需要留意</strong><span>{issues.join('；')}。</span></div></>
                : <><CheckCircle2 size={19} /><div><strong>没有明显问题</strong><span>指定目标和避开条件均按当前结果处理。</span></div></>}
            </div>

            {selectedResult.manuallyAdjusted && <div className="manual-result-note">
              <Pencil size={15} />
              <span>这是方案 {selectedResultIndex + 1} 的手动调整版，不会改变原来的计算排名。</span>
              <button type="button" onClick={() => resetManualResult(selectedSourceResult.signature)}>
                恢复计算结果
              </button>
            </div>}

            <div className="result-summary">
              <div><strong>{selectedResult.usedSlots}</strong><span>枚因子</span></div>
              <div><strong>{selectedResult.optionalMatched}/{selectedResult.optionalCoverage.length}</strong><span>可选目标</span></div>
              {hasForcedPrimary && <div><strong>{selectedResult.primaryMatched}/{selectedResult.primaryRequired}</strong><span>优先主词条</span></div>}
              {!selectedResult.manuallyAdjusted && <span className="rank-reason">当前排位
                <HelpPopover label="当前排位"
                  text={`与上一套方案相比，主要差别是：${firstRankDifference(selectedResult, analysis.results[selectedResultIndex - 1], hasForcedPrimary)}。`} />
              </span>}
            </div>

            <FactorGrid result={selectedResult} profile={profile} traitById={traitById} traitByHash={traitByHash}
              editing={canEdit ? {
                availableInventory: analysisContext.availableInventory,
                onSelectInstance: (index, key) =>
                  replaceManualInstance(selectedSourceResult, selectedResult, index, key),
                onReplace: index => {
                  setFactorPickerSearch('');
                  setFactorPicker({ sourceSignature: selectedSourceResult.signature, mode: 'replace', index });
                },
                onDelete: index => deleteManualInstance(selectedSourceResult, selectedResult, index),
                onAdd: () => {
                  setFactorPickerSearch('');
                  setFactorPicker({ sourceSignature: selectedSourceResult.signature, mode: 'add' });
                }
              } : undefined} />
            <SkillLevelSummary result={selectedResult} profile={profile} traitByHash={traitByHash} />

            <div className="confirm-row">
              <HelpPopover label="确认配装" text="确认后，工具会从对应的因子库存中扣除所需数量。其他角色只能使用剩余数量。" />
              {confirmedHere
                ? <><span className={`confirmed-mark ${confirmedMissingCount ? 'needs-check' : ''}`}>
                  {confirmedMissingCount ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
                  {confirmedMissingCount ? `已确认，但有 ${confirmedMissingCount} 枚因子在当前库存中找不到` : '已确认这套配装'}
                </span>
                  <button className="secondary-action" type="button" onClick={releaseLoadout}>取消确认</button></>
                : <button className="primary-action" type="button"
                  disabled={!inventory || cacheStatus !== 'current' || !selectedResult.mandatorySatisfied
                    || (selectedResult.forbiddenOccurrences ?? 0) > 0 || selectedResult.selected.length === 0}
                  onClick={() => confirmSelectedResult(selectedResult)}>
                  <CheckCircle2 size={17} />{activeRecord.confirmed ? '改用这套配装' : '确认这套配装'}
                </button>}
            </div>

            <Dialog open={factorPicker?.sourceSignature === selectedSourceResult.signature}
              onClose={() => setFactorPicker(null)}
              labelledBy="factor-picker-title" className="factor-picker-dialog">
              <header>
                <div><h2 id="factor-picker-title">
                  {factorPicker?.mode === 'add' ? '添加因子' : `更换因子 ${(factorPicker?.index ?? 0) + 1}`}
                </h2>
                  <p>只显示当前库存中未被这套方案或其他已确认配装占用的因子。</p></div>
                <button type="button" className="icon-action" aria-label="关闭" onClick={() => setFactorPicker(null)}>
                  <X size={18} />
                </button>
              </header>
              <label className="factor-picker-search">
                <Search size={17} /><span className="sr-only">搜索可用因子</span>
                <input data-dialog-initial value={factorPickerSearch}
                  placeholder="搜索主词条、副词条或等级"
                  onChange={event => setFactorPickerSearch(event.target.value)} />
              </label>
              <div className="factor-picker-list">
                {pickerCandidates.length
                  ? pickerCandidates.map(group => {
                    const sigil = group.representative;
                    const primary = traitByHash.get(sigil.primaryTraitHash >>> 0);
                    const secondary = traitByHash.get(sigil.secondaryTraitHash >>> 0);
                    return <button type="button" className="factor-picker-option"
                      key={group.groupKey}
                      onClick={() => {
                        if (factorPicker?.mode === 'replace' && factorPicker.index !== undefined) {
                          replaceManualInstance(
                            selectedSourceResult, selectedResult, factorPicker.index, factorInstanceKey(sigil));
                        } else {
                          applyManualSelection(
                            selectedSourceResult,
                            selectedResult,
                            [...selectedResult.selected, sigil],
                            '已添加一枚因子'
                          );
                        }
                        setFactorPicker(null);
                      }}>
                      <span><TraitIcon trait={primary} size={26} /><b>{primary?.nameZh ?? '未知词条'}</b></span>
                      <span><TraitIcon trait={secondary} size={22} /><b>{secondary?.nameZh ?? '未知词条'}</b></span>
                      <small>因子 Lv {sigil.sigilLevel}<em>可用 {group.count}</em></small>
                    </button>;
                  })
                  : <div className="factor-picker-empty">没有符合条件的可用因子。</div>}
              </div>
            </Dialog>
          </article>;
        })()}
      </>}
    </section>

    <nav className="page-rail" aria-label="页面导航">
      <button type="button" className={activePageSection === 'targets' ? 'active' : ''} onClick={() => scrollToSection('targets')}>
        <ListChecks size={17} /><span>目标</span>
      </button>
      <button type="button" className={activePageSection === 'results' ? 'active' : ''} onClick={() => scrollToSection('results')}>
        <BarChart3 size={17} /><span>结果</span>
      </button>
    </nav>
    </> : appPage === 'inventory' ? <section className="inventory-page" aria-label="持有因子">
      <header className="inventory-page-heading">
        <div><h2>持有因子</h2>
          <p>{inventory
            ? `显示上次手动读取的库存快照，共 ${inventory.stocks.reduce((sum, stock) => sum + stock.count, 0)} 枚双词条因子。`
            : '读取存档后，可在这里查看每一枚双词条因子。'}</p></div>
        <HelpPopover label="库存快照" text="应用启动时只恢复上次成功读取的结果，不会重新打开存档。游戏内库存变化后，请手动点击“读取存档”更新。" />
      </header>

      <div className="inventory-toolbar">
        <div className="search-wrap inventory-search"><Search size={18} />
          <label className="sr-only" htmlFor="inventory-search">搜索持有因子</label>
          <input id="inventory-search" value={inventorySearch}
            onChange={event => setInventorySearch(event.target.value)}
            placeholder="搜索主词条、副词条或等级" />
          {inventorySearch && <button type="button" aria-label="清空搜索" onClick={() => setInventorySearch('')}><X size={16} /></button>}
        </div>
        <label className="inventory-filter"><span>技能分类</span>
          <select value={inventoryCategory} onChange={event => setInventoryCategory(event.target.value)}>
            <option value="all">全部分类</option>
            {catalog.categories.map(item => <option key={item.id} value={item.id}>{item.nameZh}</option>)}
          </select>
        </label>
        <label className="inventory-filter"><span>使用状态</span>
          <select value={inventoryStatus} onChange={event => setInventoryStatus(event.target.value as typeof inventoryStatus)}>
            <option value="all">全部状态</option>
            <option value="available">未被配装占用</option>
            <option value="reserved">已确认配装</option>
            <option value="equipped">游戏内已装备</option>
          </select>
        </label>
        <label className="inventory-filter"><span>排序</span>
          <select value={inventorySort} onChange={event => setInventorySort(event.target.value as typeof inventorySort)}>
            <option value="level">因子等级</option>
            <option value="primary">主词条名称</option>
            <option value="secondary">副词条名称</option>
          </select>
        </label>
      </div>

      <div className="inventory-list-summary">
        <span>找到 <strong>{filteredInventory.length}</strong> 种因子</span>
        {inventory && <span>{inventory.sourceDisplayName ?? '上次读取的存档'} · 原存档不会被修改</span>}
      </div>

      {!inventory
        ? <div className="inventory-empty"><Database size={30} /><strong>还没有因子库存</strong><span>点击上方“读取存档”选择 SaveData*.dat。</span></div>
        : visibleInventory.length === 0
          ? <div className="inventory-empty"><Search size={28} /><strong>没有符合条件的因子</strong><span>试试清空搜索或更换筛选条件。</span></div>
          : <div className="inventory-grid">{visibleInventory.map(group => {
            const sigil = group.representative;
            const primary = traitByHash.get(sigil.primaryTraitHash >>> 0);
            const secondary = traitByHash.get(sigil.secondaryTraitHash >>> 0);
            const status = [
              group.availableCount > 0 ? `可用 ${group.availableCount}` : '',
              group.reservedCount > 0 ? `已确认 ${group.reservedCount}` : '',
              group.wornCount > 0 ? `游戏内装备 ${group.wornCount}` : ''
            ].filter(Boolean).join(' · ');
            return <FactorCard key={group.groupKey}
              sigil={sigil} primary={primary} secondary={secondary}
              label={`持有 ${group.count}`} mode="inventory"
              hasIssue={group.reservedCount > 0}
              footerStart={status}
              footerEnd={group.reservedNames.length > 0
                ? <em className="reserved-label">已留给 {group.reservedNames.join('、')}</em>
                : <em className="available-label">可用于配装</em>} />;
          })}</div>}

      {inventory && filteredInventory.length > inventoryPageSize && <nav className="inventory-pagination" aria-label="因子列表翻页">
        <button type="button" disabled={safeInventoryPage === 0} onClick={() => setInventoryPage(current => Math.max(0, current - 1))}>
          <ChevronLeft size={16} />上一页
        </button>
        <span>第 {safeInventoryPage + 1} / {inventoryPageCount} 页</span>
        <button type="button" disabled={safeInventoryPage >= inventoryPageCount - 1}
          onClick={() => setInventoryPage(current => Math.min(inventoryPageCount - 1, current + 1))}>
          下一页<ChevronRight size={16} />
        </button>
      </nav>}
    </section> : <section className="loadouts-page" aria-label="已确认配装">
      <header className="loadouts-page-heading">
        <div><h2>已确认配装</h2><p>这些配装已经占用对应数量，其他方案只会使用剩余库存。</p></div>
        <HelpPopover label="已确认配装" text="同词条、同等级的因子按数量管理。重新读取存档后，如果持有数量不够，对应配装会标为需要检查。" />
      </header>
      {confirmedRecords.length === 0
        ? <div className="empty-loadouts"><CheckCircle2 size={28} /><strong>还没有确认任何配装</strong><span>在计算结果中选择一套方案并点击“确认这套配装”。</span></div>
        : <div className="loadout-browser">
          <aside className="loadout-list" aria-label="已确认配装列表">
            {confirmedRecords.map(record => {
              const missingCount = inventory
                ? confirmedAllocationShortfall(workspace, record.id, inventory)
                : 0;
              return <button type="button" key={record.id}
                className={record.id === selectedLoadoutRecord?.id ? 'active' : ''}
                aria-pressed={record.id === selectedLoadoutRecord?.id}
                onClick={() => setSelectedLoadoutProfileId(record.id)}>
                <span>{loadoutNames.get(record.id)}</span>
                <small>{missingCount
                  ? `${missingCount} 枚因子需检查`
                  : `${confirmedFactorCount(record.confirmed!)} 枚因子`}</small>
              </button>;
            })}
          </aside>
          <article className="loadout-detail">
            <header>
              <div><h3>{selectedLoadoutRecord ? loadoutNames.get(selectedLoadoutRecord.id) : ''}</h3>
                <p>{selectedLoadoutRecord?.confirmed
                  ? `确认于 ${new Date(selectedLoadoutRecord.confirmed.confirmedAt).toLocaleString('zh-CN')}`
                  : ''}</p></div>
              {selectedLoadoutRecord && <div className="loadout-actions">
                <button className="secondary-action compact" type="button" onClick={() => {
                  updateWorkspace(current => ({ ...current, activeProfileId: selectedLoadoutRecord.id }));
                  setAppPage('planner');
                  setResultScrollRequest(current => current + 1);
                }}>打开目标方案</button>
                <button className="secondary-action compact danger-action" type="button"
                  onClick={() => releaseLoadoutFor(selectedLoadoutRecord.id)}>取消确认</button>
              </div>}
            </header>
            {selectedLoadoutResult && selectedLoadoutRecord
              ? <FactorGrid result={selectedLoadoutResult}
                profile={selectedLoadoutRecord.confirmed?.profileSnapshot ?? selectedLoadoutRecord.profile}
                traitById={traitById} traitByHash={traitByHash} mode="confirmed" />
              : <div className="empty-loadouts"><AlertTriangle size={24} />
                <span>这条旧记录没有保存因子快照。请回到目标方案重新计算并确认。</span></div>}
          </article>
        </div>}
    </section>}

    <Dialog open={shareOpen} onClose={() => setShareOpen(false)}
      labelledBy="share-title" className="share-dialog">
        <div className="dialog-title"><h2 id="share-title">分享或导入方案</h2><button type="button" aria-label="关闭" onClick={() => setShareOpen(false)}><X size={18} /></button></div>
        <p>分享字符串包含方案名称、目标顺序和选项，不包含存档、库存、计算结果或已确认配装。</p>
        <label htmlFor="share-code">分享字符串</label>
        <textarea id="share-code" data-dialog-initial value={shareCode} onChange={event => setShareCode(event.target.value)} rows={7} />
        <div className="dialog-actions"><button className="secondary-action" type="button" onClick={() => void navigator.clipboard.writeText(shareCode)}><Clipboard size={16} />复制</button>
          <button className="primary-action" type="button" onClick={importShare}>导入为新方案</button></div>
    </Dialog>
  </main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root is missing.');
createRoot(root).render(<App />);
