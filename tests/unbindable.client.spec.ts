// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isUnbindableCombo } from '../src/client/settings.tsx'

describe('isUnbindableCombo', () => {
  it('flags browser-reserved combos', () => {
    expect(isUnbindableCombo('cmd+t')).toBe(true)
    expect(isUnbindableCombo('cmd+n')).toBe(true)
    expect(isUnbindableCombo('cmd+w')).toBe(true)
    expect(isUnbindableCombo('cmd+shift+c')).toBe(true)
    expect(isUnbindableCombo('cmd+shift+i')).toBe(true)
    expect(isUnbindableCombo('cmd+alt+i')).toBe(true)
  })

  it('flags macOS Alt-rewritten letter/bracket combos', () => {
    expect(isUnbindableCombo('cmd+alt+c')).toBe(true)
    expect(isUnbindableCombo('cmd+alt+t')).toBe(true)
    expect(isUnbindableCombo('cmd+alt+[')).toBe(true)
  })

  it('accepts bindable combos', () => {
    expect(isUnbindableCombo('cmd+l')).toBe(false)
    expect(isUnbindableCombo('cmd+shift+k')).toBe(false)
    expect(isUnbindableCombo('cmd+b')).toBe(false)
    expect(isUnbindableCombo('cmd+[')).toBe(false)
    expect(isUnbindableCombo('cmd+.')).toBe(false)
    expect(isUnbindableCombo('')).toBe(false)
  })
})
