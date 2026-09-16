/**
 * composer-modes — Cursor-style mode selector for the Hermes composer. v12.3.
 *
 * Botón único de modos en la tira del composer (ask/agent/plan/debug). Un ComposerMiddleware
 * adjunta el FRAME del modo al draft (v12.0: `mode` + `note` como DATO, sin RPC): el shell manda
 * `note` en prompt.submit y el core la fusiona SOLO en los bytes al modelo (api_content) — la
 * burbuja muestra solo lo tipeado. La cola CONGELA el frame por entrada al encolar; los drenes
 * pasan `fromQueue` y el middleware no re-deriva jamás.
 *   ask   → solo lectura (nota)      agent → sin nota (mode sella igual)
 *   plan  → reglas + directiva `::plan-approve{file="..."}` (nota)
 *   debug → debugging sistemático en 3 fases (nota)
 *
 * La tarjeta PlanApproveCard (directiva ::plan-approve) da 3 salidas:
 *   a. Implementar ahora → prompt.submit con el path del plan
 *   b. Modificar → editor inline (campo vacío) → prompt.submit con cambios
 *   c. Seguir en el prompt → el usuario escribe en la caja (modo ya reseteado)
 *
 * Endurecido v5 (consejo CMPA-2026-09-10-V5B, consenso 100/100/100):
 *   - estado (open/draft) espejado en ctx.storage `planDialogsV5` + rehidratado
 *     en cada evaluación del módulo → sobrevive hot-reload y recargas.
 *     `sending` JAMÁS se rehidrata (transitorio; un flag viejo bloquearía todo).
 *   - sondas console.error('[cm-pa] …') — único nivel que desktop.log captura.
 *   - marcador visible `v5·<bootId>` en tarjeta + pills.
 *   - ctx.onDispose para listener, flush y debounce.
 *
 * v6: bucle de debug (tarjeta ::debug-loop → botones Mark as fixed / still not working).
 * v7 (consejo MODEK-2026-09-10-V7B): Shift+Tab cicla los modos — listener en window
 *   con capture, scope composer/transcript (+body); skips en terminal y overlays con rol;
 *   no rebindable en v1 (el gate actionAllowedInInput bloquea combos shift-only en editables).
 * v8 (consejo MODIC-2026-09-10-V10B): íconos codicon en los pills — comment-discussion (ask),
 *   hubot (agent), checklist (plan), debug-alt (debug) — Codicon del SDK a 0.75rem + shrink-0.
 * v9 (consejo MODOR-2026-09-10-V9B): burbujas limpias — el texto del usuario va PRIMERO; la nota
 *   del modo al final con 3 líneas vacías (bajo el pliegue de 4 líneas + fade del clamp). plan ya
 *   no usa el builtin /plan: payload propio con réplica verbatim de las reglas (re-sync con
 *   agent/plan_prompt.py). Guardas: slash explícito gana; idempotencia por sufijo exacto.
 *   LÍMITE conocido: mientras el agente trabaja, el Enter simple del composer va por el steer del
 *   desktop (session.redirect), que NO pasa por el middleware → ese envío sale sin framing.
 *   Ctrl/Cmd+Enter (cola) sí conserva el modo al drenar. Cada wrap emite sonda `mw ...`.
 *   SUPERADO por v11.0: la nota ya no vive en el texto — viaja oculta por `session.note.stage`.
 * v10 (consejo MODEB-2026-09-11-V10): botón único de modo en el composer — muestra el modo actual
 *   (ícono + label + chevron) y cicla con clic usando el mismo cycleMode que Shift+Tab. Sesión
 *   nueva arranca en Agent (reset ante cambio de sesión; el nacimiento desde borrador null a id
 *   NO resetea, y el modo elegido en un borrador sobrevive al primer envío).
 * v10.1: color por modo en el botón — ask verde, agent gris (control activo), plan naranja,
 *   debug rojo — tokens --ui-green / --ui-red / --ui-orange + --ui-control-active-background.
 * v10.2: colores por style inline (var CSS) — Tailwind solo compila clases presentes en el fuente
 *   de la app: bg-(--ui-red)/bg-(--ui-orange) del plugin no generaban regla (botón transparente).
 * v10.3 (ronda debug 2026-09-11): plan y debug 20% más oscuros (color-mix 80/20 con negro) para
 *   diferenciarse mejor y dar contraste al texto; sonda temporal `modebtn ... bg=...` (se retira
 *   con el turno de limpieza del bucle de debug).
 * v10.4: plan vuelve a azul (var(--ui-accent), como antes de los colores por modo); sonda de
 *   diagnóstico retirada (cierre del bucle de debug sin 'Mark as fixed').
 * v10.5: marcas persistentes de los botones de tarjeta (plan: Implementar/Modificar; debug:
 *   retry/fixed) espejadas en ctx.storage. Límites: locales a la máquina; sin unmark/undo;
 *   marca transitoria best-effort — un click durante el turno vivo (id efímero
 *   assistant-stream-…) no sobrevive la re-hidratación (los planes quedan a salvo por el
 *   alias f:); el alias f: comparte la marca entre todas las tarjetas del mismo plan;
 *   colisión teórica de la clave ts|rol (los timestamps en µs la hacen casi imposible);
 *   keys huérfanas inertes tras borrar sesiones; storage.clear() ignorado (evento key null).
 * v10.6: botón 'Leer plan' (4º) en la tarjeta de plan — panel lector dockeado a la derecha
 *   (host.openWorkspace id 'composer-modes:plan-reader', markdown con Streamdown, lectura local vía
 *   window.hermesDesktop.readFileText; sondas planview *). Límites: lee la máquina local
 *   (en remoto degrada con error visible); fallback a submit oculto (display_kind hidden)
 *   disparando desktop_preview si falta el seam o no hay cwd.
 * v10.7: respiro visual (mt-3 ≈ un salto de línea) entre el último texto del mensaje y las
 *   tarjetas de plan y debug — nada encimado (pedido del usuario).
 * v10.8: toggle del lector en el botón de la tarjeta — 'Leer plan' abre / 'Cerrar plan' cierra el panel
 *   (host.paneVisibility del pane 'plugin-workspace:composer-modes:plan-reader' Y archivo de la tarjeta;
 *   self-healing en X/⌘W/reload; Cerrar nunca se bloquea por envío; sin persistencia). Id del pane
 *   renombrado a namespaced 'composer-modes:plan-reader' (convención <pluginId>:<paneId>).
 * v10.9: tick del check DENTRO del botón (primer hijo, patrón del ícono del read) y marca 'edit' (Modificar)
 *   recién al presionar 'Enviar cambios' (probe -> fresh -> applyMark -> sendTurn; rollback solo si la marca era
 *   nueva); purga one-time de las marcas ':plan:edit' falsas que dejó v10.8 (flag marksPurgeV9).
 * v10.10: dialog de preguntas del modo plan — ante ambigüedad MATERIAL el agente escribe
 *   .hermes/plans/<ts>-<slug>-questions.json y emite ::plan-questions{file="..."} como único párrafo;
 *   card stepper ('Preguntas sobre el plan — i/n', una por pantalla, opción libre SIEMPRE, Atrás/Siguiente,
 *   envío único con las respuestas + instrucción de continuar); auto-reset propio con toast correcto.
 * v10.11: 3 fixes UX del stepper (pedido del usuario) — auto-avance al click de opción con beat de 200 ms
 *   (la selección se pinta antes de avanzar) + guard anti-doble-click de 300 ms (swallow silencioso, sin
 *   disabled); filas verticales full-width livianas (variant ghost, numeradas 'N. texto' mismo color,
 *   'Otra respuesta…' = n+1) con selección resaltada (clases + style inline por la lección v10.2);
 *   haptic('selection') en picks aceptados (best-effort). Cancelación del beat en Atrás/Siguiente/Otra/
 *   unmount. Límites v1: focus post-avance y aria-live = v1.1; válvula a 450 ms si aparecen saltos.
 * v11.0 (consejo HIDE-2026-09-11-V17, CONSENSO_100): ocultamiento REAL de las notas — el
 *   middleware ya no appendea texto: la nota viaja con `session.note.stage` (one-shot, TTL 30 s)
 *   y el core la fusiona SOLO en api_content (burbuja = texto exacto del usuario; historial,
 *   copy y editor limpios; el clamp CSS deja de ser el mecanismo). Límites v1: steer (Enter con
 *   agente ocupado) pierde la nota — usar Ctrl/Cmd+Enter (cola); primer envío de un chat nuevo
 *   sin sessionId → nota skipped (probe); backend viejo ignora el stage (probe err, modo inerte);
 *   el param nativo draft.note (sin RPC) queda para la etapa B con rebuild de la app.
 * v12.0 (consejo QUEUEFREEZE-2026-09-11-V18, CONSENSO_100): el modo se CONGELA por mensaje
 *   encolado — el middleware adjunta `mode` (+ `note`) al draft como dato; el shell lo reenvía
 *   como `note` de prompt.submit; la cola captura el frame en la ENTRADA (chain corrido una vez
 *   en queueCurrentDraft) y los drenes (foreground, fondo, send-now) pasan `fromQueue` + la nota
 *   congelada sin re-derivar. El stage RPC se RETIRA del plugin (el core lo mantiene para
 *   ventanas viejas; min-build: shell con `draft.note`). Límites v1: todo steer/redirect sin nota
 *   (Enter-while-busy directo, fallback y steer-now) — paridad v11, follow-up 'session.redirect
 *   note'; entradas pre-v12 sin frame drenan sin nota; chip de modo en la fila de cola (label
 *   neutro, sin glifos).
 * v12.2 (consejo REPO-2026-09-11-V1): "estaciona siempre" — vuelve el stage best-effort del v11
 *   (`session.note.stage`, try/catch, sin sonda nueva) EN PARALELO al `note` del draft. Un solo
 *   plugin cubre: app nueva + core parcheado (draft.note gana; la estacionada se popea); app stock
 *   + core parcheado (solo el stage entrega); app stock sin parche (nada viaja, degradación
 *   silenciosa). El stage dispara SOLO en la derivación fresca (jamás en drains `fromQueue`),
 *   ANTES del return de la cadena, y usa el sid de v11 (focused → active).
 *
 * v13 (paquete completo, sin parches): el backend es la ÚNICA fuente de las notas. El
 *   middleware sólo AVISA el modo (`ctx.rest('/mode', {method:'POST'})`, esperado antes de
 *   devolver el draft) y el agent-half lo convierte en la nota del turno por `pre_llm_call`
 *   → api_content. Desaparecen `draft.note` y `session.note.stage`: nada depende de un core
 *   parcheado ni de un renderer reconstruido. El texto tipeado JAMÁS se toca; `ask` además se
 *   refuerza del lado de las herramientas (`pre_tool_call` → solo lectura real).
 *
 * Reload: ⌘K → "Reload desktop plugins" (fs-watch solo llega a la ventana
 *   principal; una ventana secundaria necesita reload manual o reapertura).
 */

