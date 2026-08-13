/**
 * Global keyboard shortcut registry (browser half). One capture-phase
 * `keydown` listener on window serves every registered combo, so shortcuts
 * fire before the focused control sees the event; text-field focus releases
 * the event by default unless a binding opts in.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Per-binding options controlling when a combo fires. */
export interface ShortcutOptions {
  /**
   * Fire while focus sits in a textarea/input/contentEditable element.
   * Default false: the composer's own keyboard machine keeps the event.
   */
  allowInTextField?: boolean
}

/** One parsed combo: the key plus each modifier requirement. */
export interface ParsedCombo {
  /** Lowercased key token (compared against `event.key` lowercased). */
  key: string
  /** shiftKey must match exactly. */
  shift: boolean
  /** altKey must match exactly. */
  alt: boolean
  /** Ctrl requirement; true with meta means "either modifier" (`mod`). */
  ctrl: boolean
  /** Meta requirement; true with ctrl means "either modifier" (`mod`). */
  meta: boolean
}

interface Binding extends Required<ShortcutOptions> {
  combo: ParsedCombo
  handler: () => void
}

/**
 * Parse a combo string into its key and modifier requirements.
 * @param combo - '+' separated tokens, e.g. `mod+shift+c`; `mod` matches
 *   Cmd on macOS and Ctrl elsewhere, while `ctrl`/`meta` are strict.
 * @returns the parsed combo.
 * @throws when the combo is empty, has an empty token, or names more than one key.
 */
export function parseCombo(combo: string): ParsedCombo {
  if (combo === '') throw new Error('shortcuts: combo has no key')
  const tokens = combo.toLowerCase().split('+')
  let key = ''
  let shift = false
  let alt = false
  let ctrl = false
  let meta = false
  for (const token of tokens) {
    if (token === 'mod') {
      ctrl = true
      meta = true
    } else if (token === 'shift') {
      shift = true
    } else if (token === 'alt') {
      alt = true
    } else if (token === 'ctrl') {
      ctrl = true
    } else if (token === 'meta') {
      meta = true
    } else if (token === '') {
      throw new Error(`shortcuts: combo "${combo}" has an empty token`)
    } else if (key === '') {
      key = token
    } else {
      throw new Error(`shortcuts: combo "${combo}" names more than one key`)
    }
  }
  if (key === '') throw new Error(`shortcuts: combo "${combo}" has no key`)
  return { key, shift, alt, ctrl, meta }
}

/**
 * Whether the event target is a text-editing element the composer owns.
 * @param target - the raw keydown target.
 * @returns true for textarea/input/contentEditable elements.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  // jsdom leaves isContentEditable undefined, so the contentEditable
  // attribute check backs it in tests; browsers implement both.
  return target instanceof HTMLTextAreaElement
    || target instanceof HTMLInputElement
    || Boolean(target.isContentEditable)
    || target.contentEditable === 'true'
}

/**
 * Whether the pressed state of an event satisfies one parsed combo.
 * @param combo - the parsed requirement.
 * @param event - the live keydown event.
 * @returns true when key and modifiers match.
 */
export function matchesCombo(combo: ParsedCombo, event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== combo.key) return false
  if (event.shiftKey !== combo.shift) return false
  if (event.altKey !== combo.alt) return false
  if (combo.ctrl !== combo.meta) {
    // Exactly one of ctrl/meta required: the other must not be pressed.
    if (event.ctrlKey !== combo.ctrl || event.metaKey !== combo.meta) return false
  } else if (combo.ctrl) {
    // `mod`: either modifier satisfies.
    if (!event.ctrlKey && !event.metaKey) return false
  } else if (event.ctrlKey || event.metaKey) {
    // No modifier required: neither may be pressed.
    return false
  }
  return true
}

/** Combo registry service exposed as `ctx.shortcuts`. */
export class ShortcutRegistry {
  /** Registered combos by normalized (lowercased) combo string. */
  private readonly bindings = new Map<string, Binding>()

  /**
   * Pause dispatch — e.g. while the settings page captures a new combo via its
   * own keydown listener, so an existing binding does not also fire.
   */
  paused = false

  /**
   * @param ctx - owning cordis context; the window listener lives on its fiber.
   */
  constructor(ctx: Context) {
    ctx.effect(() => {
      const onKeyDown = (event: KeyboardEvent): void => { this.handle(event) }
      window.addEventListener('keydown', onKeyDown, true)
      return () => { window.removeEventListener('keydown', onKeyDown, true) }
    })
  }

  /**
   * Bind a combo to a handler. The matched event is default-prevented and
   * stop-propagation'd before the handler runs.
   * @param combo - combo string (case-insensitive), e.g. `mod+k`.
   * @param handler - invoked on a match outside text fields (per options).
   * @param options - scope control; text fields release the event by default.
   * @returns the disposer removing this binding.
   * @throws when the combo is malformed or already bound.
   */
  register(combo: string, handler: () => void, options: ShortcutOptions = {}): () => void {
    const normalized = combo.toLowerCase()
    if (this.bindings.has(normalized)) {
      throw new Error(`shortcuts: combo "${combo}" is already bound`)
    }
    const binding: Binding = {
      combo: parseCombo(normalized),
      handler,
      allowInTextField: options.allowInTextField ?? false,
    }
    this.bindings.set(normalized, binding)
    return () => {
      if (this.bindings.get(normalized) === binding) this.bindings.delete(normalized)
    }
  }

  /** Dispatch one keydown event to the first matching binding. */
  private handle(event: KeyboardEvent): void {
    if (this.paused) return
    const binding = this.find(event)
    if (binding === undefined) return
    if (!binding.allowInTextField && isTypingTarget(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    try {
      binding.handler()
    } catch (error: unknown) {
      // A faulty handler must not take down the listener or later combos.
      console.error('[shortcuts] handler threw:', error)
    }
  }

  private find(event: KeyboardEvent): Binding | undefined {
    for (const binding of this.bindings.values()) {
      if (matchesCombo(binding.combo, event)) return binding
    }
    return undefined
  }
}
