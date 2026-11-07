/**
 * The "快捷键" settings page. Registered into `settings.section` and built from
 * host-provided primitives (Button / Input / Pill / icons) — no custom
 * component reimplementation. Styles are a small, reversibly-injected
 * `<style>` block (the client bundle loads via window.__ModuleLoader__, so a
 * separate extracted CSS file would never be served; runtime injection is the
 * only reliable path, matching how the shell's own bundles inject styles).
 *
 * One list of every bindable action. Actions with a default combo ship bound;
 * actions whose default is empty ship unbound (placeholder "未绑定") and are
 * activated by recording a combo. Each row is rebindable (type a combo, or
 * 录制 to press it) and resettable (reset on an empty-default action clears it).
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ShortcutRegistry } from './registry.ts'
import { ShortcutBindings } from './actions.tsx'

interface SlotRegisterOptions {
  name: string
  id: string
  order?: number
  label?: string
}
type SlotRender = (props: { close: () => void }) => ReactNode
interface SlotsService {
  inject(key: string, cb: () => unknown): () => void
  register(opts: SlotRegisterOptions, render: SlotRender): unknown
}

const STYLE_ID = 'dsh-shortcuts-settings-style'
const STYLES = `
.sc-page{padding:16px 20px;color:var(--dsw-alias-label-primary)}
.sc-title{font-size:17px;font-weight:600;margin:0 0 4px}
.sc-desc{font-size:13px;color:var(--dsw-alias-label-secondary);margin:0 0 12px;line-height:1.5}
.sc-desc code{font-family:ui-monospace,monospace;background:var(--dsw-alias-bg-layer-2);padding:1px 6px;border-radius:4px}
.sc-sectionTitle{font-size:14px;font-weight:600;margin:14px 0 6px;color:var(--dsw-alias-label-primary)}
.sc-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.sc-icon{display:inline-flex;color:var(--dsw-alias-label-secondary)}
.sc-label{flex:1;font-size:13px}
.sc-comboInput{width:150px}
.sc-comboInput input{text-align:center;font-family:ui-monospace,monospace;font-size:13px}
.sc-comboInput input::placeholder{color:var(--dsw-alias-label-secondary);opacity:0.7}
.sc-rec{font-family:ui-monospace,monospace;font-size:13px;color:var(--dsw-alias-state-warn-primary);width:150px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:6px 16px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)}
.sc-hits{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:64px}
.sc-error{color:var(--dsw-alias-state-error-primary);font-size:13px;margin-bottom:8px}
.sc-message{color:var(--dsw-alias-state-success-primary);font-size:13px;margin-bottom:8px}
`

/** Mount the settings section; the inject disposer is owned by the fiber. */
export function mountShortcutsSettings(ctx: Context, registry: ShortcutRegistry, bindings: ShortcutBindings): void {
  const slots = ctx.get('slots') as SlotsService | undefined
  if (slots === undefined) return
  ctx.effect(() => slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'shortcuts', order: 5, label: '快捷键' },
    () => <ShortcutsPage bindings={bindings} registry={registry} />,
  )))
}

const NAMED_KEYS: Record<string, string> = {
  enter: 'Enter', escape: 'Escape', esc: 'Escape', space: ' ', tab: 'Tab', backspace: 'Backspace', delete: 'Delete',
}

/** Build a cmd-friendly combo string from a real keydown, or null to keep waiting. */
function keyToCombo(e: KeyboardEvent): string | null {
  if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'CapsLock') return null
  const token = e.key === ' ' ? 'space' : e.key.toLowerCase()
  if (NAMED_KEYS[token] === undefined && token.length !== 1) return null
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('cmd')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(token)
  return parts.join('+')
}

/** Combos the browser consumes before any page listener can preventDefault — never bindable in a web plugin. */
const RESERVED_COMBOS: ReadonlySet<string> = new Set([
  'cmd+t', 'cmd+n', 'cmd+w', 'cmd+q',
  'cmd+shift+n', 'cmd+shift+t', 'cmd+shift+w', 'cmd+shift+q',
  'cmd+shift+i', 'cmd+shift+j', 'cmd+shift+c', 'cmd+shift+o', 'cmd+shift+b', 'cmd+shift+d', 'cmd+shift+m',
  'cmd+alt+i', 'cmd+alt+j', 'cmd+alt+u',
])

/** Whether a cmd-friendly combo can never work in the browser (reserved, or macOS rewrites the character). */
export function isUnbindableCombo(combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1] ?? ''
  const hasCmd = parts.includes('cmd')
  const hasAlt = parts.includes('alt')
  if (hasCmd && !hasAlt && RESERVED_COMBOS.has('cmd+' + (parts.includes('shift') ? 'shift+' : '') + key)) return true
  // macOS Option rewrites letters/brackets (cmd+alt+c yields ç), so event.key never matches.
  if (hasAlt && (key.length === 1 || key === '[' || key === ']')) return true
  return false
}

