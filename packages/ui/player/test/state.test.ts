import { describe, expect, it } from 'vitest'

import { phaseForError } from '../lib/state'

describe('phaseForError', () => {
  it('player-missing 映射 missing', () => {
    expect(phaseForError('player-missing')).toBe('missing')
  })

  it('其余错误码归 error', () => {
    expect(phaseForError('input-invalid')).toBe('error')
    expect(phaseForError('redirect-cycle')).toBe('error')
    expect(phaseForError('redirect-depth')).toBe('error')
    expect(phaseForError('unknown')).toBe('error')
  })
})
