/**
 * Editable action bindings layered on the ShortcutRegistry. Each action owns a
 * default combo (shown cmd-friendly), a label, an icon, and a run() that reads
 * its target client service at press time. ShortcutBindings registers them,
 * tracks per-action hit counts, and supports rebind/reset with conflict errors
 * surfaced straight from the registry.
 *
 * The registry speaks `mod`; this module is the single place that translates
 * the cmd-friendly UI vocabulary (`cmd`/`meta` → `mod`) and canonicalizes order.
 *
 * Defaults avoid browser-reserved combos (cmd+n/t/w, cmd+shift+n/t/w/i/j/c,
 * cmd+alt+i/j/u): those fire the browser's own behavior before any page
 * listener can preventDefault, so they can never be bound in a web plugin.
 * They also avoid Option/Alt as a modifier for letters and brackets: on macOS
 * Option rewrites the produced character (cmd+alt+c yields `ç`, cmd+alt+[
 * yields `「`), so `event.key` no longer matches the registered key.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import {
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconChevronUpOutline14,
  IconDarkOutline16,
  IconEditOutline16,
  IconInspectOutline12,
  IconNewChatOutline16,
  IconPanelLeftOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { parseCombo, ShortcutRegistry } from './registry.ts'

/** UI combo (`cmd+shift+c`) → registry combo (`mod+shift+c`), canonicalized. Throws on invalid input. */
export function toRegistryCombo(display: string): string {
  const translated = display.trim().toLowerCase()
    .replace(/\bcmd\b/g, 'mod')
    .replace(/\bmeta\b/g, 'mod')
  const parsed = parseCombo(translated)
  const parts: string[] = []
  if (parsed.ctrl || parsed.meta) parts.push('mod')
  if (parsed.alt) parts.push('alt')
  if (parsed.shift) parts.push('shift')
  parts.push(parsed.key)
  return parts.join('+')
}

/** Registry combo → UI combo (`mod` → `cmd`). */
export function toDisplayCombo(regCombo: string): string {
  return regCombo.toLowerCase().replace(/\bmod\b/g, 'cmd')
}

export interface ShortcutAction {
  id: string
  /**
   * Default combo in display form (`cmd+l`). An empty string means the action
   * ships unbound — the user records a combo to activate it (resetting clears
   * the binding back to empty).
   */
  defaultCombo: string
  label: string
  allowInTextField: boolean
  icon: ReactNode
  run: () => void
}

interface LayoutFace {
  toggleSidebar(): void
  openDetails(): void
  closeDetails(): void
}

interface ThemeFace {
  getTheme(): { preference?: string }
  setTheme(id: string): void
}

/** The session list snapshot (SessionListState): an ordered id list plus the current id. */
interface SessionListSnapshot {
  current?: string
  currentId?: string
  /** Real SessionListState field: ordered session ids (all workspaces, flat). */
  ids?: string[]
  /** Real SessionListState field: session summaries; `blank` rows are the hidden "new session" entries. */
  byId?: Record<string, { blank?: boolean; updatedAt?: number }>
  ordered?: string[]
  items?: Array<{ id?: string }>
}

interface SessionsFace {
  list?: { getSnapshot?: () => SessionListSnapshot }
  scope?: (id: string) => unknown
  open?: (id: string) => void
}

/** WorkspaceListState: workspaces with their ordered sessionIds, plus the archive set. */
interface WorkspacesFace {
  startSession?: () => void
  list?: { getSnapshot?: () => WorkspacesSnapshot }
}

interface WorkspacesSnapshot {
  items?: Array<{ sessionIds?: string[] }>
  archivedSessionIds?: string[]
}

const COMPOSER_SELECTOR = 'textarea[data-phase]'

/** Read the ordered session ids + current id from the list snapshot, defensively. */
function readSessionOrder(sessions: SessionsFace | undefined): { ids: string[]; current: string | undefined } {
  let snap: SessionListSnapshot | undefined
  try { snap = sessions?.list?.getSnapshot?.() } catch { snap = undefined }
  const current = snap?.current ?? snap?.currentId
  const asStrings = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  // `ids` is the real SessionListState field; `ordered`/`items` stay for stubs.
  const ids = asStrings(snap?.ids).length > 0
    ? asStrings(snap?.ids)
    : asStrings(snap?.ordered).length > 0
      ? asStrings(snap?.ordered)
      : asStrings(snap?.items?.map((i) => i?.id))
  return { ids, current }
}

/**
 * Move to the session at offset +delta from the current one, mirroring the
 * sidebar's full display order: workspaces in registry display order, each
 * group's sessions by recency (updatedAt descending, id tiebreak), with the
 * ungrouped bucket appended last — blank ("new session") and archived rows
 * skipped, exactly like the sidebar's grouping.
 */
