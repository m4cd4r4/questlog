import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Questlog, Step } from '../types'
import {
  CLOSE_EXT, EMPTY, MIGRATED_MARKER, NOTE_FILE, OLD_DATA_DIR, PANE_POLL_MS, accountSteps, bar, claudeDir, closeOf, detailText, filesToMigrate, isClosed, noteContext, headingOf, newlyDone, paneOpenOf, pickCard, restoreFrom, rowToWrite, sessionTitleOf, sessionsReport,
  movesWork, sameReport, stage, statusText, stepsFromInput, tagModeOf, tagOf, tagToShow, title, topicOf, turnEndNudge, whereFromGit, whereLabel,
} from './lib'
import type { Close, Row, TagMode } from './lib'

const PLUGIN = 'questlog'
const PANE = 'questlog'
const PLAN_FILE = /[\\/]\.claude[\\/]plans[\\/][^\\/]+\.md$/i
const GIT_MOVE = /\bgit\s+(checkout|switch|worktree)\b|\bcd\s/

const questlog = atom({ plugin: 'questlog', key: 'questlog' } as const, EMPTY)

const GUIDE = [
  'Questlog: the person runs many sessions in parallel and orients by a panel fed by the `questlog` tool.',
  'Your FIRST tool call on any task of 3+ steps (even one that only plans, audits or investigates) is `questlog`; call it again whenever a step starts or finishes and whenever the plan changes. A resumed session (after /clear, a handover or a restart note) counts as a new task: your first tool call is `questlog` with the handover\'s next steps. One call, no narration about it.',
  'Give `plan` as a 3-6 word name of the feature or job, and `steps` as the whole list each time, each step under 8 words.',
  'Add a `detail` (1-2 plain sentences) to a step when its label alone does not say what it covers; resend it with the whole list.',
  'Skip it for one-shot questions.',
  'Give a step a `check` ({exists: path} or {gone: path}) when a path proves it done, such as a build output or a removed worktree: the panel then closes the card itself once this session is gone and every open step checks out.',
  'When you finish work that another session\'s card still lists, close that card with `questlog_close`, giving its session tag and, for every step it has open, finished with what proves it or not needed with why. Call it with no session to list the cards you can close.',
].join(' ')

async function git($: EngineInterface, args: string[]) {
  const cwd = await $.session.root()
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 }).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout.trim() : ''
}

// The status_line option; register sets it on every load
let showStatus = true
// The session_tag option; register sets it on every load
let tagMode: TagMode = 'clash'

// Everything that writes state goes through here: title source, pane, status, shared file.
// Only the questlog tool is a report (moves reportedAt, so a close against the row lapses); every other save is bookkeeping.
// A report that changes nothing keeps the stamp: the Stop nudge makes a reopened session restate its list, and that
// restatement must not lapse a close another session made against it (lib.ts sameReport)
async function save($: EngineInterface, change: (c: Questlog) => Questlog, report = false) {
  const before = await read($, questlog)
  const stamp = await $.clock.now()
  const changed = change(before)
  const after = { ...changed, updatedAt: stamp, ...(report && !sameReport(before, changed) ? { reportedAt: stamp } : {}) }
  await update($, questlog, () => after)
  if (showStatus) $.ui.status(statusText(after))
  const { total } = stage(after.steps)
  for (const s of newlyDone(before.steps, after.steps)) {
    $.ui.toast(`Done ${stage(after.steps).done}/${total}: ${s.text}`)
  }
  await writeRow($, after, false)
  return after
}

async function rowsDir($: EngineInterface) {
  const [configDir, home, profile] = await Promise.all([
    $.env.get('CLAUDE_CONFIG_DIR'), $.env.get('HOME'), $.env.get('USERPROFILE'),
  ])
  return claudeDir($.plugin.root, configDir, home || profile)
}

