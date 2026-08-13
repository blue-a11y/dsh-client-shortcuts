/**
 * Standalone build for the shortcuts plugin: a node half (lib/index.js +
 * lib/invariant.js, ESM — the Host Loader imports these) and the browser
 * client bundle (lib/client.js, CJS wrapped for window.__ModuleLoader__).
 * Mirrors the dsh repo's clientBundle preset without its monorepo machinery.
 */
import { defineConfig } from 'tsdown'

const id = '@blue-a11y/dsh-client-shortcuts'

export default defineConfig([
  {
    name: id,
    entry: { index: 'lib/types/index.js', invariant: 'lib/types/invariant.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${id}/client`,
    // Build straight from src so co-located assets (settings.module.css) and
    // .tsx resolve; tsc only owns type emission + the node half.
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    // react + @deepseek-ai/* resolve from the shell module table at runtime;
    // never bundle them into the client bundle.
    external: ['react', 'react/jsx-runtime', 'react-dom', /^@deepseek-ai\//],
    dts: false,
    sourcemap: true,
    clean: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
