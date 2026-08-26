/**
 * PlayerHost 呈现阶段与错误映射（纯函数，供单测）。
 */
export type PlayerPhase = 'resolving' | 'ready' | 'missing' | 'error'

/** 协议错误码到呈现阶段的映射：missing 单列，其余归 error。 */
export const phaseForError = (code: string): 'missing' | 'error' =>
  code === 'player-missing' ? 'missing' : 'error'
