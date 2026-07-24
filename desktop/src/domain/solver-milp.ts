import highsLoader from 'highs';
import type { RawSigil } from '../shared/contracts';
import type { SolverAnalysis, SolverRequest, SolverResult } from './models';
import {
  dedupeEquivalentResults, searchFactorGroupKey, targetTraitHashes
} from './result-equivalence.ts';

interface Group {
  readonly key: string;
  readonly primary: number;
  readonly secondary: number;
  readonly instances: readonly RawSigil[];
  readonly variables: readonly string[];
  readonly tieA: number;
  readonly tieB: number;
}

interface Term {
  readonly variable: string;
  readonly coefficient: number;
}

interface Model {
  readonly constraints: string[];
  readonly binaries: string[];
  readonly generals: string[];
  readonly bounds: string[];
}

let highsPromise: ReturnType<typeof highsLoader> | null = null;
let highsRuntimeUrl: string | null = null;

export function configureHighsRuntime(url: string): void {
  if (!highsPromise) highsRuntimeUrl = url;
}

function highsInstance() {
  highsPromise ??= highsLoader(highsRuntimeUrl
    ? { locateFile: () => highsRuntimeUrl! }
    : undefined);
  return highsPromise;
}

function hashNumber(value: string): number {
  return Number.parseInt(value.slice(2), 16) >>> 0;
}

function stableCoefficient(value: string, seed: number, salt: number): number {
  let hash = (2166136261 ^ seed ^ salt) >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 1_000_003;
}

function expression(terms: readonly Term[]): string {
  const merged = new Map<string, number>();
  for (const term of terms) {
    merged.set(term.variable, (merged.get(term.variable) ?? 0) + term.coefficient);
  }
  const parts: string[] = [];
  for (const [variable, coefficient] of merged) {
    if (coefficient === 0) continue;
    const magnitude = Math.abs(coefficient);
    const body = `${magnitude === 1 ? '' : `${magnitude} `}${variable}`;
    if (parts.length === 0) parts.push(coefficient < 0 ? `- ${body}` : body);
    else parts.push(`${coefficient < 0 ? '-' : '+'} ${body}`);
  }
  return parts.join(' ') || '0';
}

