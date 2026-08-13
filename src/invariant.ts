/**
 * Package-owned invariant companion for `@blue-a11y/dsh-client-shortcuts`.
 * @module @blue-a11y/dsh-client-shortcuts/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@blue-a11y/dsh-client-shortcuts'

/** Cordis companion plugin name. */
export const name = 'client-shortcuts-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the shortcut registry emits no cordis events and
 * owns no cross-plugin mutable relation — registrations are fiber-scoped
 * disposers, and combo matching is asserted directly by this package's
 * behavior specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