import {
  atom,
  Button,
  cn,
  Codicon,
  haptic,
  host,
  Streamdown,
  Textarea,
  Tip,
  TRANSCRIPT_DIRECTIVE_AREA,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useLayoutEffect, useRef } from 'react'

const ID = 'composer-modes'
const VER = 'v13.0'
const BOOT = Date.now().toString(36).slice(-4)

/** Sonda → desktop.log vía console.error (único nivel capturado). */
/**
 * v13: el backend necesita saber el modo ANTES de admitir el turno. `ctx.rest` está scopeado a
 * `/api/plugins/composer-modes` — nunca sale de este plugin. Best-effort: si el backend está
 * apagado (agent half deshabilitado, backend remoto), el envío sigue y el modo queda cosmético.
 */
async function stageMode(ctx, mode, sidOverride) {
  if (typeof ctx.rest !== 'function') {
    probe('stage skip (no ctx.rest) mode=' + mode)
    return false
  }
  const sid = sidOverride || host.state.focusedSessionId.get() || host.state.activeSessionId.get() || null
  if (!sid) {
    probe('stage skip (no session) mode=' + mode)
    return false
  }
  try {
    await ctx.rest('/mode', { method: 'POST', body: { session_id: sid, mode } })
    probe('stage ok mode=' + mode + ' sid=' + String(sid))
    return true
  } catch (e) {
    probe('stage FAIL mode=' + mode + ' sid=' + String(sid) + ' err=' + String((e && e.message) || e))
    return false
  }
}

/** Único dueño del cambio de modo: átomo + espejo en storage + aviso al backend. */
function applyMode(ctx, mode, sidOverride) {
  activeMode.set(mode)
  void ctx.storage.set('mode', mode)
  void stageMode(ctx, mode, sidOverride)
}

function probe(msg) {
  try {
    console.error(`[cm-pa] ${msg}`)
  } catch (_) {
    /* una sonda nunca debe romper */
  }
}

const MODES = [
  { id: 'ask', label: 'Ask', icon: 'comment-discussion', hint: 'Answer only — never edit files or run mutations' },
  { id: 'agent', label: 'Agent', icon: 'hubot', hint: 'Full agentic mode (default)' },
  { id: 'plan', label: 'Plan', icon: 'checklist', hint: 'Write a plan only — no execution (/plan)' },
  { id: 'debug', label: 'Debug', icon: 'debug-alt', hint: 'Systematic debugging: evidence first, then fix' }
]

/** Fondo del botón por modo — valores CSS directos (style inline): las clases Tailwind con var()
 *  solo existen si el fuente de la app las usa; inline no depende del compile. */
const MODE_BG = {
  ask: 'var(--ui-green)',
  agent: 'var(--ui-control-active-background)',
  // debug 20% más oscuro (contraste con el texto); plan vuelve al azul del acento.
  plan: 'var(--ui-accent)',
  debug: 'color-mix(in srgb, var(--ui-red) 80%, #000)'
}

/** Solo se aceptan archivos guardados por /plan. Output del modelo = no confiable. */
const PLAN_FILE_RE = /^\.hermes\/plans\/[A-Za-z0-9._-]+\.md$/

/** Ronda del bucle de debug (attr no confiable: solo dígitos). */
const ROUND_RE = /^[0-9]{1,3}$/

const EMPTY_DIALOG = { open: false, draft: '', sending: null }

/** Clave del espejo en storage (v5). */
const DKEY = 'planDialogsV5'

/**
 * Estado del panel por archivo. Atom module-level para reactividad; espejado a
 * ctx.storage para sobrevivir re-evaluación del módulo y recargas.
 */
const planDialogs = atom({})
let ctxRef = null
let saveTimer = null

// ── Lector de plan (v10.6) — panel dockeado a la derecha (host.openWorkspace) ──
const planReaderFile = atom(null)
const planReaderView = atom({ status: 'idle' })
let planReaderDispose = null

// ── Preguntas del plan (v10.10) — espejo del stepper (estado por archivo) ──
const PLANQ_KEY = 'planQStateV1'
const EMPTY_Q = { status: 'idle', questions: null, answers: {}, index: 0, sending: null }
const planQState = atom({})
let saveQTimer = null

function getQEntry(file) {
  const all = planQState.get()
  return all[file] || EMPTY_Q
}

/** Forma persistible: `sending` es transitorio y NUNCA se persiste. */
function snapshotQ() {
  const out = {}
  for (const [k, v] of Object.entries(planQState.get())) {
    out[k] = {
      status: typeof v.status === 'string' ? v.status : 'idle',
      questions: Array.isArray(v.questions) ? v.questions : null,
      answers: v.answers && typeof v.answers === 'object' ? v.answers : {},
      index: Number.isInteger(v.index) ? v.index : 0
    }
  }
  return out
}

function flushQ() {
  try {
    if (ctxRef) ctxRef.storage.set(PLANQ_KEY, snapshotQ())
  } catch (_) {
    /* storage best-effort */
  }
}

function setQEntry(file, patch) {
  const next = { ...planQState.get(), [file]: { ...getQEntry(file), ...patch } }
  planQState.set(next)
  clearTimeout(saveQTimer)
  saveQTimer = setTimeout(flushQ, 300)
}

