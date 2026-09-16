/**
 * Headless smoke test for the desktop half — no Electron, no Hermes install.
 *
 * Copies `desktop/plugin.js` into a scratch tree beside stub modules for the
 * three specifiers a plugin may import (`@hermes/plugin-sdk`, `react`,
 * `react/jsx-runtime`), then loads it and drives `register(ctx)` with a fake
 * context. Proves the file parses as plain ESM, wires every contribution, and
 * that the composer middleware stages the mode (POST /mode) WITHOUT touching the
 * draft's text.
 *
 * Run:  node scripts/smoke_desktop_half.mjs
 */
import { mkdir, mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginSrc = path.join(here, '..', 'desktop', 'plugin.js')

const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}
const ok = (msg) => console.log(`ok: ${msg}`)

const root = await mkdtemp(path.join(tmpdir(), 'cm-smoke-'))

const sdkBody = `
export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directives'
export const atom = (initial) => {
  let value = initial
  const subs = new Set()
  return {
    get: () => value,
    set: (next) => { value = typeof next === 'function' ? next(value) : next; subs.forEach((f) => f(value)) },
    listen: (fn) => { subs.add(fn); return () => subs.delete(fn) }
  }
}
export const useValue = (a) => a.get()
export const cn = (...xs) => xs.filter(Boolean).join(' ')
export const haptic = () => {}
export const host = {
  state: { focusedSessionId: atom('sess-smoke'), activeSessionId: atom('sess-smoke') },
  request: async () => ({}),
  onEvent: () => () => {},
  notify: () => {},
  navigate: () => {},
  openWorkspace: () => {},
  paneVisibility: () => atom(false)
}
export const Button = 'button'
export const Codicon = 'span'
export const Streamdown = 'div'
export const Textarea = 'textarea'
export const Tip = 'div'
`

const reactBody = `
export const useEffect = () => {}
export const useLayoutEffect = () => {}
export const useRef = (v) => ({ current: v })
export const useState = (v) => [v, () => {}]
`
const jsxRuntimeBody = `
export const jsx = (t, p) => ({ t, p })
export const jsxs = (t, p) => ({ t, p })
export const Fragment = 'Fragment'
`

async function writeModule(name, files) {
  const dir = path.join(root, 'node_modules', ...name.split('/'))
  await mkdir(dir, { recursive: true })
  for (const [file, body] of Object.entries(files)) {
    await writeFile(path.join(dir, file), body)
  }
}

await writeModule('@hermes/plugin-sdk', {
  'package.json': JSON.stringify({ name: '@hermes/plugin-sdk', type: 'module', main: 'index.mjs' }),
  'index.mjs': sdkBody
})
// react is imported twice: 'react' and 'react/jsx-runtime' — that needs an exports map.
await writeModule('react', {
  'package.json': JSON.stringify({
    name: 'react',
    type: 'module',
    exports: { '.': './index.mjs', './jsx-runtime': './jsx-runtime.mjs' }
  }),
  'index.mjs': reactBody,
  'jsx-runtime.mjs': jsxRuntimeBody
})

const target = path.join(root, 'plugin.js')
await copyFile(pluginSrc, target)

let mod
try {
  mod = await import(pathToFileURL(target).href)
} catch (error) {
  fail(`the desktop half did not load: ${error && error.stack ? error.stack : error}`)
  process.exit(1)
}
ok('desktop/plugin.js loads as plain ESM')

const plugin = mod.default
if (!plugin || plugin.id !== 'composer-modes' || typeof plugin.register !== 'function') {
  fail(`default export is not a Hermes plugin (got ${JSON.stringify(Object.keys(mod))})`)
  process.exit(1)
}
ok(`default export: id=${plugin.id}`)

const contributions = []
const disposers = []
const stages = []
const ctx = {
  storage: {
    _v: new Map(),
    get(key, fallback) { return this._v.has(key) ? this._v.get(key) : fallback },
    set(key, value) { this._v.set(key, value) },
    remove(key) { this._v.delete(key) }
  },
  rest: async (url, opts) => { stages.push({ url, opts }); return { ok: true } },
  onDispose: (fn) => disposers.push(fn),
  i18n: { register: () => {} },
  register: (c) => { contributions.push(c); return () => {} },
  registerMany: (cs) => { contributions.push(...cs); return () => {} }
}

// `window` is only touched by the keydown listener; a minimal stub keeps it honest.
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} }
globalThis.document = { hasFocus: () => true, body: null, documentElement: null }

try {
  plugin.register(ctx)
} catch (error) {
  fail(`register(ctx) threw: ${error && error.stack ? error.stack : error}`)
  process.exit(1)
}
ok(`register(ctx) ran — ${contributions.length} contributions, ${disposers.length} disposers`)

const areas = contributions.map((c) => c.area).sort()
for (const expected of ['composer.actions', 'composer.middleware', 'transcript.directives']) {
  if (!areas.includes(expected)) fail(`no contribution for ${expected} (got ${areas.join(', ')})`)
}
const directives = contributions.filter((c) => c.area === 'transcript.directives').map((c) => c.data?.name).sort()
for (const name of ['debug-loop', 'plan-approve', 'plan-questions']) {
  if (!directives.includes(name)) fail(`missing transcript directive ${name} (got ${directives.join(', ')})`)
}
ok(`areas: ${areas.join(', ')}`)
ok(`directives: ${directives.join(', ')}`)

const middleware = contributions.find((c) => c.area === 'composer.middleware')
if (!middleware?.data?.handler) {
  fail('the composer middleware handler is not registered')
} else {
  const draft = { text: 'explain this function', attachments: [] }
  const out = await middleware.data.handler(draft)
  if (out !== draft) fail('the middleware must return the SAME draft object (never rewrite the text)')
  if (!stages.length) fail('the middleware did not stage the mode')
  else {
    const [stage] = stages
    if (stage.url !== '/mode') fail(`staged the wrong path: ${stage.url}`)
    if (stage.opts?.method !== 'POST') fail(`staged with the wrong method: ${stage.opts?.method}`)
    const body = stage.opts?.body || {}
    if (body.mode !== 'agent') fail(`staged the wrong mode: ${JSON.stringify(body)}`)
    if (body.session_id !== 'sess-smoke') fail(`staged the wrong session: ${JSON.stringify(body)}`)
    ok(`middleware staged ${JSON.stringify(body)} and returned the draft untouched`)
  }

  const slash = { text: '/plan ship it', attachments: [] }
  stages.length = 0
  await middleware.data.handler(slash)
  if (stages.length) fail('a slash command must not be staged')
  else ok('slash commands are not staged')

  stages.length = 0
  const originalRest = ctx.rest
  ctx.rest = async () => { throw new Error('backend down') }
  const out2 = await middleware.data.handler({ text: 'still fine', attachments: [] })
  ctx.rest = originalRest
  if (out2?.text !== 'still fine') fail('a failing backend must still let the send through unchanged')
  else ok('backend failure degrades to pass-through')
}

await rm(root, { recursive: true, force: true })
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED')
