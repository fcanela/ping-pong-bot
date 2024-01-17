export type PingDetectedExchange = {
  state: 'detected'
  pingHash: string
  pingBlock: number
}
export type PongIssuedExchange = {
  state: 'pong_issued'
  pingHash: string
  pingBlock: number
  pongHash: string
  pongNonce: number
  pongTimestamp: string
}
export type CompletedExchange = {
  state: 'completed',
  pingHash: string
  // Optional for recovered exchanges
  pingBlock?: number
  pongHash: string
  pongBlock: number
  pongNonce: number
  // Optional for recovered exchanges
  pongTimestamp?: string
}
export type Exchange = PingDetectedExchange | PongIssuedExchange | CompletedExchange;

export const enum IterationState {
  STARTED = 'started',
  COMPLETED = 'completed',
}
export const enum IterationType {
  NORMAL = 'normal',
  RECOVERY_START = 'recovery_start',
  RECOVERY = 'recovery',
  RECOVERY_END = 'recovery_end',
  NOT_ENOUGH_BLOCKS = 'not_enough_blocks',
}

export type NormalIteration = {
  type: IterationType.NORMAL
  state: IterationState
  fromBlock: number
  toBlock: number
}

export type RecoveryStartIteration = {
  type: IterationType.RECOVERY_START
  state: IterationState
  toBlock: number
}

export type RecoveryIteration = {
  type: IterationType.RECOVERY
  state: IterationState
  fromBlock: number
  toBlock: number
  recoveryUntilBlock: number
}

export type RecoveryEndIteration = {
  type: IterationType.RECOVERY_END
  state: IterationState
  toBlock: number
}

export type Iteration = 
  NormalIteration | 
  RecoveryStartIteration |
  RecoveryIteration | 
  RecoveryEndIteration;