function hydrateQ(ctx) {
  try {
    const saved = ctx.storage.get(PLANQ_KEY, null)
    if (!saved || typeof saved !== 'object') return
    const clean = {}
    for (const [k, v] of Object.entries(saved)) {
      if (!v || typeof v !== 'object') continue
      clean[k] = {
        status: typeof v.status === 'string' ? v.status : 'idle',
        questions: Array.isArray(v.questions) ? v.questions : null,
        answers: v.answers && typeof v.answers === 'object' ? v.answers : {},
        index: Number.isInteger(v.index) ? v.index : 0,
        sending: null
      }
    }
    planQState.set(clean)
    probe(`pq hydrate keys=${Object.keys(clean).length}`)
  } catch (e) {
    probe(`pq hydrate err ${String(e)}`)
  }
}

// v10.8: ids del pane del lector + espejo para desktops sin host.paneVisibility.
const PLAN_READER_WS = 'composer-modes:plan-reader'
const PLAN_READER_PANE = 'plugin-workspace:' + PLAN_READER_WS
const planReaderOpen = atom(false)

function getDialogEntry(file) {
  const all = planDialogs.get()
  return all[file] || EMPTY_DIALOG
}

/** Forma persistible: `sending` es transitorio y NUNCA se persiste. */
function snapshotDialogs() {
  const out = {}
  for (const [k, v] of Object.entries(planDialogs.get())) {
    out[k] = { open: v.open === true, draft: typeof v.draft === 'string' ? v.draft : '' }
  }
  return out
}

function flushDialogs() {
  try {
    if (ctxRef) ctxRef.storage.set(DKEY, snapshotDialogs())
  } catch (_) {
    /* storage best-effort */
  }
}

function setDialogEntry(file, patch) {
  const next = { ...planDialogs.get(), [file]: { ...getDialogEntry(file), ...patch } }
  planDialogs.set(next)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushDialogs, 300)
}

/**
 * Rehidrata el espejo. Corre en cada evaluación del módulo (el hot reload
 * re-registra). `sending` se fuerza null: un envío no sobrevive al reload y un
 * flag viejo dejaría todos los botones deshabilitados sin salida.
 */
function hydrateDialogs(ctx) {
  try {
    const saved = ctx.storage.get(DKEY, null)
    if (!saved || typeof saved !== 'object') return
    const clean = {}
    for (const [k, v] of Object.entries(saved)) {
      if (!v || typeof v !== 'object') continue
      clean[k] = {
        open: v.open === true,
        draft: typeof v.draft === 'string' ? v.draft : '',
        sending: null
      }
    }
    planDialogs.set(clean)
    probe(`hydrate keys=${Object.keys(clean).length} boot=${BOOT}`)
  } catch (e) {
    probe(`hydrate err ${String(e)}`)
  }
}

// ── Marcas persistentes de botones (v10.5) ──
const MARKS_KEY = 'marksV1'
const MID_RE = /^(\d+(?:\.\d+)?)-\d+-(user|assistant|system)$/
const marksStamp = atom(0)

function bumpMarks() {
  marksStamp.set(marksStamp.get() + 1)
}

function stableMid(mid) {
  const m = MID_RE.exec(String(mid || ''))
  return m ? `${m[1]}|${m[2]}` : String(mid || '')
}

function markKeys(card, btn, mid, extra) {
  const keys = []
  const stable = stableMid(mid)
  if (stable) keys.push(`m:${stable}:${card}:${btn}`)
  if (extra) keys.push(`f:${extra}:${card}:${btn}`)
  return keys
}

function readMarks() {
  try {
    const saved = ctxRef ? ctxRef.storage.get(MARKS_KEY, null) : null
    return saved && typeof saved === 'object' ? saved : {}
  } catch (_) {
    return {}
  }
}

function isMarked(card, btn, mid, extra) {
  const m = readMarks()
  return markKeys(card, btn, mid, extra).some((k) => m[k] === 1)
}

function writeMark(card, btn, mid, extra, on) {
  const keys = markKeys(card, btn, mid, extra)
  if (!keys.length) return false
  const m = readMarks()
  for (const k of keys) {
    if (on) m[k] = 1
    else delete m[k]
  }
  try {
    if (ctxRef) ctxRef.storage.set(MARKS_KEY, m)
  } catch (_) {}
  return true
}

function cardMessageId(el) {
  try {
    if (!el || typeof el.closest !== 'function') return null
    const root = el.closest('[data-message-id]')
    return root ? root.getAttribute('data-message-id') : null
  } catch (_) {
    return null
  }
}

function useCardMarks(card, btns, rootRef, getExtra) {
  const midRef = useRef(null)
  useValue(marksStamp)
  const marks = {}
  for (const b of btns) marks[b] = isMarked(card, b, midRef.current, getExtra())
  useLayoutEffect(() => {
    midRef.current = cardMessageId(rootRef.current)
    const hit = btns.filter((b) => isMarked(card, b, midRef.current, getExtra()))
    if (hit.length) probe(`markhit card=${card} btns=${hit.join(',')} mid=${stableMid(midRef.current)}`)
    bumpMarks()
  }, [])
  const applyMark = (btn, on) => {
    if (writeMark(card, btn, midRef.current, getExtra(), on)) {
      probe(`mark card=${card} btn=${btn} on=${on ? 1 : 0} mid=${stableMid(midRef.current)}`)
      bumpMarks()
    } else {
      probe(`mark skip card=${card} btn=${btn}`)
    }
  }
  return [marks, applyMark, midRef]
}

/** Shape de comando slash (paridad con SLASH_COMMAND_RE del desktop) — el slash explícito gana.
 *  Las NOTAS de cada modo viven en el agent-half (`modes.py`): acá no se escribe ni un carácter
 *  de instrucción para el modelo. */
const SLASH_SHAPE_RE = /^\/[^\s/]*(?:\s|$)/

const activeMode = atom('agent')

/** Envío en vuelo por ronda de debug — transitorio, NO se persiste. */
const debugSending = atom({})

function isValidPlanFile(file) {
  return typeof file === 'string' && PLAN_FILE_RE.test(file)
}

/** Solo se aceptan archivos de preguntas guardados por el agente (attr no confiable). */
const PLANQ_FILE_RE = /^\.hermes\/plans\/[A-Za-z0-9._-]+\.json$/

function isValidPlanQFile(file) {
  return typeof file === 'string' && PLANQ_FILE_RE.test(file)
}

function notifySafe(payload) {
  try {
    if (host && typeof host.notify === 'function') host.notify(payload)
  } catch (_) {
    /* un toast nunca debe romper el plugin */
  }
}

function submitTurn(text, displayKind) {
  const sid =
    host.state.focusedSessionId.get() || host.state.activeSessionId.get() || null
  if (!sid) {
    notifySafe({ kind: 'error', message: 'Sin sesión activa para enviar.' })
    return Promise.reject(new Error('no active session'))
  }
  return host.request('prompt.submit', {
    session_id: sid,
    text,
    ...(displayKind ? { display_kind: displayKind } : {})
  })
}

// ── Lector de plan v10.6: abre el .md en un panel dockeado a la derecha ──

function resolvePlanAbs(file) {
  if (typeof file !== 'string' || !file) return ''
  const isAbs = file.length > 1 && (file[1] === ':' || file[0] === '/')
  if (isAbs) return file
  const cwd = host.state.cwd.get() || ''
  if (!cwd) return ''
  return (cwd.endsWith('/') ? cwd : cwd + '/') + file
}

/** Validación leniente del JSON de preguntas (input del modelo = no confiable). */
function normalizeQuestions(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const list = parsed && Array.isArray(parsed.questions) ? parsed.questions : []
    const out = []
    for (const item of list) {
      if (!item || typeof item !== 'object' || typeof item.q !== 'string' || !item.q.trim()) continue
      const opts = []
      const rawOpts = Array.isArray(item.options) ? item.options : []
      for (const o of rawOpts) {
        const sv = typeof o === 'string' ? o : o && typeof o.label === 'string' ? o.label : ''
        const t = sv.replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
        if (t) opts.push(t)
        if (opts.length >= 5) break
      }
      out.push({ q: item.q.trim().slice(0, 400), options: opts })
      if (out.length >= 5) break
    }
    return out
  } catch (_) {
    return null
  }
}

