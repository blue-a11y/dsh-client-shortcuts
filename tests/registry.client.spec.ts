// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  isTypingTarget, matchesCombo, parseCombo, ShortcutRegistry,
} from '../src/client/registry.ts'

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init })
}

describe('parseCombo', () => {
  it('parses mod into the either-modifier requirement', () => {
    expect(parseCombo('mod+l')).toEqual({ key: 'l', shift: false, alt: false, ctrl: true, meta: true })
  })

  it('parses shift/alt alongside mod and lowercases tokens', () => {
    expect(parseCombo('MOD+SHIFT+C')).toEqual({ key: 'c', shift: true, alt: false, ctrl: true, meta: true })
    expect(parseCombo('alt+shift+x')).toEqual({ key: 'x', shift: true, alt: true, ctrl: false, meta: false })
  })

  it('parses strict single modifiers', () => {
    expect(parseCombo('ctrl+k')).toEqual({ key: 'k', shift: false, alt: false, ctrl: true, meta: false })
    expect(parseCombo('meta+k')).toEqual({ key: 'k', shift: false, alt: false, ctrl: false, meta: true })
  })

  it('rejects malformed combos', () => {
    expect(() => parseCombo('')).toThrow('has no key')
    expect(() => parseCombo('mod')).toThrow('has no key')
    expect(() => parseCombo('mod+')).toThrow('has an empty token')
    expect(() => parseCombo('mod+a+b')).toThrow('more than one key')
  })
})

describe('isTypingTarget', () => {
  it('accepts text fields and contentEditable, rejects the rest', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(document.body)).toBe(false)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    expect(isTypingTarget(editable)).toBe(true)
  })
})

describe('matchesCombo', () => {
  const modL = parseCombo('mod+l')

  it('rejects key, shift, and alt mismatches', () => {
    expect(matchesCombo(modL, keydown({ key: 'k', ctrlKey: true }))).toBe(false)
    expect(matchesCombo(modL, keydown({ key: 'l', ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matchesCombo(modL, keydown({ key: 'l', ctrlKey: true, altKey: true }))).toBe(false)
    expect(matchesCombo(parseCombo('mod+shift+c'), keydown({ key: 'c', ctrlKey: true }))).toBe(false)
  })

  it('matches mod with either modifier and matches uppercase event keys', () => {
    expect(matchesCombo(modL, keydown({ key: 'l', ctrlKey: true }))).toBe(true)
    expect(matchesCombo(modL, keydown({ key: 'l', metaKey: true }))).toBe(true)
    expect(matchesCombo(modL, keydown({ key: 'L', metaKey: true }))).toBe(true)
    expect(matchesCombo(modL, keydown({ key: 'l' }))).toBe(false)
  })

  it('keeps strict ctrl and meta apart', () => {
    const ctrlK = parseCombo('ctrl+k')
    expect(matchesCombo(ctrlK, keydown({ key: 'k', ctrlKey: true }))).toBe(true)
    expect(matchesCombo(ctrlK, keydown({ key: 'k', ctrlKey: true, metaKey: true }))).toBe(false)
    expect(matchesCombo(ctrlK, keydown({ key: 'k', metaKey: true }))).toBe(false)
    const metaK = parseCombo('meta+k')
    expect(matchesCombo(metaK, keydown({ key: 'k', metaKey: true }))).toBe(true)
    expect(matchesCombo(metaK, keydown({ key: 'k', ctrlKey: true }))).toBe(false)
    expect(matchesCombo(metaK, keydown({ key: 'k', ctrlKey: true, metaKey: true }))).toBe(false)
  })

  it('requires no modifiers for a bare key', () => {
    const bareL = parseCombo('l')
    expect(matchesCombo(bareL, keydown({ key: 'l' }))).toBe(true)
    expect(matchesCombo(bareL, keydown({ key: 'l', ctrlKey: true }))).toBe(false)
    expect(matchesCombo(bareL, keydown({ key: 'l', metaKey: true }))).toBe(false)
  })
})

describe('ShortcutRegistry', () => {
  it('fires a matching combo on window and claims the event', async () => {
    const ctx = new Context()
    const registry = new ShortcutRegistry(ctx)
    const handler = vi.fn()
    registry.register('mod+l', handler)
    const event = keydown({ key: 'l', ctrlKey: true })
    const prevent = vi.spyOn(event, 'preventDefault')
    const stop = vi.spyOn(event, 'stopPropagation')
    window.dispatchEvent(event)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(prevent).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('releases the event while focus sits in a text field by default', async () => {
    const ctx = new Context()
    const registry = new ShortcutRegistry(ctx)
    const handler = vi.fn()
    registry.register('mod+l', handler)
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.dispatchEvent(keydown({ key: 'l', ctrlKey: true }))
    expect(handler).not.toHaveBeenCalled()
    registry.register('mod+k', handler, { allowInTextField: true })
    textarea.dispatchEvent(keydown({ key: 'k', metaKey: true }))
    expect(handler).toHaveBeenCalledTimes(1)
    textarea.remove()
    await ctx.fiber.dispose()
  })

  it('contains handler errors without breaking later combos', async () => {
    const ctx = new Context()
    const registry = new ShortcutRegistry(ctx)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const good = vi.fn()
    registry.register('mod+a', () => { throw new Error('boom') })
    registry.register('mod+b', good)
    window.dispatchEvent(keydown({ key: 'a', ctrlKey: true }))
    window.dispatchEvent(keydown({ key: 'b', ctrlKey: true }))
    expect(good).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith('[shortcuts] handler threw:', expect.any(Error))
    errorSpy.mockRestore()
    await ctx.fiber.dispose()
  })

  it('rejects duplicate and malformed combos', async () => {
    const ctx = new Context()
    const registry = new ShortcutRegistry(ctx)
    registry.register('mod+l', () => {})
    expect(() => registry.register('MOD+L', () => {})).toThrow('already bound')
    expect(() => registry.register('mod+', () => {})).toThrow('has an empty token')
    await ctx.fiber.dispose()
  })

  it('returns a disposer that removes the binding', async () => {
    const ctx = new Context()
    const registry = new ShortcutRegistry(ctx)
    const handler = vi.fn()
    const dispose = registry.register('mod+l', handler)
    dispose()
    window.dispatchEvent(keydown({ key: 'l', ctrlKey: true }))
    expect(handler).not.toHaveBeenCalled()
    expect(() => dispose()).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('removes the window listener when the owning fiber disposes', async () => {
    const ctx = new Context()
    let registry: ShortcutRegistry | undefined
    const handler = vi.fn()
    await ctx.plugin({
      apply: (inner) => {
        registry = new ShortcutRegistry(inner)
        registry.register('mod+l', handler)
      },
    }).await()
    window.dispatchEvent(keydown({ key: 'l', ctrlKey: true }))
    expect(handler).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
    window.dispatchEvent(keydown({ key: 'l', ctrlKey: true }))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(registry).toBeDefined()
  })
})