async function readRow($: EngineInterface): Promise<Row | undefined> {
  const dir = await rowsDir($)
  if (!dir) return undefined
  const text = await $.fs.read(`${dir}/questlog/${await $.session.id()}.json`).catch(() => '')
  try { return JSON.parse(String(text ?? '')) as Row } catch { return undefined }
}

async function readRows($: EngineInterface): Promise<Row[]> {
  const dir = await rowsDir($)
  if (!dir) return []
  const files = await $.fs.list(`${dir}/questlog`).catch(() => [])
  const rows: Row[] = []
  for (const f of files) {
    if (!f.name.endsWith('.json')) continue
    const text = await $.fs.read(`${dir}/questlog/${f.name}`).catch(() => '')
    try { rows.push(JSON.parse(text as string)) } catch { /* half-written file */ }
  }
  return rows
}

async function writeRow($: EngineInterface, c: Questlog, ended: boolean) {
  const dir = await rowsDir($)
  if (!dir) return
  const id = await $.session.id()
  const row = rowToWrite(await readRow($), id, c, ended, await $.session.root())
  await $.fs.write(`${dir}/questlog/${id}.json`, JSON.stringify(row)).catch(() => undefined)
}

async function readCloses($: EngineInterface) {
  const dir = await rowsDir($)
  const closes = new Map<string, Close>()
  if (!dir) return closes
  for (const f of await $.fs.list(`${dir}/questlog`).catch(() => [])) {
    if (!f.name.endsWith(CLOSE_EXT)) continue
    const text = await $.fs.read(`${dir}/questlog/${f.name}`).catch(() => '')
    try {
      const c = JSON.parse(String(text ?? '')) as Partial<Close> | null
      // Only a close with the two fields isClosed and tagOf read; a half-written or hand-edited file is no close
      if (c && typeof c.by === 'string' && typeof c.rowReportedAt === 'number') closes.set(f.name.slice(0, -CLOSE_EXT.length), c as Close)
    } catch { /* half-written file */ }
  }
  return closes
}

// The mid-turn flag is a fact about the process, not a report: the card's age and any close against the row stay as they are
async function setInTurn($: EngineInterface, inTurn: boolean) {
  const c = await read($, questlog)
  if (!!c.inTurn === inTurn) return
  const after = { ...c, inTurn }
  await update($, questlog, () => after)
  if (after.updatedAt) await writeRow($, after, false)
}

// The session that ran /clear; the next SessionStart in this process is its continuation
let clearedFrom: string | undefined

async function linkCleared($: EngineInterface) {
  const old = clearedFrom
  clearedFrom = undefined
  const dir = await rowsDir($)
  if (!old || !dir) return
  // The tab keeps the old session's tag until the next rename lands; the row says which session it now is
  await save($, x => ({ ...x, continuedFrom: old }))
  const path = `${dir}/questlog/${old}.json`
  try {
    const row = JSON.parse(String((await $.fs.read(path)) ?? '')) as Row
    await $.fs.write(path, JSON.stringify({ ...row, continuedIn: await $.session.id() }))
  } catch { /* no row: nothing was on that card */ }
}

// Once: data from before the rename moves across so sessions keep their plans. The old folder stays.
// A failed copy leaves no marker, so the next session start tries again.
async function migrateOldData($: EngineInterface) {
  const dir = await rowsDir($)
  if (!dir) return
  const names = async (folder: string) => (await $.fs.list(`${dir}/${folder}`).catch(() => [])).map(f => f.name)
  const [oldNames, newNames] = await Promise.all([names(OLD_DATA_DIR), names('questlog')])
  if (oldNames.length === 0 || newNames.includes(MIGRATED_MARKER)) return
  for (const name of filesToMigrate(oldNames, newNames)) {
    await $.fs.write(`${dir}/questlog/${name}`, String(await $.fs.read(`${dir}/${OLD_DATA_DIR}/${name}`)))
  }
  await $.fs.write(`${dir}/questlog/${MIGRATED_MARKER}`, '')
}