/** Payload de respuestas (v10.10): respuestas del usuario primero, instrucción EN al final. */
function planQAnswersBody(file, questions, answersMap) {
  const lines = [`Respuestas a las preguntas del plan (${file}):`]
  questions.forEach((item, i) => {
    const a = answersMap[i]
    const shown = a === null || a === undefined || a === '' ? '(sin respuesta)' : String(a)
    lines.push(`${i + 1}) ${item.q}`)
    lines.push(`→ ${shown}`)
  })
  lines.push('')
  lines.push(
    'Continue in PLAN MODE: now write the plan following your plan-mode instructions, save it under .hermes/plans/ as markdown, and end your reply with ONLY the ::plan-approve directive. If an answer is missing, list it under open questions instead of guessing. You may delete the questions JSON file once the plan is saved.'
  )
  return lines.join('\n')
}

function planQContinueBody(file) {
  return [
    `No pude leer o responder tus preguntas (${file}).`,
    '',
    'Continue in PLAN MODE: write the plan now choosing sensible defaults, list the assumptions and open questions in the plan, and end your reply with ONLY the ::plan-approve directive.'
  ].join('\n')
}

/** Envío de respuestas: directo (sin middleware ni slice 450); techo duro 16K. */
function submitPlanAnswers(text, label) {
  const body = String(text || '')
  if (!body.trim()) return Promise.reject(new Error('empty answers'))
  if (body.length > 16000) {
    notifySafe({ kind: 'error', message: 'Las respuestas son demasiado largas para enviar.' })
    return Promise.reject(new Error('answers too long'))
  }
  probe(`pq send kind=${label} len=${body.length}`)
  return submitTurn(body)
}

function openPlanReader(file) {
  probe(`planview open file=${file}`)
  const abs = resolvePlanAbs(file)
  const canPane =
    typeof host.openWorkspace === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.hermesDesktop?.readFileText === 'function'
  if (!canPane || !abs) {
    probe(`planview fallback abs=${abs || '(sin cwd)'}`)
    const target = abs || file
    submitTurn(
      `Open ${target} in the preview pane: run desktop_preview with action "open" and url "${target}". ` +
        'Do not write any text in your reply — no confirmation, no explanation.',
      'hidden'
    )
    return
  }
  planReaderFile.set(file)
  planReaderView.set({ status: 'idle' })
  planReaderDispose = host.openWorkspace(PLAN_READER_WS, {
    title: `Plan — ${String(file).split('/').pop() || file}`,
    dock: { pane: 'workspace', pos: 'right' },
    minWidth: '22rem',
    onClose: () => {
      planReaderDispose = null
      planReaderFile.set(null)
      planReaderOpen.set(false)
      if (typeof host.paneVisibility !== 'function') probe('planview mirror close')
      probe('planview close')
    },
    render: () => jsx(PlanReaderPane, {})
  })
  planReaderOpen.set(true)
  if (typeof host.paneVisibility !== 'function') probe(`planview mirror open file=${file}`)
  probe('planview pane')
}

/** Toggle-close (v10.8): ejecuta SOLO el handle vivo — un disposer viejo removería el pane re-registrado. */
function closePlanReader() {
  const d = planReaderDispose
  if (typeof d !== 'function') {
    probe('planview close skip no-dispose')
    return
  }
  planReaderDispose = null
  try {
    d()
  } catch (e) {
    probe(`planview close err ${String((e && e.message) || e)}`)
  }
}

function PlanReaderPane() {
  const file = useValue(planReaderFile)
  const view = useValue(planReaderView)
  useEffect(() => {
    if (!file) return undefined
    const abs = resolvePlanAbs(file)
    if (!abs) {
      planReaderView.set({ status: 'err', msg: 'Sin workspace (cwd vacío): no puedo resolver el path.' })
      return undefined
    }
    const read = typeof window !== 'undefined' && window.hermesDesktop ? window.hermesDesktop.readFileText : null
    if (typeof read !== 'function') {
      planReaderView.set({ status: 'err', msg: 'readFileText no disponible en este shell.' })
      return undefined
    }
    let alive = true
    planReaderView.set({ status: 'loading' })
    Promise.resolve(read(abs))
      .then((r) => {
        if (!alive) return
        if (r && r.binary) {
          planReaderView.set({ status: 'err', msg: 'El archivo es binario: no se puede mostrar.' })
          probe(`planview err file=${file} binary`)
          return
        }
        const text = String((r && r.text) || '')
        planReaderView.set({ status: 'ok', text, truncated: !!(r && r.truncated) })
        probe(`planview ok file=${file} len=${text.length}`)
      })
      .catch((e) => {
        if (!alive) return
        planReaderView.set({ status: 'err', msg: String((e && e.message) || e) })
        probe(`planview err file=${file} msg=${String((e && e.message) || e)}`)
      })
    return () => {
      alive = false
    }
  }, [file])

  const wrap = (children) =>
    jsx('div', {
      className: 'h-full min-h-0 overflow-auto p-2.5 text-(--ui-text-secondary)',
      children
    })
  if (!file) return wrap('Sin plan seleccionado.')
  if (view.status === 'loading') return wrap('Leyendo el plan…')
  if (view.status === 'err') return wrap(view.msg || 'No se pudo leer el plan.')
  const body =
    typeof Streamdown === 'function'
      ? jsx(Streamdown, { mode: 'static', children: view.text || '' })
      : jsx('pre', {
          className:
            'whitespace-pre-wrap break-words font-mono text-[0.66rem] leading-relaxed',
          children: view.text || ''
        })
  if (!view.truncated) return wrap(body)
  return jsx('div', {
    className: 'h-full min-h-0 overflow-auto p-2.5 text-(--ui-text-secondary)',
    children: [
      jsx('div', {
        key: 'tr',
        className: 'mb-2 text-xs',
        children: 'Archivo grande: vista truncada a 512 KiB.'
      }),
      body
    ]
  })
}

