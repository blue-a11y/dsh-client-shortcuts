import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { apply as nodeApply } from '../src/index.ts'
import { apply as invariantApply, inject, name } from '../src/invariant.ts'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin({ name, inject, apply: invariantApply }).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })

  it('node-half apply tolerates a Host without any services', () => {
    nodeApply()
  })
})
