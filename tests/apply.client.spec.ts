// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'
import { ShortcutRegistry } from '../src/client/registry.ts'

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init })
}

function stubSessions(overrides: {
  current?: unknown
  scope?: (id: unknown) => { get(name: string): unknown } | undefined
  conversation?: unknown
} = {}): { scope: ReturnType<typeof vi.fn>; getSnapshot: ReturnType<typeof vi.fn> } {
  const scope = vi.fn().mockReturnValue(overrides.scope === undefined
    ? { get: () => overrides.conversation }
    : overrides.scope('s1'))
  const getSnapshot = vi.fn().mockReturnValue({
    current: 'current' in overrides ? overrides.current : 's1',
  })
  return { scope, getSnapshot }
}

async function mount(sessions?: unknown, workspaces?: unknown): Promise<Context> {
  const ctx = new Context()
  if (sessions !== undefined) ctx.provide('sessions', sessions)
  if (workspaces !== undefined) ctx.provide('workspaces', workspaces)
  await ctx.plugin({ apply }).await()
  return ctx
}

describe('shortcuts apply', () => {
  it('provides ctx.shortcuts with the default bindings, tolerating absent services', async () => {
    const ctx = await mount()
    expect(ctx.get('shortcuts')).toBeInstanceOf(ShortcutRegistry)
    await ctx.fiber.dispose()
  })

  it('mod+l focuses the composer textarea', async () => {
    const ctx = await mount()
    const textarea = document.createElement('textarea')
    textarea.dataset.phase = 'ready'
    document.body.append(textarea)
    window.dispatchEvent(keydown({ key: 'l', ctrlKey: true }))
    expect(document.activeElement).toBe(textarea)
    textarea.remove()
    await ctx.fiber.dispose()
  })

  it('mod+l is a no-op without a composer textarea', async () => {
    const ctx = await mount()
    expect(() => window.dispatchEvent(keydown({ key: 'l', metaKey: true }))).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('mod+shift+k starts a session through workspaces, even in a text field', async () => {
    const startSession = vi.fn()
    const ctx = await mount(undefined, { startSession })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.dispatchEvent(keydown({ key: 'k', ctrlKey: true, shiftKey: true }))
    expect(startSession).toHaveBeenCalledTimes(1)
    textarea.remove()
    await ctx.fiber.dispose()
  })




  it('mod+shift+k is a no-op without a workspaces service', async () => {
    const ctx = await mount()
    expect(() => window.dispatchEvent(keydown({ key: 'k', metaKey: true, shiftKey: true }))).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('mod+]/mod+[ navigate through the real ids snapshot', async () => {
    const open = vi.fn()
    const getSnapshot = vi.fn().mockReturnValue({ ids: ['s1', 's2', 's3'], current: 's2' })
    const ctx = await mount({ list: { getSnapshot }, open })
    window.dispatchEvent(keydown({ key: ']', metaKey: true }))
    expect(open).toHaveBeenCalledWith('s3')
    window.dispatchEvent(keydown({ key: '[', metaKey: true }))
    expect(open).toHaveBeenLastCalledWith('s1')
    await ctx.fiber.dispose()
  })

  it('prev/next wraps around at both ends of the list', async () => {
    const open = vi.fn()
    const getSnapshot = vi.fn().mockReturnValue({ ids: ['s1', 's2'], byId: { s1: { updatedAt: 20 }, s2: { updatedAt: 10 } }, current: 's1' })
    const ctx = await mount({ list: { getSnapshot }, open })
    // prev from the head wraps to the tail.
    window.dispatchEvent(keydown({ key: '[', metaKey: true }))
    expect(open).toHaveBeenLastCalledWith('s2')
    open.mockClear()
    getSnapshot.mockReturnValue({ ids: ['s1', 's2'], byId: { s1: { updatedAt: 20 }, s2: { updatedAt: 10 } }, current: 's2' })
    // next from the tail wraps back to the head.
    window.dispatchEvent(keydown({ key: ']', metaKey: true }))
    expect(open).toHaveBeenLastCalledWith('s1')
    await ctx.fiber.dispose()
  })

  it('prev/next crosses workspaces in sidebar order, skips blanks and ungrouped trails last', async () => {
    const open = vi.fn()
    // Sidebar order: workspace A [a1, a2] (recency), workspace B [b1], ungrouped [u1].
    // sessionIds is manual attach order — the walk uses updatedAt inside each group.
    const getSnapshot = vi.fn().mockReturnValue({
      ids: ['u1', 'b1', 'a2', 'blank1', 'a1'],
      byId: {
        u1: { updatedAt: 99 },
        b1: { updatedAt: 0 },
        a1: { updatedAt: 30 },
        blank1: { blank: true, updatedAt: 20 },
        a2: { updatedAt: 10 },
      },
      current: 'a1',
    })
    const wsSnapshot = {
      items: [{ sessionIds: ['a2', 'blank1', 'a1'] }, { sessionIds: ['b1'] }],
      archivedSessionIds: [],
    }
    const ctx = new Context()
    ctx.provide('sessions', { list: { getSnapshot }, open })
    ctx.provide('workspaces', { list: { getSnapshot: () => wsSnapshot } })
    await ctx.plugin({ apply }).await()
    // next walks the full sidebar order: a1 -> a2 (skipping blank), then b1, then u1.
    window.dispatchEvent(keydown({ key: ']', metaKey: true }))
    expect(open).toHaveBeenLastCalledWith('a2')
    open.mockClear()
    getSnapshot.mockReturnValue({
      ids: ['u1', 'b1', 'a2', 'blank1', 'a1'],
      byId: {
        u1: { updatedAt: 99 }, b1: { updatedAt: 0 }, a1: { updatedAt: 30 },
        blank1: { blank: true, updatedAt: 20 }, a2: { updatedAt: 10 },
      },
      current: 'a2',
    })
    window.dispatchEvent(keydown({ key: ']', metaKey: true }))
    expect(open).toHaveBeenLastCalledWith('b1')
    open.mockClear()
    getSnapshot.mockReturnValue({
      ids: ['u1', 'b1', 'a2', 'blank1', 'a1'],
      byId: {
        u1: { updatedAt: 99 }, b1: { updatedAt: 0 }, a1: { updatedAt: 30 },
        blank1: { blank: true, updatedAt: 20 }, a2: { updatedAt: 10 },
      },
      current: 'b1',
    })
    window.dispatchEvent(keydown({ key: ']', metaKey: true }))
    expect(open).toHaveBeenLastCalledWith('u1')
    // prev from u1 (tail) walks back: u1 -> b1.
    open.mockClear()
    getSnapshot.mockReturnValue({
      ids: ['u1', 'b1', 'a2', 'blank1', 'a1'],
      byId: {
        u1: { updatedAt: 99 }, b1: { updatedAt: 0 }, a1: { updatedAt: 30 },
        blank1: { blank: true, updatedAt: 20 }, a2: { updatedAt: 10 },
      },
      current: 'u1',
    })
    window.dispatchEvent(keydown({ key: '[', metaKey: true }))
    expect(open).toHaveBeenLastCalledWith('b1')
    await ctx.fiber.dispose()
  })

  it('mod+shift+e toggles the details panel open and closed', async () => {
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn() }
    const ctx = new Context()
    ctx.provide('layout', layout)
    await ctx.plugin({ apply }).await()
    // No frame in the DOM (or a collapsed one): opens.
    window.dispatchEvent(keydown({ key: 'e', metaKey: true, shiftKey: true }))
    expect(layout.openDetails).toHaveBeenCalledTimes(1)
    expect(layout.closeDetails).not.toHaveBeenCalled()
    // Expanded frame present (no data-details-collapsed): closes.
    const frame = document.createElement('div')
    frame.setAttribute("style", "grid-template-columns: 200px minmax(0, 1fr) 300px")
    document.body.append(frame)
    layout.openDetails.mockClear()
    window.dispatchEvent(keydown({ key: 'e', metaKey: true, shiftKey: true }))
    expect(layout.closeDetails).toHaveBeenCalledTimes(1)
    expect(layout.openDetails).not.toHaveBeenCalled()
    // Collapsed frame present: opens again.
    frame.setAttribute('data-details-collapsed', '')
    layout.closeDetails.mockClear()
    window.dispatchEvent(keydown({ key: 'e', metaKey: true, shiftKey: true }))
    expect(layout.openDetails).toHaveBeenCalledTimes(1)
    frame.remove()
    await ctx.fiber.dispose()
  })

  it('prev/next recovers from a blank current session', async () => {
    const open = vi.fn()
    const getSnapshot = vi.fn().mockReturnValue({
      ids: ['s1', 's2', 'blank1'],
      byId: { s1: { updatedAt: 20 }, s2: { updatedAt: 10 }, blank1: { blank: true, updatedAt: 30 } },
      current: 'blank1',
    })
    const wsSnapshot = { items: [{ sessionIds: ['s1', 's2', 'blank1'] }], archivedSessionIds: [] }
    const ctx = new Context()
    ctx.provide('sessions', { list: { getSnapshot }, open })
    ctx.provide('workspaces', { list: { getSnapshot: () => wsSnapshot } })
    await ctx.plugin({ apply }).await()
    // A blank current is "before the head": next enters at the newest (s1),
    // prev wraps to the tail (s2).
    window.dispatchEvent(keydown({ key: ']', metaKey: true }))
    expect(open).toHaveBeenCalledWith('s1')
    open.mockClear()
    window.dispatchEvent(keydown({ key: '[', metaKey: true }))
    expect(open).toHaveBeenCalledWith('s2')
    await ctx.fiber.dispose()
  })
})