export default {
  id: ID,
  name: 'Composer Modes',
  register(ctx) {
    ctxRef = ctx

    // v10.9: purga one-time de las marcas ':plan:edit' falsas (v10.8 marcaba al ABRIR el editor).
    try {
      if (!ctx.storage.get('marksPurgeV9', false)) {
        const purgeMap = readMarks()
        let purgeN = 0
        for (const k of Object.keys(purgeMap)) {
          if (k.endsWith(':plan:edit')) {
            delete purgeMap[k]
            purgeN += 1
          }
        }
        ctx.storage.set(MARKS_KEY, purgeMap)
        ctx.storage.set('marksPurgeV9', true)
        probe(`marks purge edit n=${purgeN}`)
      }
    } catch (_) {
      /* una purga nunca debe romper el register */
    }
    probe(
      `register ver=${VER} boot=${BOOT} plannotes=${PLAN_NOTES.length} hash=${String((typeof location !== 'undefined' && location.hash) || '').slice(0, 24)}`
    )
    try {
      probe(
        `caps sid=${String(host.state.focusedSessionId.get())} req=${typeof host.request} evt=${typeof host.onEvent} dispose=${typeof ctx.onDispose}`
      )
    } catch (e) {
      probe(`caps err ${String(e)}`)
    }
    hydrateDialogs(ctx)
    hydrateQ(ctx)

    const onMarksStorage = (e) => {
      try {
        if (!e || e.key !== 'hermes.plugin.' + ID + '.' + MARKS_KEY) return
        bumpMarks()
      } catch (_) {}
    }
    window.addEventListener('storage', onMarksStorage)
    ctx.onDispose(() => window.removeEventListener('storage', onMarksStorage))

    // v10.8: visibilidad real del pane del lector (toggle Leer/Cerrar). Feature-detect en register.
    if (typeof host.paneVisibility === 'function') {
      const vis = host.paneVisibility(PLAN_READER_PANE)
      probe(`read vis=${vis.get() ? 1 : 0}`)
      ctx.onDispose(
        vis.listen((v) => {
          probe(`read vis=${v ? 1 : 0}`)
        })
      )
    }

    ctx.i18n.register({
      en: {
        modesLabel: 'Mode',
        tip: mode => `${mode} mode active`
      },
      es: {
        modesLabel: 'Modo',
        tip: mode => `Modo ${mode} activo`
      }
    })

    // Restaurar modo persistido (API sync: get(key, fallback) → valor).
    const savedMode = ctx.storage.get('mode', 'agent')
    if (MODES.some((m) => m.id === savedMode)) activeMode.set(savedMode)
    // Al cargar: el backend arranca en 'agent' (default). Empujamos el modo persistido para que
    // el primer envío ya esté alineado aunque el middleware no llegue a correr (steer, cards).
    void stageMode(ctx, activeMode.get())

    // ── Tarjeta de aprobación: box + editor inline ──
    function PlanApproveCard({ file }) {
      const dialogs = useValue(planDialogs)
      const entry = (file && dialogs[file]) || EMPTY_DIALOG
      const modifyOpen = entry.open
      const draft = entry.draft
      const sending = entry.sending
      const rootRef = useRef(null)
      const [marks, applyMark, midRef] = useCardMarks('plan', ['go', 'edit'], rootRef, () => file)

      // v10.8: toggle del lector — pane visible Y archivo de ESTA tarjeta.
      const readerFile = useValue(planReaderFile)
      const paneVis = useValue(
        typeof host.paneVisibility === 'function' ? host.paneVisibility(PLAN_READER_PANE) : planReaderOpen
      )
      const reading = paneVis === true && readerFile === file

      useEffect(() => {
        probe(`mount file=${file} boot=${BOOT}`)
        return () => probe(`unmount file=${file} boot=${BOOT}`)
      }, [file])

      if (!isValidPlanFile(file)) {
        probe(`skip invalid file=${String(file)}`)
        return null
      }

      const setEntry = (patch) => setDialogEntry(file, patch)

      const sendTurn = (text, key, freshMark) => {
        const body = String(text || '').slice(0, 450)
        if (!body.trim()) return
        probe(`send key=${key} len=${body.length} file=${file}`)
        setEntry({ sending: key })
        Promise.resolve()
          .then(() => submitTurn(body))
          .then(() => {
            probe(`send ok key=${key} file=${file}`)
            setEntry({ sending: null, open: false, draft: '' })
          })
          .catch((e) => {
            probe(`send err key=${key} ${String((e && e.message) || e)}`)
            if (key === 'go') applyMark('go', false)
            else if (key === 'edit' && freshMark) applyMark('edit', false)
            setEntry({ sending: null })
            notifySafe({ kind: 'error', message: 'No se pudo enviar. Probá desde la caja de prompt.' })
          })
      }

      const implementText = `Implement the plan at ${file} now. Follow it step by step.`

      return jsxs('div', {
        ref: rootRef,
        className: 'mt-3 rounded-lg border border-(--ui-stroke-secondary) p-3',
        children: [
          jsx('div', {
            key: 'head',
            className: 'mb-1 text-sm font-semibold',
            children: `Plan listo — ¿qué hacemos? ${VER}·${BOOT}`
          }),
          jsx('div', {
            key: 'file',
            className: 'mb-2 truncate text-xs text-(--ui-text-tertiary)',
            children: file
          }),
          jsx('div', {
            key: 'hint',
            className: 'mb-3 text-xs text-(--ui-text-tertiary)',
            children: 'Detalle completo en el archivo del plan.'
          }),
          jsxs('div', {
            key: 'row',
            className: 'flex flex-wrap items-center gap-1.5',
            children: [
              jsx(Button, {
                key: 'go',
                disabled: sending !== null || marks.go,
                'aria-pressed': marks.go,
                onClick: () => {
                  probe(`click go file=${file}`)
                  if (isMarked('plan', 'go', midRef.current, file)) {
                    probe('dup go')
                    return
                  }
                  applyMark('go', true)
                  sendTurn(implementText, 'go')
                },
                children: [
                  marks.go
                    ? jsx(Codicon, { key: 'tick-go', name: 'check', size: '0.75rem', className: 'mr-1 shrink-0' })
                    : null,
                  sending === 'go' ? 'Enviando…' : 'Implementar ahora'
                ]
              }),
              jsx(Button, {
                key: 'edit',
                disabled: sending !== null,
                'aria-pressed': marks.edit,
                onClick: () => {
                  probe(`click edit open file=${file}`)
                  setEntry({ open: true })
                },
                children: [
                  marks.edit
                    ? jsx(Codicon, { key: 'tick-edit', name: 'check', size: '0.75rem', className: 'mr-1 shrink-0' })
                    : null,
                  'Modificar'
                ]
              }),
              jsx(Button, {
                key: 'copy',
                disabled: sending !== null,
                onClick: () => {
                  probe('click copy')
                  try {
                    void ctx.os.writeClipboard(file)
                    notifySafe({ kind: 'info', message: 'Path del plan copiado.' })
                  } catch (_) {
                    /* clipboard best-effort */
                  }
                },
                children: 'Copiar path'
              }),
              jsx(Button, {
                key: 'read',
                disabled: sending !== null && !reading,
                'aria-pressed': reading,
                onClick: () => {
                  const freshVis =
                    typeof host.paneVisibility === 'function'
                      ? host.paneVisibility(PLAN_READER_PANE).get() === true
                      : planReaderOpen.get() === true
                  const fresh = freshVis && planReaderFile.get() === file
                  probe(`click read act=${fresh ? 'close' : 'open'} file=${file}`)
                  if (fresh) closePlanReader()
                  else openPlanReader(file)
                },
                children: [
                  jsx(Codicon, {
                    key: 'i',
                    name: reading ? 'close' : 'open-preview',
                    size: '0.75rem',
                    className: 'mr-1 shrink-0'
                  }),
                  reading ? 'Cerrar plan' : 'Leer plan'
                ]
              })
            ]
          }),
          jsx('div', {
            key: 'alt',
            className: 'mt-2 text-xs text-(--ui-text-tertiary)',
            children: 'O escribí en la caja de prompt para ajustar el plan.'
          }),
          modifyOpen && jsx('div', {
            key: 'editor',
            className: 'mt-2 rounded-md border border-(--ui-stroke-secondary) p-2',
            children: jsxs('div', {
              children: [
                jsx('div', {
                  key: 't',
                  className: 'mb-1 text-xs font-semibold',
                  children: 'Modificar el plan'
                }),
                jsx('div', {
                  key: 'd',
                  className: 'mb-1 text-xs text-(--ui-text-tertiary)',
                  children: 'Describí qué cambiar. Se envía como turno nuevo que referencia el plan.'
                }),
                jsx(Textarea, {
                  key: 'ta',
                  value: draft,
                  rows: 5,
                  placeholder: 'Describí qué cambiar del plan…',
                  onChange: (e) => setEntry({ draft: e.target.value })
                }),
                jsxs('div', {
                  key: 'row',
                  className: 'mt-1.5 flex items-center gap-1.5',
                  children: [
                    jsx(Button, {
                      key: 'cancel',
                      disabled: sending !== null,
                      onClick: () => {
                        probe(`close reason=cancel file=${file}`)
                        setEntry({ open: false })
                      },
                      children: 'Cancelar'
                    }),
                    jsx(Button, {
                      key: 'send',
                      disabled: sending !== null || !draft.trim(),
                      onClick: () => {
                        probe(`click edit send file=${file}`)
                        const freshEdit = !isMarked('plan', 'edit', midRef.current, file)
                        applyMark('edit', true)
                        sendTurn(`Update the plan at ${file} with these changes: ${draft}`, 'edit', freshEdit)
                      },
                      children: sending === 'edit' ? 'Enviando…' : 'Enviar cambios'
                    })
                  ]
                })
              ]
            })
          })
        ]
      })
    }

    ctx.register({
      id: 'plan-approve',
      area: TRANSCRIPT_DIRECTIVE_AREA,
      data: {
        name: 'plan-approve',
        render: ({ attrs }) => jsx(PlanApproveCard, { file: attrs.file })
      }
    })

    // ── Tarjeta de preguntas del plan (v10.10) — stepper dentro de la familia ──
    function PlanQuestionsCard({ file }) {
      const all = useValue(planQState)
      const entry = (file && all[file]) || EMPTY_Q
      const rootRef = useRef(null)
      const beatRef = useRef(null)
      const lastPickRef = useRef(0)
      const [marks, applyMark, midRef] = useCardMarks('planq', ['send'], rootRef, () => file)
      const valid = isValidPlanQFile(file)
      const sent = marks.send === true
      const sending = entry.sending === 'send'
      const questions = Array.isArray(entry.questions) ? entry.questions : []
      const total = questions.length
      const answers = entry.answers || {}
      const index = Math.min(Math.max(Number.isInteger(entry.index) ? entry.index : 0, 0), Math.max(total - 1, 0))
      const current = questions[index] || null
      const a = answers[index] === undefined ? null : answers[index]

      useEffect(() => {
        probe(`pq mount file=${file} boot=${BOOT}`)
        return () => {
          if (beatRef.current) clearTimeout(beatRef.current)
          probe(`pq unmount file=${file} boot=${BOOT}`)
        }
      }, [file])

      useEffect(() => {
        if (entry.status === 'err') probe(`pq fallback reason=${valid ? 'read-err' : 'invalid-file'}`)
      }, [entry.status, valid])

      useEffect(() => {
        if (!valid || !file || sent) return undefined
        if (entry.questions) return undefined
        const abs = resolvePlanAbs(file)
        if (!abs) {
          setQEntry(file, { status: 'err', msg: 'Sin workspace (cwd vacío): no puedo resolver el path.' })
          return undefined
        }
        const read = typeof window !== 'undefined' && window.hermesDesktop ? window.hermesDesktop.readFileText : null
        if (typeof read !== 'function') {
          setQEntry(file, { status: 'err', msg: 'readFileText no disponible en este shell.' })
          return undefined
        }
        let alive = true
        setQEntry(file, { status: 'loading' })
        Promise.resolve(read(abs))
          .then((r) => {
            if (!alive) return
            if (r && r.binary) {
              setQEntry(file, { status: 'err', msg: 'El archivo de preguntas es binario.' })
              probe(`pq load err file=${file} binary`)
              return
            }
            const list = normalizeQuestions(r ? r.text : '')
            if (!list || !list.length) {
              setQEntry(file, { status: 'err', msg: 'No pude leer preguntas válidas del archivo.' })
              probe(`pq load err file=${file} parse`)
              return
            }
            setQEntry(file, { status: 'ok', questions: list, answers: {}, index: 0 })
            probe(`pq load ok n=${list.length}`)
          })
          .catch((e) => {
            if (!alive) return
            setQEntry(file, { status: 'err', msg: String((e && e.message) || e) })
            probe(`pq load err file=${file} msg=${String((e && e.message) || e)}`)
          })
        return () => {
          alive = false
        }
      }, [file, valid, sent, entry.questions])

      const tick = (key) => jsx(Codicon, { key, name: 'check', size: '0.75rem', className: 'mr-1 shrink-0' })
      const answered = (ans) =>
        !!ans &&
        ((ans.kind === 'opt' && typeof ans.opt === 'string' && ans.opt.length > 0) ||
          (ans.kind === 'text' && typeof ans.text === 'string' && ans.text.trim().length > 0))
      const allAnswered = total > 0 && questions.every((_, i) => answered(answers[i]))
      const shownAnswer = (ans) => (!ans ? '' : ans.kind === 'opt' ? ans.opt || '' : ans.text || '')

      const pickOption = (opt) => {
        if (sending || sent) return
        if (Date.now() - lastPickRef.current < 300) {
          probe('pq guard skip')
          return
        }
        lastPickRef.current = Date.now()
        const prev = a || {}
        setQEntry(file, {
          answers: { ...answers, [index]: { kind: 'opt', opt, text: typeof prev.text === 'string' ? prev.text : '' } }
        })
        probe(`pq answer q=${index + 1} kind=opt`)
        try {
          haptic('selection')
        } catch (_) {}
        if (index < total - 1) {
          beatRef.current = setTimeout(() => {
            beatRef.current = null
            goto(index + 1)
          }, 200)
        }
      }
      const pickOther = () => {
        if (sending || sent) return
        if (Date.now() - lastPickRef.current < 300) {
          probe('pq guard skip')
          return
        }
        lastPickRef.current = Date.now()
        if (beatRef.current) {
          clearTimeout(beatRef.current)
          beatRef.current = null
          probe('pq beat cancel')
        }
        const prev = a || {}
        setQEntry(file, {
          answers: {
            ...answers,
            [index]: {
              kind: 'text',
              opt: typeof prev.opt === 'string' ? prev.opt : null,
              text: typeof prev.text === 'string' ? prev.text : ''
            }
          }
        })
        probe(`pq answer q=${index + 1} kind=text`)
        try {
          haptic('selection')
        } catch (_) {}
      }
      const typeText = (t) => {
        if (sending || sent) return
        const prev = a || {}
        setQEntry(file, {
          answers: {
            ...answers,
            [index]: { kind: 'text', opt: typeof prev.opt === 'string' ? prev.opt : null, text: t }
          }
        })
      }
      const goto = (i) => {
        if (beatRef.current) {
          clearTimeout(beatRef.current)
          beatRef.current = null
          probe('pq beat cancel')
        }
        const n = Math.min(Math.max(i, 0), Math.max(total - 1, 0))
        setQEntry(file, { index: n })
        probe(`pq step i=${n + 1}/${total}`)
      }
      const sendAnswers = () => {
        if (sending || sent || !allAnswered) return
        const fresh = !isMarked('planq', 'send', midRef.current, file)
        const map = {}
        questions.forEach((_, i) => {
          map[i] = shownAnswer(answers[i]) || '(sin respuesta)'
        })
        applyMark('send', true)
        setQEntry(file, { sending: 'send' })
        submitPlanAnswers(planQAnswersBody(file, questions, map), 'answers')
          .then(() => {
            probe(`pq send ok file=${file}`)
            setQEntry(file, { sending: null })
          })
          .catch((e) => {
            probe(`pq send err ${String((e && e.message) || e)}`)
            if (fresh) applyMark('send', false)
            setQEntry(file, { sending: null })
            notifySafe({ kind: 'error', message: 'No se pudo enviar. Probá desde la caja de prompt.' })
          })
      }
      const sendContinue = () => {
        if (sending || sent) return
        const fresh = !isMarked('planq', 'send', midRef.current, file)
        applyMark('send', true)
        setQEntry(file, { sending: 'send' })
        submitPlanAnswers(planQContinueBody(file), 'continue')
          .then(() => {
            probe(`pq continue ok file=${file}`)
            setQEntry(file, { sending: null })
          })
          .catch((e) => {
            probe(`pq continue err ${String((e && e.message) || e)}`)
            if (fresh) applyMark('send', false)
            setQEntry(file, { sending: null })
            notifySafe({ kind: 'error', message: 'No se pudo enviar. Probá desde la caja de prompt.' })
          })
      }

      const header = jsx('div', {
        key: 'head',
        className: 'mb-1 text-sm font-semibold text-(--ui-text-primary)',
        children: `${total > 0 ? `Preguntas sobre el plan — ${index + 1}/${total}` : 'Preguntas sobre el plan'} · ${VER}·${BOOT}`
      })
      const shell = (children) =>
        jsxs('div', {
          ref: rootRef,
          className: 'mt-3 rounded-lg border border-(--ui-stroke-secondary) p-3',
          children
        })
      const fallbackBtn = jsx(Button, {
        key: 'cont',
        disabled: sending || sent,
        'aria-pressed': sent,
        onClick: sendContinue,
        children: [sent ? tick('tick-cont') : null, sending ? 'Enviando…' : 'Continuar sin responder']
      })

      if (!valid) {
        return shell([
          header,
          jsx('div', {
            key: 'bad',
            className: 'mb-2 text-xs text-(--ui-text-tertiary)',
            children: 'Directiva inválida.'
          }),
          fallbackBtn
        ])
      }
      if (entry.status === 'loading') {
        return shell([
          header,
          jsx('div', { key: 'ld', className: 'text-xs text-(--ui-text-tertiary)', children: 'Leyendo las preguntas…' })
        ])
      }
      if (entry.status === 'err' || !current) {
        return shell([
          header,
          jsx('div', {
            key: 'err',
            className: 'mb-2 text-xs text-(--ui-text-tertiary)',
            children: entry.msg || 'No se pudieron leer las preguntas.'
          }),
          fallbackBtn
        ])
      }

      const optionRow = (opt, i) => {
        const selected = !!a && a.kind === 'opt' && a.opt === opt
        return jsx(Button, {
          key: `opt-${i}`,
          variant: 'ghost',
          role: 'radio',
          'aria-checked': selected,
          disabled: sent || sending,
          className: cn('w-full justify-start text-left whitespace-normal', selected && 'bg-(--ui-control-active-background) text-(--ui-text-primary)'),
          style: selected ? { background: 'var(--ui-control-active-background)', color: 'var(--ui-text-primary)' } : undefined,
          onClick: () => pickOption(opt),
          children: [selected ? tick('tick-opt') : null, `${i + 1}. ${opt}`]
        })
      }
      const otherActive = !!a && a.kind === 'text'
      const otherRow = jsx(Button, {
        key: 'other',
        variant: 'ghost',
        role: 'radio',
        'aria-checked': otherActive,
        disabled: sent || sending,
        className: cn('w-full justify-start text-left whitespace-normal', otherActive && 'bg-(--ui-control-active-background) text-(--ui-text-primary)'),
        style: otherActive ? { background: 'var(--ui-control-active-background)', color: 'var(--ui-text-primary)' } : undefined,
        onClick: pickOther,
        children: [otherActive ? tick('tick-other') : null, `${current.options.length + 1}. Otra respuesta…`]
      })
      const freeField = otherActive
        ? jsx(Textarea, {
            key: 'free',
            value: a && typeof a.text === 'string' ? a.text : '',
            maxLength: 500,
            rows: 3,
            placeholder: 'Redactá tu respuesta…',
            disabled: sent || sending,
            className: 'mt-1.5',
            onChange: (e) => typeText(e && e.target ? e.target.value : '')
          })
        : null

      return shell([
        header,
        jsx('div', { key: 'q', className: 'mb-2 text-sm text-(--ui-text-secondary)', children: current.q }),
        jsxs('div', {
          key: 'opts',
          role: 'radiogroup',
          className: 'flex flex-col items-stretch gap-1',
          children: [...current.options.map((opt, i) => optionRow(opt, i)), otherRow, freeField]
        }),
        jsxs('div', {
          key: 'footer',
          className: 'mt-2 flex flex-wrap items-center gap-1.5',
          children: [
            jsx(Button, {
              key: 'back',
              disabled: sending || index === 0,
              onClick: () => goto(index - 1),
              children: 'Atrás'
            }),
            index < total - 1
              ? jsx(Button, {
                  key: 'next',
                  disabled: sending || sent || !answered(a),
                  onClick: () => goto(index + 1),
                  children: 'Siguiente'
                })
              : jsx(Button, {
                  key: 'send',
                  disabled: sending || sent || !allAnswered,
                  'aria-pressed': sent,
                  onClick: sendAnswers,
                  children: [sent ? tick('tick-send') : null, sending ? 'Enviando…' : 'Enviar respuestas']
                })
          ]
        }),
        jsx('div', {
          key: 'alt',
          className: 'mt-1.5 text-xs text-(--ui-text-tertiary)',
          children: sent
            ? 'Para ajustar algo, escribí en la caja de prompt.'
            : 'Respondé cada pregunta (opción o texto) y enviá todo junto.'
        })
      ])
    }

    ctx.register({
      id: 'plan-questions',
      area: TRANSCRIPT_DIRECTIVE_AREA,
      data: {
        name: 'plan-questions',
        render: ({ attrs }) => jsx(PlanQuestionsCard, { file: attrs.file })
      }
    })

    // ── Tarjeta del bucle de debug ──
    function DebugLoopCard({ round }) {
      const sendingMap = useValue(debugSending)
      const rk = `r${round}`
      const sending = sendingMap[rk] || null
      const valid = ROUND_RE.test(String(round))
      const rootRef = useRef(null)
      const [marks, applyMark, midRef] = useCardMarks('debug', ['retry', 'fixed'], rootRef, () => null)

      useEffect(() => {
        probe(`mount debug-loop round=${round} boot=${BOOT}`)
        return () => probe(`unmount debug-loop round=${round} boot=${BOOT}`)
      }, [round])

      const setSending = (v) => {
        const next = { ...debugSending.get() }
        if (v === null) delete next[rk]
        else next[rk] = v
        debugSending.set(next)
      }

      const sendTurn = (text, key) => {
        if (sending !== null) return
        const body = String(text || '').slice(0, 450)
        if (!body.trim()) return
        probe(`send key=${key} len=${body.length} round=${round}`)
        setSending(key)
        Promise.resolve()
          .then(() => submitTurn(body))
          .then(() => {
            probe(`send ok key=${key} round=${round}`)
            setSending(null)
          })
          .catch((e) => {
            probe(`send err key=${key} ${String((e && e.message) || e)}`)
            if (key === 'retry' || key === 'fixed') applyMark(key, false)
            setSending(null)
            notifySafe({ kind: 'error', message: 'No se pudo enviar. Probá desde la caja de prompt.' })
          })
      }

      const nextRound = (Number(round) || 0) + 1
      const stillBrokenText = `I already did the steps and the bug is STILL NOT WORKING. Read the debug logs/instrumentation output, find the root cause with evidence, apply the fix, and reply with the next sequential steps for me to test. If there are no logs or no new evidence, do not guess: say what is missing, extend or fix the logging if it failed silently, and ask me to re-run the steps to capture it. End with a new ::debug-loop{round="${nextRound}"} directive.`
      const fixedText =
        'The bug is FIXED. Remove ALL the debug instrumentation you added in ANY round (logs, scripts, config flags). Do not rely on memory: search the project for the log strings/markers you introduced and clean every file you touched. Restore the code to its pre-debug state, list each file cleaned, and flag anything you could not fully restore.'

      return jsxs('div', {
        ref: rootRef,
        className: 'mt-3 rounded-lg border border-(--ui-stroke-secondary) p-3',
        children: [
          jsx('div', {
            key: 'head',
            className: 'mb-1 text-sm font-semibold',
            children: `Modo Debug — ronda ${valid ? round : '?'} ${VER}·${BOOT}`
          }),
          jsx('div', {
            key: 'hint',
            className: 'mb-3 text-xs text-(--ui-text-tertiary)',
            children: 'Seguí los pasos del mensaje de arriba; después usá un botón.'
          }),
          jsxs('div', {
            key: 'row',
            className: 'flex flex-wrap items-center gap-1.5',
            children: [
              jsx(Button, {
                key: 'broken',
                disabled: sending !== null || marks.retry,
                'aria-pressed': marks.retry,
                onClick: () => {
                  probe(`click retry round=${round}`)
                  if (isMarked('debug', 'retry', midRef.current, null)) {
                    probe('dup retry')
                    return
                  }
                  applyMark('retry', true)
                  sendTurn(stillBrokenText, 'retry')
                },
                children: [
                  marks.retry
                    ? jsx(Codicon, { key: 'tick-retry', name: 'check', size: '0.75rem', className: 'mr-1 shrink-0' })
                    : null,
                  sending === 'retry' ? 'Enviando…' : "I already did the steps, it's still not working"
                ]
              }),
              jsx(Button, {
                key: 'fixed',
                disabled: sending !== null || marks.fixed,
                'aria-pressed': marks.fixed,
                onClick: () => {
                  probe(`click fixed round=${round}`)
                  if (isMarked('debug', 'fixed', midRef.current, null)) {
                    probe('dup fixed')
                    return
                  }
                  applyMark('fixed', true)
                  sendTurn(fixedText, 'fixed')
                },
                children: [
                  marks.fixed
                    ? jsx(Codicon, { key: 'tick-fixed', name: 'check', size: '0.75rem', className: 'mr-1 shrink-0' })
                    : null,
                  sending === 'fixed' ? 'Enviando…' : 'Mark as fixed'
                ]
              })
            ]
          })
        ]
      })
    }

    ctx.register({
      id: 'debug-loop',
      area: TRANSCRIPT_DIRECTIVE_AREA,
      data: {
        name: 'debug-loop',
        render: ({ attrs }) => jsx(DebugLoopCard, { round: attrs.round })
      }
    })

    // ── Auto-reset: cuando llega el plan, volver a agent para que los
    //    follow-ups (modificar / texto en la caja) NO se re-prefijen con /plan ──
    if (host && typeof host.onEvent === 'function') {
      const disposeEvent = host.onEvent('message.complete', (event) => {
        try {
          const _pl = (event && event.payload) || {}
          probe('mc hit mode=' + activeMode.get() + ' keys=' + Object.keys(_pl).join('+') + ' tlen=' + String(typeof _pl.text === 'string' ? _pl.text.length : -1) + ' dir=' + String(typeof _pl.text === 'string' && _pl.text.indexOf('::') >= 0))
          if (activeMode.get() !== 'plan') return
          const payload = (event && event.payload) || {}
          const text = typeof payload.text === 'string' ? payload.text : ''
          if (!text) return
          if (text.includes('::plan-questions')) {
            applyMode(ctx, 'agent')
            probe('auto-reset planq->agent')
            notifySafe({
              kind: 'info',
              message: 'El agente tiene preguntas — respondé en la tarjeta. Modo vuelto a Agent.'
            })
            return
          }
          if (text.includes('::plan-approve') || text.includes('.hermes/plans/')) {
            applyMode(ctx, 'agent')
            probe('auto-reset to agent')
            notifySafe({
              kind: 'info',
              message: 'Plan listo — modo vuelto a Agent. Implementá, modificá o escribí en el prompt.'
            })
          }
        } catch (_) {
          /* un listener nunca debe romper el dispatch de la app */
        }
      })
      if (typeof disposeEvent === 'function') ctx.onDispose(disposeEvent)
    }
    // ── Auto-reset del bucle de debug: al aparecer la tarjeta (::debug-loop
    //    en la respuesta), volver a agent. Si no, cada mensaje tipeado se
    //    re-prefija con el contrato y RE-INSTRUMENTA el proyecto ──
    if (host && typeof host.onEvent === 'function') {
      const disposeDebugEvent = host.onEvent('message.complete', (event) => {
        try {
          if (activeMode.get() !== 'debug') return
          const payload = (event && event.payload) || {}
          const text = typeof payload.text === 'string' ? payload.text : ''
          if (!text.includes('::debug-loop')) return
          applyMode(ctx, 'agent')
          probe('auto-reset debug->agent')
          notifySafe({ kind: 'info', message: 'Tarjeta de debug lista — seguí con sus botones. Modo vuelto a Agent.' })
        } catch (_) {
          /* un listener nunca debe romper el dispatch */
        }
      })
      if (typeof disposeDebugEvent === 'function') ctx.onDispose(disposeDebugEvent)
    }

    // Flush del espejo y limpieza del debounce al descargar/recargar.
    ctx.onDispose(() => {
      clearTimeout(saveTimer)
      clearTimeout(saveQTimer)
      flushDialogs()
      flushQ()
      if (planReaderDispose) {
        const d = planReaderDispose
        planReaderDispose = null
        try {
          d()
        } catch (_) {
          /* cerrar un panel nunca debe romper el dispose */
        }
      }
      probe(`dispose boot=${BOOT}`)
    })

    // ── Botón único de modo en la tira del composer ──
    function ModeButton() {
      const mode = useValue(activeMode)
      const sid = useValue(host.state.focusedSessionId)
      const current = MODES.find((m) => m.id === mode) || MODES[0]

      // Reset por sesión nueva. D1 (consejo MODEB-V10): el nacimiento desde borrador
      // (null a id) NO es sesión nueva — elegir el modo en el borrador sobrevive al primer
      // envío y el modo persistido no se pisa tras un reload.
      const lastSid = useRef(sid)
      useEffect(() => {
        if (sid === lastSid.current) return
        const prevSid = lastSid.current
        lastSid.current = sid
        if (prevSid === null && sid !== null) return
        if (activeMode.get() !== 'agent') {
          applyMode(ctx, 'agent', sid)
          probe(`session change reset sid=${String(sid)}`)
        }
      }, [sid])

      return jsxs('div', {
        className: 'flex shrink-0 items-center gap-0.5',
        children: [
          jsx(Tip, {
            key: 'mode',
            label: `${current.hint} · clic o Shift+Tab: Ask → Agent → Plan → Debug · ${VER}·${BOOT}`,
            children: jsxs('button', {
              type: 'button',
              'data-mode': current.id,
              'aria-label': `Modo ${current.label} — clic o Shift+Tab para cambiar`,
              className: cn(
                'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[0.6875rem] font-medium transition-opacity',
                'hover:opacity-90'
              ),
              style: {
                backgroundColor: MODE_BG[current.id] || MODE_BG.agent,
                color: 'var(--ui-text-primary)'
              },
              onClick: cycleMode,
              children: [
                jsx(Codicon, { key: 'i', name: current.icon, size: '0.75rem', className: 'shrink-0' }),
                current.label,
                jsx(Codicon, { key: 'c', name: 'chevron-down', size: '0.625rem', className: 'shrink-0 opacity-60' })
              ]
            })
          })
        ]
      })
    }

    ctx.register({
      id: 'pills',
      area: 'composer.actions',
      order: 10,
      render: () => jsx(ModeButton, {})
    })

    // ── Ciclo de modos: dueño único — el botón y Shift+Tab lo llaman ──
    function cycleMode() {
      const prev = activeMode.get()
      const idx = MODES.findIndex((m) => m.id === prev)
      const next = MODES[(idx + 1) % MODES.length].id // idx -1 (modo desconocido) → ask
      applyMode(ctx, next)
      probe(`cycle ${prev}->${next}`)
    }

    // ── Atajo: Shift+Tab cicla el modo (capture en window, scope work-area) ──
    const WORK_AREA =
      '[data-slot="composer-root"], [data-slot="composer-surface"], [data-slot="composer-bounds"]'
    const SKIP_TARGET =
      '.xterm, [data-terminal], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]'
    const onModeKey = (e) => {
      if (e.key !== 'Tab' || !e.shiftKey) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.repeat) return
      if (typeof document === 'undefined' || !document.hasFocus()) return
      const el = e.target instanceof Element ? e.target : null
      if (!el) return
      if (el.closest(SKIP_TARGET)) return
      const isBody = el === document.body || el === document.documentElement
      if (!isBody && !el.closest(WORK_AREA)) return
      try {
        cycleMode()
        e.preventDefault()
        e.stopPropagation()
      } catch (_) {
        /* un listener nunca debe romper el dispatch de la app */
      }
    }
    window.addEventListener('keydown', onModeKey, true)
    ctx.onDispose(() => window.removeEventListener('keydown', onModeKey, true))

    // ── Middleware v13: AVISA el modo al backend y no toca el texto ──
    //    El await garantiza que el backend ya conoce el modo (y su nota) cuando el
    //    turno se admite; la cola re-corre la cadena al drenar, así que un envío
    //    encolado usa el modo vivo al drenar. Si el backend no responde, el envío
    //    sale igual (modo cosmético) — un middleware jamás come un mensaje.
    ctx.register({
      id: 'rewrite',
      area: 'composer.middleware',
      order: 10,
      data: {
        handler: async (draft) => {
          try {
            const mode = activeMode.get()
            const text = String(draft.text || '').trim()
            if (!text) return draft
            const hasAtts = !!(draft.attachments && draft.attachments.length)
            // Slash explícito gana: un texto que ES un comando nunca lleva nota.
            if (!hasAtts && SLASH_SHAPE_RE.test(text)) return draft
            await stageMode(ctx, mode)
            probe('mw v13 mode=' + mode)
            return draft
          } catch (_) {
            return draft
          }
        }
      }
    })
  }
}
