export type AnalysisPhase = 'idle' | 'running' | 'ready' | 'stale' | 'failed';

export interface AnalysisRunState {
  readonly phase: AnalysisPhase;
  readonly runId: number;
  readonly requestKey: string | null;
  readonly message: string | null;
}

export const initialAnalysisRunState: AnalysisRunState = {
  phase: 'idle', runId: 0, requestKey: null, message: null
};

export type AnalysisEvent =
  | { readonly type: 'start'; readonly requestKey: string }
  | { readonly type: 'invalidate'; readonly message: string }
  | { readonly type: 'resolve'; readonly runId: number; readonly requestKey: string }
  | { readonly type: 'reject'; readonly runId: number; readonly message: string }
  | { readonly type: 'restore'; readonly requestKey: string | null; readonly current: boolean };

export function reduceAnalysisState(state: AnalysisRunState, event: AnalysisEvent): AnalysisRunState {
  switch (event.type) {
    case 'start':
      return { phase: 'running', runId: state.runId + 1, requestKey: event.requestKey, message: null };
    case 'invalidate':
      return {
        ...state,
        phase: state.phase === 'idle' ? 'idle' : 'stale',
        runId: state.phase === 'running' ? state.runId + 1 : state.runId,
        message: event.message
      };
    case 'resolve':
      if (state.runId !== event.runId || state.requestKey !== event.requestKey) return state;
      return { ...state, phase: 'ready', message: null };
    case 'reject':
      if (state.runId !== event.runId) return state;
      return { ...state, phase: 'failed', message: event.message };
    case 'restore':
      return {
        phase: event.requestKey ? (event.current ? 'ready' : 'stale') : 'idle',
        runId: state.runId,
        requestKey: event.requestKey,
        message: event.requestKey && !event.current ? '保存的结果与当前条件不同，需要重新计算。' : null
      };
  }
}