/** Capture one combo from a real keypress; pauses the registry while listening. Returns a cancel fn. */
function recordCombo(registry: ShortcutRegistry, onDone: (combo: string | null) => void): () => void {
  registry.paused = true
  let finished = false
  const finish = (combo: string | null): void => {
    if (finished) return
    finished = true
    window.removeEventListener('keydown', listener, true)
    registry.paused = false
    onDone(combo)
  }
  const listener = (e: KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') { finish(null); return }
    const combo = keyToCombo(e)
    if (combo !== null) finish(combo)
  }
  window.addEventListener('keydown', listener, true)
  return () => finish(null)
}

/** Reversibly inject the page styles for the lifetime of this component tree. */
function useStyles(): void {
  useEffect(() => {
    if (document.getElementById(STYLE_ID) !== null) return
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = STYLES
    document.head.appendChild(el)
    return () => { el.remove() }
  }, [])
}

function ShortcutsPage({ bindings, registry }: { bindings: ShortcutBindings; registry: ShortcutRegistry }): ReactNode {
  useStyles()
  const [, setTick] = useState(0)
  useEffect(() => bindings.subscribe(() => setTick((n) => n + 1)), [bindings])

  const rows = bindings.list()
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.action.id, r.combo])),
  )
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [recId, setRecId] = useState<string | null>(null)
  const cancelRecRef = useRef<() => void>(() => {})
  useEffect(() => () => cancelRecRef.current(), [])

  const labelOf = (id: string): string => rows.find((r) => r.action.id === id)?.action.label ?? ''
  const comboOf = (id: string): string => rows.find((r) => r.action.id === id)?.combo ?? ''

  const commit = (id: string, raw: string): void => {
    const trimmed = raw.trim()
    // An empty commit unbinds the action (matches reset on an empty-default action).
    if (trimmed !== '' && isUnbindableCombo(trimmed)) {
      setDrafts((prev) => ({ ...prev, [id]: comboOf(id) }))
      setError('「' + trimmed + '」被浏览器占用（保留快捷键' + (trimmed.includes('alt') ? '，且 macOS 会改写 Alt 组合的字符' : '') + '），无法绑定')
      return
    }
    try {
      const applied = bindings.rebind(id, trimmed)
      setDrafts((prev) => ({ ...prev, [id]: applied }))
      setError('')
      setMessage(labelOf(id) + ' → ' + (applied === '' ? '未绑定' : applied))
    } catch (err) {
      setDrafts((prev) => ({ ...prev, [id]: comboOf(id) }))
      setError(String((err as Error)?.message ?? err))
    }
  }

  const startRec = (id: string): void => {
    setRecId(id)
    cancelRecRef.current = recordCombo(registry, (combo) => {
      setRecId(null)
      if (combo !== null) commit(id, combo)
    })
  }
  const stopRec = (): void => { cancelRecRef.current(); setRecId(null) }

  const reset = (id: string): void => {
    const applied = bindings.reset(id)
    setDrafts((prev) => ({ ...prev, [id]: applied }))
    setMessage(labelOf(id) + ' → ' + (applied === '' ? '未绑定' : applied))
  }

  return (
    <div className="sc-page">
      <h2 className="sc-title">快捷键</h2>
      <p className="sc-desc">
        修改组合键：直接输入（如 <code>cmd+alt+t</code>，回车或失焦生效），或用「录制」直接按键。cmd 表示 ⌘ Command（⌘ 与 ⌃ 均可触发）。留空的项需点「录制」设置。浏览器保留组合键（如 <code>cmd+t/n/w</code>）与 macOS 的 Alt 字符改写组合无法绑定，录制或输入时会提示。
      </p>

      <div className="sc-sectionTitle">动作绑定</div>
      {rows.map((r) => (
        <div className="sc-row" key={r.action.id}>
          <span className="sc-icon">{r.action.icon}</span>
          <span className="sc-label">{r.action.label}</span>
          {recId === r.action.id
            ? <Pill className="sc-rec">按下组合键… Esc 取消</Pill>
            : <Input
                className="sc-comboInput"
                value={drafts[r.action.id] ?? r.combo}
                placeholder={r.action.defaultCombo === '' ? '未绑定' : r.action.defaultCombo}
                spellCheck={false}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [r.action.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(r.action.id, drafts[r.action.id] ?? r.combo) }}
                onBlur={() => commit(r.action.id, drafts[r.action.id] ?? r.combo)}
              />}
          {recId === r.action.id
            ? <Button variant="ghost" size="sm" onClick={stopRec}>取消</Button>
            : <Button variant="ghost" size="sm" onClick={() => startRec(r.action.id)}>录制</Button>}
          <Button variant="ghost" size="sm" onClick={() => reset(r.action.id)} disabled={bindings.isDefault(r.action.id)}>重置</Button>
          {r.hits > 0 ? <span className="sc-hits">触发 {r.hits} 次</span> : <span className="sc-hits" />}
        </div>
      ))}

      {error !== '' ? <div className="sc-error">{error}</div> : null}
      {message !== '' ? <div className="sc-message">{message}</div> : null}
    </div>
  )
}