function navigateSession(sessions: SessionsFace | undefined, workspaces: WorkspacesFace | undefined, delta: number): void {
  const { ids: flatIds, current } = readSessionOrder(sessions)
  if (current === undefined) return
  const sessionSnap = (() => {
    try { return sessions?.list?.getSnapshot?.() } catch { return undefined }
  })()
  const summaryOf = (id: string) => sessionSnap?.byId?.[id]
  let wsSnap: WorkspacesSnapshot | undefined
  try { wsSnap = workspaces?.list?.getSnapshot?.() } catch { wsSnap = undefined }
  const archived = new Set(Array.isArray(wsSnap?.archivedSessionIds) ? wsSnap.archivedSessionIds : [])
  const hidden = (id: string): boolean => summaryOf(id)?.blank === true || archived.has(id)
  const byRecency = (a: string, b: string): number => {
    const at = summaryOf(a)?.updatedAt ?? 0
    const bt = summaryOf(b)?.updatedAt ?? 0
    if (bt !== at) return bt - at
    return a < b ? -1 : 1
  }
  // Sidebar order: each workspace's visible members by recency, ungrouped last.
  const ordered: string[] = []
  const accounted = new Set<string>()
  for (const w of wsSnap?.items ?? []) {
    if (!Array.isArray(w?.sessionIds)) continue
    const members = w.sessionIds.filter(id => !hidden(id))
    members.sort(byRecency)
    ordered.push(...members)
    for (const id of w.sessionIds) accounted.add(id)
  }
  const stray = flatIds.filter(id => !accounted.has(id) && !hidden(id))
  stray.sort(byRecency)
  ordered.push(...stray)
  if (ordered.length === 0) return
  // The walk wraps around: past the tail re-enters at the head and vice versa.
  // A -1 (blank/unlisted) current sits "before the head": next enters the head, prev the tail.
  const len = ordered.length
  const idx = ordered.indexOf(current)
  const next = idx === -1
    ? (delta > 0 ? 0 : len - 1)
    : (((idx + delta) % len) + len) % len
  const target = ordered[next]
  if (target !== undefined) sessions?.open?.(target)
}

/** Toggle the details panel: the layout frame carries data-details-collapsed exactly while the column is closed. */
function toggleDetails(layout: LayoutFace | undefined): void {
  // Match on the bare "minmax" substring: the browser may serialize the grid
  // template with or without inner spaces.
  const frame = document.querySelector<HTMLDivElement>('div[style*="minmax"]')
  const collapsed = frame === null || frame.hasAttribute('data-details-collapsed')
  if (collapsed) layout?.openDetails()
  else layout?.closeDetails()
}

/** Toggle between light and dark theme (system preference untouched). */
function toggleTheme(theme: ThemeFace | undefined): void {
  if (theme === undefined) return
  try {
    const pref = theme.getTheme().preference
    theme.setTheme(pref === 'dark' ? 'light' : 'dark')
  } catch { /* getTheme/setTheme shape divergence: silently no-op */ }
}

/** Best-effort scroll of the conversation transcript to top/bottom. */
function scrollTranscript(toEnd: boolean): void {
  const sel = '[data-conversation-scroller],[data-session-scroller],[class*="onversation"] [class*="croll"],main [class*="crollport"]'
  const el = document.querySelector<HTMLElement>(sel)
  if (el === null) return
  el.scrollTo({ top: toEnd ? el.scrollHeight : 0, behavior: 'smooth' })
}

