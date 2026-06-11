#!/usr/bin/env node
import { mkdir } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outdir = path.join(root, 'dist')
const minify = process.argv.includes('--minify')
const watch = process.argv.includes('--watch')

const srcAliasPlugin = {
  name: 'src-alias',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.resolveDir.includes(`${path.sep}node_modules${path.sep}`)) return
      if (!args.path.startsWith('src/') && !args.path.startsWith('.')) return

      const basePath = args.path.startsWith('src/')
        ? path.join(root, args.path.slice(4))
        : path.resolve(args.resolveDir, args.path)

      const resolved = resolveSourcePath(basePath)
      return resolved
        ? { path: resolved }
        : {
            path: args.path,
            namespace: 'missing-local',
            pluginData: { request: args.path },
          }
    })

    build.onLoad({ filter: /.*/, namespace: 'missing-local' }, args => {
      const request = args.pluginData?.request ?? args.path
      if (String(request).endsWith('.md')) {
        return { loader: 'js', contents: 'export default ""' }
      }
      return {
        loader: 'js',
        contents: `
const noop = new Proxy(function () {}, {
  get: () => noop,
  apply: () => undefined,
  construct: () => ({})
})
module.exports = new Proxy({}, {
  get: (_target, prop) => prop === '__esModule' ? true : noop
})
`,
      }
    })
  },
}

function resolveSourcePath(candidate) {
  const candidates = [candidate]
  if (candidate.endsWith('.js')) {
    candidates.push(
      candidate.slice(0, -3) + '.ts',
      candidate.slice(0, -3) + '.tsx',
    )
  }
  if (!path.extname(candidate)) {
    candidates.push(
      candidate + '.ts',
      candidate + '.tsx',
      candidate + '.js',
      path.join(candidate, 'index.ts'),
      path.join(candidate, 'index.tsx'),
      path.join(candidate, 'index.js'),
    )
  }
  return candidates.find(file => existsSync(file) && statSync(file).isFile())
}

const bunBundleShimPlugin = {
  name: 'bun-bundle-shim',
  setup(build) {
    build.onResolve({ filter: /^bun:bundle$/ }, () => ({
      path: 'bun:bundle',
      namespace: 'bun-bundle-shim',
    }))
    build.onLoad({ filter: /.*/, namespace: 'bun-bundle-shim' }, () => ({
      loader: 'js',
      contents: 'export function feature() { return false }',
    }))
  },
}

const nativeShimPlugin = {
  name: 'native-shims',
  setup(build) {
    build.onResolve({ filter: /^color-diff-napi$/ }, () => ({
      path: path.join(root, 'native-ts/color-diff/index.ts'),
    }))
    build.onResolve(
      {
        filter:
          /^(?:@ant\/|@anthropic-ai\/(?:bedrock-sdk|foundry-sdk|vertex-sdk|mcpb|sandbox-runtime)$|audio-capture-napi$|modifiers-napi$|sharp$)/,
      },
      args => ({
        path: args.path,
        namespace:
          args.path === '@anthropic-ai/sandbox-runtime'
            ? 'sandbox-runtime-shim'
            : args.path === '@ant/claude-for-chrome-mcp'
              ? 'chrome-mcp-shim'
            : 'missing-package',
      }),
    )
    build.onLoad({ filter: /.*/, namespace: 'sandbox-runtime-shim' }, () => ({
      loader: 'js',
      contents: `
export class SandboxViolationStore {
  getRecentViolations() { return [] }
  getViolationCount() { return 0 }
  getTotalCount() { return 0 }
  subscribe(_cb) { return () => {} }
  clear() {}
}

const emptyStore = new SandboxViolationStore()

export const SandboxRuntimeConfigSchema = {
  parse(value) { return value },
  safeParse(value) { return { success: true, data: value } },
}

export const SandboxManager = {
  checkDependencies() { return { errors: [], warnings: [] } },
  isSupportedPlatform() { return false },
  async initialize() {},
  updateConfig() {},
  async reset() {},
  getFsReadConfig() { return { allowed: [], denied: [] } },
  getFsWriteConfig() { return { allowOnly: [], denyWithinAllow: [] } },
  getNetworkRestrictionConfig() { return { allowed: [], denied: [] } },
  getIgnoreViolations() { return undefined },
  getAllowUnixSockets() { return undefined },
  getAllowLocalBinding() { return undefined },
  getEnableWeakerNestedSandbox() { return undefined },
  getProxyPort() { return undefined },
  getSocksProxyPort() { return undefined },
  getLinuxHttpSocketPath() { return undefined },
  getLinuxSocksSocketPath() { return undefined },
  async waitForNetworkInitialization() { return false },
  getSandboxViolationStore() { return emptyStore },
  annotateStderrWithSandboxFailures(_command, stderr) { return stderr },
  cleanupAfterCommand() {},
  async wrapWithSandbox(command) { return command },
}
`,
    }))
    build.onLoad({ filter: /.*/, namespace: 'chrome-mcp-shim' }, () => ({
      loader: 'js',
      contents: `
export const BROWSER_TOOLS = []
export function createClaudeForChromeMcpServer() {
  return { async connect() {} }
}
export default { BROWSER_TOOLS, createClaudeForChromeMcpServer }
`,
    }))
    build.onLoad({ filter: /.*/, namespace: 'missing-package' }, () => ({
      loader: 'js',
      contents: `
const noop = new Proxy(function () {}, {
  get: () => noop,
  apply: () => undefined,
  construct: () => ({})
})
module.exports = new Proxy({}, {
  get: (_target, prop) => prop === '__esModule' ? true : noop
})
`,
    }))
  },
}