// A reopened session starts with an empty atom; its saved row still holds the plan
async function restoreSaved($: EngineInterface) {
  const saved = await readRow($)
  if (!saved) return
  const now = await read($, questlog)
  const back = restoreFrom(now, saved)
  if (back !== now) await update($, questlog, () => back)
}

async function refreshWhere($: EngineInterface) {
  const [top, common, branch] = await Promise.all([
    git($, ['rev-parse', '--show-toplevel']),
    git($, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git($, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ])
  const cwd: string = await $.session.root()
  const where = top ? whereFromGit(top, common || `${top}/.git`) : whereFromGit(cwd, '')
  const now = await read($, questlog)
  if (now.repo === where.repo && now.slug === where.slug && now.branch === branch) return now
  return save($, c => ({ ...c, ...where, branch }))
}

// The pane is off until the person turns it on from the extension's hover card, per session
async function paneFile($: EngineInterface) {
  const dir = await rowsDir($)
  return dir ? `${dir}/questlog/panes/${await $.session.id()}.json` : ''
}

async function writePaneFlag($: EngineInterface, open: boolean) {
  const path = await paneFile($)
  if (path) await $.fs.write(path, JSON.stringify({ open })).catch(() => undefined)
}

async function syncPane($: EngineInterface) {
  const path = await paneFile($)
  if (!path) return
  // Asked first: a read that misses logs a line, and this runs every 2 seconds in every session
  const flagged = await $.fs.exists(path).catch(() => false)
  const want = flagged && paneOpenOf(String((await $.fs.read(path).catch(() => '')) ?? ''))
  const panes = await $.ui.panes().catch(() => [])
  // Opened by a timer, a pane waits undrawn below 144 columns; one open behind a prompt is placed at any width
  const shown = panes.some((p: { id: string; isPlaced?: boolean }) => p.id === PANE && p.isPlaced !== false)
  if (want && !shown) await $.ui.open({ id: PANE, title: 'Questlog' })
  if (!want && shown) await $.ui.close({ id: PANE })
}

let paneTick: { cancel: () => void } | undefined
// Tool calls that could have moved a step since the last report (lib.ts movesWork): what turnEndNudge reads.
// A turn of reads alone owes no report, or every lookup would cost a blocked turn and a questlog call (#7)
let toolsSinceReport = 0

export const register: Register = (on, options) => {
  showStatus = options.status_line !== false
  tagMode = tagModeOf(options.session_tag)
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'questlog',
      description:
        'Report where this session is so the person can orient across parallel sessions. ' +
        'Send the plan name and the WHOLE step list each call; status is done, now or todo (at most one now). ' +
        'Add an optional `detail` (1-2 plain sentences) to any step whose label alone does not say what it covers.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          plan: { type: 'string', description: '3-6 word name of the feature or job' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                status: { type: 'string', enum: ['done', 'now', 'todo'] },
                detail: { type: 'string', description: 'Optional, 1-2 plain sentences: what this step covers or its sub-steps. Shown when the person clicks the step.' },
                check: {
                  type: 'object',
                  description: 'Optional: one path that proves this step done, as {exists: path} or {gone: path}, absolute or relative to the session folder. Once this session is gone, the panel closes the card itself when every open step\'s path checks out. A path only, never a command.',
                  properties: { exists: { type: 'string' }, gone: { type: 'string' } },
                },
              },
              required: ['text', 'status'],
            },
          },
        },
      },
    })
    await $.tool.register({
      name: 'questlog_close',
      description:
        'Close another session\'s Questlog card, in this repo only, by accounting for every step it still has open: finished, with what you ran or saw that proves it, or not needed, with why. ' +
        'Give its session ID or 6 character tag. A step left out refuses the close and is named back. ' +
        'The card names this session and each reason, and comes back if its session updates. With no session, lists the cards you can close.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          session: { type: 'string', description: 'The session ID or 6 character tag of the card. Never a plan name.' },
          steps: {
            type: 'array',
            description: 'Every step the card still has open, by its text as the card shows it.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                outcome: { type: 'string', enum: ['finished', 'not needed'] },
                why: { type: 'string', description: 'Finished: what you ran or saw that proves it. Not needed: why the step is not required.' },
              },
              required: ['text', 'outcome', 'why'],
            },
          },
          evidence: { type: 'string', description: 'Only for a card with no step list: what proves the work is done.' },
        },
      },
    })
    await $.command.register({ name: 'sessions', description: 'List every live Claude session: repo, branch, plan, stage, now' })
    await $.command.register({ name: 'questlog', description: 'Print the plan, stage, done, now and todo of this session' })
    await migrateOldData($).catch(() => undefined)
    await restoreSaved($)
    await refreshWhere($)
    paneTick?.cancel()
    paneTick = $.clock.every(PANE_POLL_MS, () => syncPane($).catch(() => undefined))
    await syncPane($).catch(() => undefined)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: `${PLUGIN}:guide`, text: GUIDE, scope: 'session' as const }] }
  })

  // The restart note reaches a session started fresh, not one continued by /clear or a compact
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    const source = (e as { source?: string }).source
    if (source === 'clear') await linkCleared($)
    if (source === 'clear' || source === 'compact') return r
    const dir = await rowsDir($)
    if (!dir) return r
    const path = `${dir}/questlog/${NOTE_FILE}`
    const text = await $.fs.read(path).catch(() => '')
    const context = noteContext(String(text ?? ''), path)
    return context ? { ...r, additionalContext: [...(r.additionalContext ?? []), context] } : r
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const r = await next(e)
    await syncPane($).catch(() => undefined)
    const topic = topicOf(e.prompt ?? '')
    let c = await refreshWhere($)
    if (topic && !c.topic) c = await save($, x => ({ ...x, topic }))
    const previous = c.shownTitle
    const id = await $.session.id()
    const rows = tagMode === 'clash' ? await readRows($) : []
    const tag = tagToShow(tagMode, tagOf(id), previous, c, rows, id, await $.clock.now())
    const shownTitle = title(c, 60, tag)
    const sessionTitle = sessionTitleOf(c, previous, tag)
    const taggedName = tag ? c.plan || c.topic : undefined
    if (shownTitle !== previous || taggedName !== c.taggedName) c = await save($, x => ({ ...x, shownTitle, taggedName }))
    await setInTurn($, true)
    return { ...r, sessionTitle }
  }).catch(($, e, next) => next(e))

  // A turn that ran tools after its last report reports once more, so the card's count is current when the session stops
  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    if (r.block) return r
    const nudge = turnEndNudge((await read($, questlog)).steps, toolsSinceReport, e.stop_hook_active)
    toolsSinceReport = 0
    if (nudge) return { ...r, block: nudge }
    await setInTurn($, false)
    return r
  }).catch(($, e, next) => next(e))

  // No catch here: a catch that calls next again would run a failed tool a second time
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (movesWork(e.tool)) toolsSinceReport++
    return ran
  })

  // The cast: the generated tool types list MCP servers' tools, not this mod's own
  on('tool.call', { tool: 'mcp__questlog__questlog' as 'Bash' }, async ($, e: any) => {
    const input = (e.input ?? e) as { plan?: unknown; steps?: unknown }
    const steps: Step[] = stepsFromInput(input.steps)
    const c = await save($, x => ({
      ...x,
      plan: typeof input.plan === 'string' && input.plan.trim() ? input.plan.trim().slice(0, 80) : x.plan,
      steps: Array.isArray(input.steps) ? steps : x.steps,
    }), true)
    toolsSinceReport = 0
    const { done, total } = stage(c.steps)
    return { result: `Questlog updated: ${c.plan || '(no plan)'} ${done}/${total}` }
  }).catch(() => ({ result: 'Questlog update failed; carry on.' }))

  // Who closed it comes from this session, never from the model's input
  on('tool.call', { tool: 'mcp__questlog__questlog_close' as 'Bash' }, async ($, e: any) => {
    const input = (e.input ?? e) as { session?: unknown; steps?: unknown; evidence?: unknown }
    const self = await $.session.id()
    const c = await read($, questlog)
    const picked = pickCard(await readRows($), self, c.repo, typeof input.session === 'string' ? input.session : '')
    if ('error' in picked) return { result: picked.error }
    const accounted = accountSteps(picked.row, input.steps)
    if ('error' in accounted) return { result: accounted.error }
    const evidence = typeof input.evidence === 'string' ? input.evidence : ''
    if (accounted.steps.length === 0 && !evidence.trim()) return { result: 'Nothing closed. Say what proves the work is done.' }
    const closes = await readCloses($)
    if (isClosed(picked.row, closes)) return { result: `Nothing closed. ${tagOf(closes.get(picked.row.id)!.by)} already closed this card.` }
    const dir = await rowsDir($)
    const close = closeOf(picked.row, self, c, accounted.steps, evidence, await $.clock.now())
    await $.fs.write(`${dir}/questlog/${picked.row.id}${CLOSE_EXT}`, JSON.stringify(close))
    return { result: `Closed ${tagOf(picked.row.id)} ${picked.row.plan}. Its card names this session and your evidence, and comes back if that session updates.` }
  }).catch(() => ({ result: 'Questlog close failed; carry on.' }))

  // A plan written in plan mode names the plan, unless the model already did
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (!ran.isError && !ran.deny && PLAN_FILE.test(e.file_path)) {
      const heading = headingOf(e.content)
      if (heading) await save($, c => (c.plan ? c : { ...c, plan: heading }))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (GIT_MOVE.test(e.command)) await refreshWhere($)
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'sessions' }, async $ => {
    const self = await $.session.id()
    await writeRow($, await read($, questlog), false)
    const rows = await readRows($)
    const closes = await readCloses($)
    return { text: sessionsReport(rows.filter(r => !isClosed(r, closes)), self, await $.clock.now()) }
  })

  // The Pane does not draw in the VS Code panel, so the detail is printed on demand
  on('command.run', { command: 'questlog' }, async $ => {
    return { text: detailText(await read($, questlog)) }
  })

  // Closed by hand: record it, or the next poll opens it again
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') await writePaneFlag($, false)
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    // /clear keeps this process and fires no session.start, so the poll has to outlive it
    if (e.reason !== 'clear') paneTick?.cancel()
    toolsSinceReport = 0
    await writeRow($, await read($, questlog), true)
    if (e.reason === 'clear') clearedFrom = e.sessionId
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const c = await read($, questlog)
    const { done, total, now } = stage(c.steps)
    const doneSteps = c.steps.filter(s => s.status === 'done')
    const todo = c.steps.filter(s => s.status === 'todo')
    const where = [c.repo || '?', whereLabel(c) || c.branch].filter(Boolean).join(' · ')

    return (
      <Box flexDirection="column">
        <Text bold>{where}</Text>
        <Text>{c.plan || c.topic || 'No plan reported yet'}</Text>
        {total > 0 && <Text>{bar(done, total)} {done}/{total}</Text>}
        {now && <Text>▶ Now: {now}</Text>}
        {doneSteps.length > 3 && <Text dimColor>✓ {doneSteps.length - 3} earlier done</Text>}
        {doneSteps.slice(-3).map(s => <Text dimColor>✓ {s.text}</Text>)}
        {todo.slice(0, 5).map(s => <Text>○ {s.text}</Text>)}
        {todo.length > 5 && <Text dimColor>+{todo.length - 5} more</Text>}
      </Box>
    )
  })
}
