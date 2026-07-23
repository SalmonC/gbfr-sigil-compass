import type { SolverAnalysis, SolverRequest } from './models';
import { solveBuild } from './solver';

interface SolverWorkerRequest {
  readonly requestId: number;
  readonly request: SolverRequest;
}

interface SolverWorkerResponse {
  readonly requestId: number;
  readonly result?: SolverAnalysis;
  readonly error?: string;
}

self.onmessage = (event: MessageEvent<SolverWorkerRequest>) => {
  const { requestId, request } = event.data;
  try {
    const response: SolverWorkerResponse = { requestId, result: solveBuild(request) };
    self.postMessage(response);
  } catch (error) {
    const response: SolverWorkerResponse = {
      requestId,
      error: error instanceof Error ? error.message : 'solver.unknown_error'
    };
    self.postMessage(response);
  }
};