function countItems(values: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function buildLp(
  model: Model,
  objective: readonly Term[],
  sense: 'Maximize' | 'Minimize'
): string {
  return [
    sense,
    ` objective: ${expression(objective)}`,
    'Subject To',
    ...model.constraints.map((constraint, index) => ` c${index}: ${constraint}`),
    ...(model.bounds.length ? ['Bounds', ...model.bounds] : []),
    ...(model.generals.length ? ['General', ...model.generals] : []),
    ...(model.binaries.length ? ['Binary', ...model.binaries] : []),
    'End'
  ].join('\n');
}

function variableValue(
  columns: Record<string, { Primal: number }>,
  variable: string
): number {
  return Math.round(columns[variable]?.Primal ?? 0);
}

function objectiveValue(
  columns: Record<string, { Primal: number }>,
  terms: readonly Term[]
): number {
  return terms.reduce(
    (sum, term) => sum + term.coefficient * variableValue(columns, term.variable), 0);
}

function groupTerms(
  groups: readonly Group[],
  predicate: (group: Group) => number
): Term[] {
  return groups.flatMap(group => {
    const coefficient = predicate(group);
    return coefficient === 0
      ? []
      : group.variables.map(variable => ({ variable, coefficient }));
  });
}

/**
 * Low-retained-memory exact fallback. HiGHS keeps the branch-and-bound tree in
 * WebAssembly memory instead of materialising every coverage state in JS.
 * Objectives are fixed one at a time, preserving the product's lexicographic
 * ranking without unsafe floating-point "big M" weights.
 */
export async function solveBuildMilp(
  request: SolverRequest,
  startedAt: number,
  timeLimitMs: number
): Promise<SolverAnalysis> {
  const traitById = new Map(request.catalog.traits.map(trait => [trait.id, trait]));
  const idsToHashes = (ids: readonly string[]) => ids.map(id => {
    const trait = traitById.get(id);
    if (!trait) throw new Error(`catalog.skill_missing:${id}`);
    return hashNumber(trait.hash);
  });
  const mandatory = idsToHashes(request.profile.mandatory);
  const basic = idsToHashes(request.profile.basicPrimary);
  const attack = idsToHashes(request.profile.attackPrimary);
  const defense = idsToHashes(request.profile.defensePrimary);
  const optional = idsToHashes(request.profile.optional);
  const substitution = idsToHashes(request.profile.basicSubstitutionOrder);
  const forbidden = new Set(idsToHashes(request.profile.forbidden));
  const avoid = new Set(idsToHashes(request.profile.avoid));
  const equivalenceTargets = targetTraitHashes(request.profile, request.catalog);
  const forcedBasic = request.profile.forceBasicPrimary;
  const allowSubstitution = forcedBasic && request.profile.allowBasicSubstitution;
  const primaryTargets = [
    ...(forcedBasic ? basic : []),
    ...(request.profile.forceAttackPrimary ? attack : []),
    ...(request.profile.forceDefensePrimary ? defense : [])
  ];
  const effectiveOptional = [
    ...optional,
    ...(!forcedBasic ? basic : []),
    ...(!request.profile.forceAttackPrimary ? attack : []),
    ...(!request.profile.forceDefensePrimary ? defense : [])
  ];
  const relevant = new Set([
    ...mandatory,
    ...primaryTargets,
    ...effectiveOptional,
    ...(allowSubstitution ? substitution : [])
  ]);
  const grouped = new Map<string, RawSigil[]>();
  for (const sigil of request.inventory) {
    const primary = sigil.primaryTraitHash >>> 0;
    const secondary = sigil.secondaryTraitHash >>> 0;
    if (forbidden.has(primary) || forbidden.has(secondary)) continue;
    if (!relevant.has(primary) && !relevant.has(secondary)) continue;
    const key = searchFactorGroupKey(sigil, equivalenceTargets, avoid);
    const bucket = grouped.get(key) ?? [];
    bucket.push(sigil);
    grouped.set(key, bucket);
  }
  const groups: Group[] = [...grouped.entries()].map(([key, instances], groupIndex) => {
    const sorted = [...instances].sort((left, right) =>
      right.sigilLevel - left.sigilLevel || left.gemUnitId - right.gemUnitId);
    return {
      key,
      primary: sorted[0]!.primaryTraitHash >>> 0,
      secondary: sorted[0]!.secondaryTraitHash >>> 0,
      instances: sorted.slice(0, request.maxSlots),
      variables: sorted.slice(0, request.maxSlots).map((_, index) => `y${groupIndex}_${index}`),
      tieA: stableCoefficient(key, request.runSeed, 0x9e3779b9),
      tieB: stableCoefficient(key, request.runSeed, 0x85ebca6b)
    };
  }).sort((left, right) => left.key.localeCompare(right.key));

  const model: Model = { constraints: [], binaries: [], generals: [], bounds: [] };
  for (const group of groups) {
    model.binaries.push(...group.variables);
    for (let index = 1; index < group.variables.length; index++) {
      model.constraints.push(`${group.variables[index - 1]} - ${group.variables[index]} >= 0`);
    }
  }
  const slotTerms = groupTerms(groups, () => 1);
  model.constraints.push(`${expression(slotTerms)} <= ${request.maxSlots}`);
  model.constraints.push(`${expression(slotTerms)} >= 1`);

  const totalTerms = (hash: number): Term[] => groupTerms(groups, group =>
    (group.primary === hash ? 1 : 0) + (group.secondary === hash ? 1 : 0));
  const primaryTerms = (hash: number): Term[] =>
    groupTerms(groups, group => group.primary === hash ? 1 : 0);
  const mandatoryCounts = countItems(mandatory);
  for (const [hash, required] of mandatoryCounts) {
    model.constraints.push(`${expression(totalTerms(hash))} >= ${required}`);
  }

  const exactVariables = primaryTargets.map((_, index) => `e${index}`);
  model.binaries.push(...exactVariables);
  const exactByHash = new Map<number, string[]>();
  primaryTargets.forEach((hash, index) => {
    const bucket = exactByHash.get(hash) ?? [];
    bucket.push(exactVariables[index]!);
    exactByHash.set(hash, bucket);
  });
  for (const variables of exactByHash.values()) {
    for (let index = 1; index < variables.length; index++) {
      model.constraints.push(`${variables[index - 1]} - ${variables[index]} >= 0`);
    }
  }

  const substitutionVariables = allowSubstitution
    ? substitution.map((_, index) => `q${index}`)
    : [];
  for (const variable of substitutionVariables) {
    model.generals.push(variable);
    model.bounds.push(`0 <= ${variable} <= ${basic.length}`);
  }
  const optionalVariables = effectiveOptional.map((_, index) => `o${index}`);
  model.binaries.push(...optionalVariables);
  const optionalByHash = new Map<number, string[]>();
  effectiveOptional.forEach((hash, index) => {
    const bucket = optionalByHash.get(hash) ?? [];
    bucket.push(optionalVariables[index]!);
    optionalByHash.set(hash, bucket);
  });
  for (const variables of optionalByHash.values()) {
    for (let index = 1; index < variables.length; index++) {
      model.constraints.push(`${variables[index - 1]} - ${variables[index]} >= 0`);
    }
  }

  for (const hash of new Set([...primaryTargets, ...effectiveOptional, ...substitution])) {
    const exactUse = (exactByHash.get(hash) ?? []).map(variable => ({ variable, coefficient: 1 }));
    const optionalUse = (optionalByHash.get(hash) ?? []).map(variable => ({ variable, coefficient: 1 }));
    const substitutionUse = substitutionVariables.flatMap((variable, index) =>
      substitution[index] === hash ? [{ variable, coefficient: 1 }] : []);
    model.constraints.push(
      `${expression([...exactUse, ...substitutionUse, ...primaryTerms(hash).map(
        term => ({ ...term, coefficient: -term.coefficient }))])} <= 0`);
    model.constraints.push(
      `${expression([
        ...exactUse,
        ...substitutionUse,
        ...optionalUse,
        ...totalTerms(hash).map(term => ({ ...term, coefficient: -term.coefficient }))
      ])} <= ${-(mandatoryCounts.get(hash) ?? 0)}`);
  }
  if (allowSubstitution) {
    const forcedBasicExact = exactVariables.slice(0, basic.length)
      .map(variable => ({ variable, coefficient: 1 }));
    model.constraints.push(
      `${expression([
        ...substitutionVariables.map(variable => ({ variable, coefficient: 1 })),
        ...forcedBasicExact
      ])} <= ${basic.length}`);
  }

  const primaryMatchedTerms: Term[] = [
    ...exactVariables.map(variable => ({ variable, coefficient: 1 })),
    ...substitutionVariables.map(variable => ({ variable, coefficient: 1 }))
  ];
  const exactWeightTerms = exactVariables.map((variable, index) => ({
    variable,
    coefficient: 2 ** (exactVariables.length - index - 1)
  }));
  const optionalMatchedTerms = optionalVariables.map(variable => ({ variable, coefficient: 1 }));
  const optionalWeightTerms = optionalVariables.map((variable, index) => ({
    variable,
    coefficient: 2 ** (optionalVariables.length - index - 1)
  }));
  const avoidTerms = groupTerms(groups, group =>
    (avoid.has(group.primary) ? 1 : 0) + (avoid.has(group.secondary) ? 1 : 0));
  const levelTerms = groups.flatMap(group => group.variables.map((variable, index) => ({
    variable,
    coefficient: group.instances[index]!.sigilLevel
  })));
  const tieATerms = groups.flatMap(group =>
    group.variables.map(variable => ({ variable, coefficient: group.tieA })));
  const tieBTerms = groups.flatMap(group =>
    group.variables.map(variable => ({ variable, coefficient: group.tieB })));
  const objectives = ([
    { sense: 'Maximize', terms: primaryMatchedTerms },
    { sense: 'Maximize', terms: exactWeightTerms },
    ...substitutionVariables.map(variable => ({
      sense: 'Maximize' as const,
      terms: [{ variable, coefficient: 1 }]
    })),
    { sense: 'Maximize', terms: optionalMatchedTerms },
    { sense: 'Minimize', terms: avoidTerms },
    { sense: 'Maximize', terms: optionalWeightTerms },
    { sense: 'Minimize', terms: slotTerms },
    { sense: 'Maximize', terms: levelTerms },
    { sense: 'Minimize', terms: tieATerms },
    { sense: 'Minimize', terms: tieBTerms }
  ] satisfies { sense: 'Maximize' | 'Minimize'; terms: Term[] }[])
    .filter(objective => objective.terms.length > 0);

  const highs = await highsInstance();
  const results: SolverResult[] = [];
  const noGoods: string[] = [];
  for (let resultIndex = 0; resultIndex < Math.max(1, Math.min(request.resultLimit, 10)); resultIndex++) {
    const fixed: string[] = [];
    let columns: Record<string, { Primal: number }> | null = null;
    for (const objective of objectives) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeLimitMs) throw new Error('solver.time_limit');
      const iterationModel = {
        ...model,
        constraints: [...model.constraints, ...noGoods, ...fixed]
      };
      const solution = highs.solve(buildLp(iterationModel, objective.terms, objective.sense), {
        time_limit: Math.max(0.1, (timeLimitMs - elapsed) / 1000),
        random_seed: request.runSeed,
        output_flag: false,
        log_to_console: false,
        mip_rel_gap: 0,
        mip_abs_gap: 0
      });
      if (solution.Status === 'Infeasible') {
        columns = null;
        break;
      }
      if (solution.Status !== 'Optimal') throw new Error('solver.time_limit');
      columns = solution.Columns;
      const optimum = objectiveValue(columns, objective.terms);
      fixed.push(`${expression(objective.terms)} = ${optimum}`);
    }
    if (!columns) break;

    const selectedCounts = groups.map(group =>
      group.variables.reduce((sum, variable) => sum + variableValue(columns!, variable), 0));
    const selected = groups.flatMap((group, index) =>
      group.instances.slice(0, selectedCounts[index]!));
    const exactCoverage = exactVariables.map(variable => variableValue(columns!, variable) === 1);
    const substitutionUsage = substitutionVariables.map(variable => variableValue(columns!, variable));
    const optionalCoverage = optionalVariables.map(variable => variableValue(columns!, variable) === 1);
    const signature = groups.flatMap((group, index) =>
      selectedCounts[index]! > 0 ? [`${group.key}*${selectedCounts[index]}`] : []).join('|');
    results.push({
      selected,
      signature,
      mandatorySatisfied: true,
      primaryMatched: exactCoverage.filter(Boolean).length
        + substitutionUsage.reduce((sum, count) => sum + count, 0),
      primaryRequired: primaryTargets.length,
      exactPrimaryCoverage: exactCoverage,
      basicSubstitutionUsage: substitutionUsage,
      optionalMatched: optionalCoverage.filter(Boolean).length,
      optionalCoverage,
      avoidOccurrences: objectiveValue(columns, avoidTerms),
      usedSlots: objectiveValue(columns, slotTerms),
      levelSum: objectiveValue(columns, levelTerms),
      tieA: objectiveValue(columns, tieATerms),
      tieB: objectiveValue(columns, tieBTerms)
    });

    const differenceTerms: string[] = [];
    let constant = 0;
    groups.forEach((group, groupIndex) => {
      const count = selectedCounts[groupIndex]!;
      if (count === 0) {
        if (group.variables[0]) differenceTerms.push(group.variables[0]);
      } else if (count === group.variables.length) {
        differenceTerms.push(`- ${group.variables[count - 1]}`);
        constant++;
      } else {
        differenceTerms.push(`- ${group.variables[count - 1]}`);
        differenceTerms.push(group.variables[count]!);
        constant++;
      }
    });
    noGoods.push(`${differenceTerms.join(' + ').replaceAll('+ -', '-')} >= ${1 - constant}`);
  }

  const unique = dedupeEquivalentResults(results, equivalenceTargets);
  return {
    status: unique.length ? 'completed' : 'no-solution',
    results: unique,
    candidateTypeCount: groups.length,
    exploredStateCount: 0
  };
}
