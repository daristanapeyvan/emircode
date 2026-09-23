/**
 * AgentStateMachine.ts
 * Emir Code Formal State Machine with Transition Guard Table.
 * Prevents illegal transitions (e.g., BLOCKED -> COMPLETED or EXECUTING -> COMPLETED).
 */

export type AgentState =
  | 'PENDING'
  | 'PLANNING'
  | 'EXECUTING'
  | 'VALIDATING'
  | 'RETRYING'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'FAILED'
  | 'DONE';

export interface StateTransitionEvent {
  from: AgentState;
  to: AgentState;
  reason?: string;
  timestamp: number;
}

export class AgentStateMachine {
  private currentState: AgentState = 'PENDING';
  private history: StateTransitionEvent[] = [];
  private onStateChangeCallback?: (from: AgentState, to: AgentState, reason?: string) => void;

  // Strict Transition Matrix: Key = from state, Value = allowed to states
  private static readonly ALLOWED_TRANSITIONS: Record<AgentState, AgentState[]> = {
    PENDING: ['PLANNING', 'BLOCKED'],
    PLANNING: ['EXECUTING', 'BLOCKED', 'FAILED'],
    EXECUTING: ['VALIDATING', 'RETRYING', 'BLOCKED'],
    VALIDATING: ['COMPLETED', 'RETRYING', 'FAILED'],
    RETRYING: ['EXECUTING', 'FAILED', 'BLOCKED'],
    COMPLETED: ['PLANNING', 'DONE'],
    BLOCKED: [], // Terminal unless explicitly reset
    FAILED: [],  // Terminal
    DONE: [],    // Terminal
  };

  constructor(onStateChange?: (from: AgentState, to: AgentState, reason?: string) => void) {
    this.onStateChangeCallback = onStateChange;
  }

  getState(): AgentState {
    return this.currentState;
  }

  getHistory(): readonly StateTransitionEvent[] {
    return this.history;
  }

  isTerminal(): boolean {
    return this.currentState === 'BLOCKED' || this.currentState === 'FAILED' || this.currentState === 'DONE';
  }

  canTransitionTo(nextState: AgentState): boolean {
    const allowed = AgentStateMachine.ALLOWED_TRANSITIONS[this.currentState];
    return allowed.includes(nextState);
  }

  transition(nextState: AgentState, reason?: string): void {
    if (this.currentState === nextState) return;

    if (!this.canTransitionTo(nextState)) {
      const errorMsg = `[STATE MACHINE İHLALİ]: '${this.currentState}' durumundan '${nextState}' durumuna geçiş YASAKTIR! (Sebep: ${reason || 'Belirtilmedi'})`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    const from = this.currentState;
    this.currentState = nextState;
    const event: StateTransitionEvent = {
      from,
      to: nextState,
      reason,
      timestamp: Date.now(),
    };
    this.history.push(event);

    this.onStateChangeCallback?.(from, nextState, reason);
  }

  reset(): void {
    const from = this.currentState;
    this.currentState = 'PENDING';
    this.history.push({
      from,
      to: 'PENDING',
      reason: 'Durum makinesi manuel sıfırlandı.',
      timestamp: Date.now(),
    });
    this.onStateChangeCallback?.(from, 'PENDING', 'Sıfırlandı');
  }
}