await mkdir(outdir, { recursive: true })

// Ensure dist is treated as ESM by bun/node
import { writeFile as writeFileSync } from 'node:fs/promises'
await writeFileSync(path.join(outdir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n')

const options = {
  entryPoints: [path.join(root, 'entrypoints/cli.tsx')],
  outfile: path.join(outdir, 'claude.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  jsx: 'automatic',
  minify,
  sourcemap: false,
  banner: {
    js: `#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
const MACRO = {
  VERSION: "1.0.0",
  BUILD_TIME: ${JSON.stringify(new Date().toISOString())},
  PACKAGE_URL: "@anthropic-ai/claude-code",
  NATIVE_PACKAGE_URL: "@anthropic-ai/claude-code-native",
  FEEDBACK_CHANNEL: "https://github.com/anthropics/claude-code/issues",
  ISSUES_EXPLAINER: "file an issue at https://github.com/anthropics/claude-code/issues",
  VERSION_CHANGELOG: ""
};`,
  },
  define: {
    'MACRO.VERSION': JSON.stringify('1.0.0'),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  external: [
    'node-pty',
    'fsevents',
    'wreq-js',
    '@aws-sdk/*',
    '@smithy/*',
    '@azure/identity',
    'google-auth-library',
  ],
  loader: {
    '.md': 'text',
  },
  plugins: [bunBundleShimPlugin, nativeShimPlugin, srcAliasPlugin],
  logLevel: 'info',
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('watching...')
} else {
  await esbuild.build(options)

  // Strip absolute paths from the output to avoid leaking personal info
  const { readFile, writeFile } = await import('node:fs/promises')
  const outfile = path.join(outdir, 'claude.js')
  let code = await readFile(outfile, 'utf8')

  // Replace any absolute path pointing to the project root with ./
  const rootEscaped = root.replace(/[/\\]+/g, '[/\\\\]+')
  code = code.replace(new RegExp(rootEscaped + '[/\\\\]?', 'g'), './')
  // Also catch Windows-style paths with backslashes in strings
  const rootWin = root.replace(/\//g, '\\\\')
  const rootWinEscaped = rootWin.replace(/[\\]/g, '\\\\')
  code = code.replace(new RegExp(rootWinEscaped + '\\\\?', 'g'), './')

  // Fix bun's CJS detection: bun scans for bare `module` and `exports` tokens
  // and treats the file as CJS regardless of .mjs or package.json type.
  // These come from lodash/UMD environment detection which is dead code in ESM.
  // Replace `typeof exports == "object"` with `typeof undefined == "object"` (always false)
  // and `typeof module == "object"` with `typeof undefined == "object"` (always false)
  code = code.replace(/typeof exports == "object"/g, 'typeof undefined == "object"')
  code = code.replace(/typeof exports === "object"/g, 'typeof undefined === "object"')
  code = code.replace(/typeof module == "object"/g, 'typeof undefined == "object"')
  code = code.replace(/typeof module !== "undefined"/g, 'typeof undefined !== "undefined"')
  code = code.replace(/typeof module2 !== "undefined"/g, 'typeof undefined !== "undefined"')
  // esbuild's __commonJS helper: rewrite to avoid bare `exports` token
  code = code.replace(
    /\(mod = \{ exports: \{\} \}\)\.exports, mod\), mod\.exports/g,
    '(mod = { ["ex"+"ports"]: {} })["ex"+"ports"], mod), mod["ex"+"ports"]'
  )
  // Also handle `module2.exports = factory2()` UMD patterns
  code = code.replace(/typeof exports2 === "object"/g, 'typeof undefined === "object"')

  await writeFile(outfile, code)
  console.log('Stripped absolute paths and fixed bun ESM detection.')

  // Compile to executables using bun --compile (cross-compilation)
  // Copy to a neutral path first so bun doesn't embed the user's home dir as __filename
  const { execSync } = await import('node:child_process')
  const tmpDir = path.join(import.meta.dirname, '.tmp')
  await mkdir(tmpDir, { recursive: true })
  const tmpFile = path.join(tmpDir, 'claude.js')
  await writeFile(tmpFile, code)

  // wreq-js is intentionally NOT external here: bun embeds its .node addon into
  // the standalone exe. (It stays external for esbuild, which can't load .node.)
  const externals = [
    '--external', '@aws-sdk/*',
    '--external', '@smithy/*',
    '--external', '@azure/identity',
    '--external', 'google-auth-library',
    '--external', 'node-pty',
    '--external', 'fsevents',
  ].join(' ')

  // wreq-js loads its native .node addon through an aliased `nativeRequire`
  // (const nativeRequire = require). Bun's --compile embedder only traces
  // *literal* require("...node") calls, so the alias hides the addon and the
  // standalone binary fails with "Cannot find package 'wreq-js'" at runtime.
  //
  // The loader has one branch per platform, each requiring a different
  // ../rust/*.node. If we de-aliased them all, every target would embed all 7
  // addons (~56MB of dead weight). Instead we rewrite the loader per target:
  // de-alias ONLY the current target's .node (so bun embeds just it) and keep
  // the other branches aliased (so bun skips them). The map ties each bun
  // --compile target to the addon it should embed.
  const wreqLoader = path.join(root, 'node_modules/wreq-js/dist/wreq-js.cjs')
  const { readFile: rf, writeFile: wf } = await import('node:fs/promises')
  const targetNodeFile = {
    'bun-windows-x64': 'wreq-js.win32-x64-msvc.node',
    'bun-linux-x64': 'wreq-js.linux-x64-gnu.node',
    'bun-linux-arm64': 'wreq-js.linux-arm64-gnu.node',
    'bun-darwin-x64': 'wreq-js.darwin-x64.node',
    'bun-darwin-arm64': 'wreq-js.darwin-arm64.node',
  }
  // Rewrite the loader so only `fileToEmbed` is a literal require(); every other
  // ../rust/*.node stays on the nativeRequire alias. Deterministic regardless of
  // the loader's current state (normalizes all addon requires to the alias first).
  async function setEmbeddedAddon(fileToEmbed) {
    if (!existsSync(wreqLoader)) return
    let src = await rf(wreqLoader, 'utf8')
    // Collapse any de-aliased addon require back to alias, then promote all to
    // alias — net effect: every ../rust/*.node require uses nativeRequire.
    src = src.replace(/\bnativeRequire\("\.\.\/rust\//g, 'require("../rust/')
    src = src.replace(/\brequire\("\.\.\/rust\//g, 'nativeRequire("../rust/')
    // De-alias only the target's addon so bun embeds exactly that one.
    src = src.replace(
      `nativeRequire("../rust/${fileToEmbed}")`,
      `require("../rust/${fileToEmbed}")`,
    )
    await wf(wreqLoader, src)
  }

  const targets = [
    { target: 'bun-windows-x64', outfile: 'claude.exe' },
    { target: 'bun-linux-x64', outfile: 'claude-linux-x64' },
    { target: 'bun-linux-arm64', outfile: 'claude-linux-arm64' },
    { target: 'bun-darwin-x64', outfile: 'claude-darwin-x64' },
    { target: 'bun-darwin-arm64', outfile: 'claude-darwin-arm64' },
  ]
  for (const { target, outfile: out } of targets) {
    const addon = targetNodeFile[target]
    if (addon) {
      await setEmbeddedAddon(addon)
      console.log(`Embedding wreq-js addon ${addon} for ${target}`)
    }
    const dest = path.join(outdir, out)
    execSync(`bun build ${tmpFile} --compile --target=${target} --outfile ${dest} ${externals}`, { stdio: 'inherit' })
    console.log(`Compiled ${out}`)
  }
  // Leave the loader fully aliased (its shipped form) so dev runs and reinstalls
  // see the original; the per-target rewrite above is self-correcting anyway.
  if (existsSync(wreqLoader)) {
    let src = await rf(wreqLoader, 'utf8')
    src = src.replace(/\bnativeRequire\("\.\.\/rust\//g, 'require("../rust/')
    src = src.replace(/\brequire\("\.\.\/rust\//g, 'nativeRequire("../rust/')
    await wf(wreqLoader, src)
  }
  const { unlink } = await import('node:fs/promises')
  await unlink(tmpFile)
}