/** Build the action set with handlers bound to the live client services. */
export function createActions(ctx: Context): ShortcutAction[] {
  const workspaces = ctx.get('workspaces') as WorkspacesFace | undefined
  const sessions = ctx.get('sessions') as SessionsFace | undefined
  const layout = ctx.get('layout') as LayoutFace | undefined
  const theme = ctx.get('theme') as ThemeFace | undefined

  return [
    {
      id: 'focus-composer',
      defaultCombo: 'cmd+l',
      label: '聚焦输入框',
      allowInTextField: false,
      icon: <IconEditOutline16 size={16} />,
      run: () => {
        const el = document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR)
        if (el) el.focus()
      },
    },
    {
      id: 'new-session',
      defaultCombo: 'cmd+shift+k',
      label: '新建会话',
      allowInTextField: true,
      icon: <IconNewChatOutline16 size={16} />,
      run: () => { workspaces?.startSession?.() },
    },
    {
      id: 'toggle-sidebar',
      defaultCombo: 'cmd+b',
      label: '切换侧栏',
      allowInTextField: true,
      icon: <IconPanelLeftOutline16 size={16} />,
      run: () => { layout?.toggleSidebar() },
    },
    {
      id: 'open-details',
      defaultCombo: 'cmd+shift+e',
      label: '切换详情面板',
      allowInTextField: true,
      icon: <IconInspectOutline12 size={16} />,
      run: () => { toggleDetails(layout) },
    },
    {
      id: 'prev-session',
      defaultCombo: 'cmd+[',
      label: '上一个会话',
      allowInTextField: true,
      icon: <IconChevronLeftOutline14 size={16} />,
      run: () => { navigateSession(sessions, workspaces, -1) },
    },
    {
      id: 'next-session',
      defaultCombo: 'cmd+]',
      label: '下一个会话',
      allowInTextField: true,
      icon: <IconChevronRightOutline14 size={16} />,
      run: () => { navigateSession(sessions, workspaces, +1) },
    },
    {
      id: 'toggle-theme',
      defaultCombo: '',
      label: '切换浅色/深色主题',
      allowInTextField: true,
      icon: <IconDarkOutline16 size={16} />,
      run: () => { toggleTheme(theme) },
    },
    {
      id: 'scroll-top',
      defaultCombo: '',
      label: '滚动到对话顶部',
      allowInTextField: true,
      icon: <IconChevronUpOutline14 size={16} />,
      run: () => { scrollTranscript(false) },
    },
    {
      id: 'scroll-bottom',
      defaultCombo: '',
      label: '滚动到对话底部',
      allowInTextField: true,
      icon: <IconChevronDownOutline14 size={16} />,
      run: () => { scrollTranscript(true) },
    },
    {
      id: 'fork-session',
      defaultCombo: '',
      label: '分叉当前会话',
      allowInTextField: true,
      icon: <IconBranchOutline16 size={16} />,
      run: () => {
        const { current } = readSessionOrder(sessions)
        if (current === undefined) return
        const fork = (sessions as { fork?: (o: { sessionId: string }) => Promise<unknown> } | undefined)?.fork
        if (fork) void fork({ sessionId: current }).catch(() => {})
      },
    },
  ]
}

/**
 * Owns the editable lifecycle of the action bindings on top of the registry.
 * Lives for the whole fiber (survives settings page mount/unmount); the page
 * only reads and mutates through these methods.
 */
export class ShortcutBindings {
  private readonly current = new Map<string, string>()
  private readonly disposers = new Map<string, () => void>()
  private readonly hits = new Map<string, number>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly registry: ShortcutRegistry, private readonly actions: ShortcutAction[]) {
    for (const a of actions) {
      if (a.defaultCombo === '') {
        // Ships unbound — register only once the user records a combo.
        this.current.set(a.id, '')
      } else {
        const reg = toRegistryCombo(a.defaultCombo)
        this.current.set(a.id, reg)
        this.disposers.set(a.id, registry.register(reg, this.wrap(a), { allowInTextField: a.allowInTextField }))
      }
    }
  }

  private wrap(a: ShortcutAction): () => void {
    return () => {
      a.run()
      this.hits.set(a.id, (this.hits.get(a.id) ?? 0) + 1)
      this.emit()
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  list(): Array<{ action: ShortcutAction; combo: string; hits: number }> {
    return this.actions.map((a) => {
      const reg = this.current.get(a.id) ?? ''
      return {
        action: a,
        combo: reg === '' ? '' : toDisplayCombo(reg),
        hits: this.hits.get(a.id) ?? 0,
      }
    })
  }

  isDefault(id: string): boolean {
    const a = this.actions.find((x) => x.id === id)
    if (a === undefined) return false
    const cur = this.current.get(id) ?? ''
    const def = a.defaultCombo === '' ? '' : toRegistryCombo(a.defaultCombo)
    return cur === def
  }

  /**
   * Rebind an action to a new combo (display form). An empty combo unbinds the
   * action. For a non-empty combo, the new binding is registered first so a
   * conflict leaves the old binding intact, then the old one is dropped.
   * @returns the display combo now in effect ('' when unbound).
   * @throws on an unknown id, a malformed non-empty combo, or a combo already bound.
   */
  rebind(id: string, displayCombo: string): string {
    const a = this.actions.find((x) => x.id === id)
    if (a === undefined) throw new Error('未知动作：' + id)
    const trimmed = displayCombo.trim()
    if (trimmed === '') {
      // Unbind.
      this.disposers.get(id)?.()
      this.disposers.delete(id)
      this.current.set(id, '')
      this.emit()
      return ''
    }
    const reg = toRegistryCombo(trimmed)
    const old = this.current.get(id) ?? ''
    if (reg === old) return toDisplayCombo(reg)
    const disposer = this.registry.register(reg, this.wrap(a), { allowInTextField: a.allowInTextField })
    this.disposers.get(id)?.()
    this.current.set(id, reg)
    this.disposers.set(id, disposer)
    this.emit()
    return toDisplayCombo(reg)
  }

  reset(id: string): string {
    const a = this.actions.find((x) => x.id === id)
    if (a === undefined) throw new Error('未知动作：' + id)
    return this.rebind(id, a.defaultCombo)
  }
}
