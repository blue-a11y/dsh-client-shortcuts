import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    // apply() now imports the settings page, which pulls the host UI primitives
    // (and their transitive katex.min.css). Inline that package so vitest's
    // pipeline — not Node's loader — resolves it (CSS imports become no-ops).
    server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } },
  },
})
