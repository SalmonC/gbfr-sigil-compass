import highsRuntimeUrl from 'highs/runtime';
import type { SolverRequest } from './models';
import { configureHighsRuntime, solveBuildMilp } from './solver-milp';

configureHighsRuntime(highsRuntimeUrl);

export function solveBuildMilpInBrowser(
  request: SolverRequest,
  startedAt: number,
  timeLimitMs: number
) {
  return solveBuildMilp(request, startedAt, timeLimitMs);
}
