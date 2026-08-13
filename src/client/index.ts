/**
 * Global shortcuts plugin, browser half. Provides the `ctx.shortcuts` registry
 * service, registers the default action bindings, and mounts the "快捷键"
 * settings page (built from host UI primitives) where every binding can be
 * re-bound by the user.
 */
import type { Context } from '@deepseek-ai/cordis'
import { ShortcutRegistry } from './registry.ts'
import { createActions, ShortcutBindings } from './actions.tsx'
import { mountShortcutsSettings } from './settings.tsx'

declare module '@deepseek-ai/cordis' {
  interface Context {
    shortcuts: ShortcutRegistry
  }
}

/**
 * Mount the registry, bind the default actions, and mount the settings page.
 * @param ctx - client cordis context.
 */
export function apply(ctx: Context): void {
  const shortcuts = new ShortcutRegistry(ctx)
  ctx.provide('shortcuts', shortcuts)
  const bindings = new ShortcutBindings(shortcuts, createActions(ctx))
  mountShortcutsSettings(ctx, shortcuts, bindings)
}
