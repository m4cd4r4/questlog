import { expect, test } from 'claude-code/testing'

import { EMPTY, accountSteps, filesToMigrate, stepsFromInput, noteContext, pickCard, STALE_MS, claudeDir, claudeDirOf, headingOf, movesWork, newlyDone, paneOpenOf, restoreFrom, rowOf, rowToWrite, sameReport, sessionTitleOf, sessionsReport, tagModeOf, tagOf, tagToShow, statusText, title, topicOf, turnEndNudge, whereFromGit } from './lib'
import type { Row } from './lib'

const steps = [
  { text: 'Spike', status: 'done' as const },
  { text: 'State and sources', status: 'done' as const },
  { text: 'Pane render', status: 'now' as const },
  { text: 'Tests', status: 'todo' as const },
]

test('pickCard: three sessions in one folder, only an ID or tag that fits one card in this repo picks it, never a plan name', () => {
  const card = (id: string, plan: string, repo = 'shop', done = 1): Row => ({ id, repo, where: '', plan, done, total: 3, now: '', updatedAt: 5, cwd: '/work/shop' })
  const rows = [card('aaaaaa01-0', 'Same plan'), card('aaaaaa02-0', 'Same plan'), card('bbbbbb00-0', 'Other'), card('cccccc00-0', 'Self'), card('dddddd00-0', 'Elsewhere', 'blog'), card('eeeeee00-0', 'Done', 'shop', 3)]
  const pick = (s: string) => pickCard(rows, 'cccccc00-0', 'shop', s)
  expect(pick('bbbbbb')).toEqual({ row: rows[2] })
  expect(pick('bbbbbb00-0')).toEqual({ row: rows[2] })
  expect(pick('aaaaaa01')).toEqual({ row: rows[0] })
  for (const refused of ['aaaaaa', 'Same plan', 'cccccc', 'dddddd', 'eeeeee', '', 'bbb', 'ffffff']) expect('error' in pick(refused)).toBe(true)
  expect((pick('') as { error: string }).error).toContain('bbbbbb Other 1/3')
  expect((pick('') as { error: string }).error).not.toContain('dddddd')
})

test('sameReport: the same plan and steps restated is no new report; a status, text, detail or check change is', () => {
  const steps = [{ text: 'a', status: 'done' as const }, { text: 'b', status: 'now' as const, detail: 'd' }]
  expect(sameReport({ plan: 'P', steps }, { plan: 'P', steps: steps.map(s => ({ ...s })) })).toBe(true)
  expect(sameReport({ plan: 'P', steps }, { plan: 'Q', steps })).toBe(false)
  expect(sameReport({ plan: 'P', steps }, { plan: 'P', steps: [steps[0], { ...steps[1], status: 'done' }] })).toBe(false)
  expect(sameReport({ plan: 'P', steps }, { plan: 'P', steps: [steps[0], { ...steps[1], detail: 'e' }] })).toBe(false)
  expect(sameReport({ plan: 'P', steps }, { plan: 'P', steps: [steps[0], { ...steps[1], check: { exists: 'x' } }] })).toBe(false)
  expect(sameReport({ plan: 'P', steps }, { plan: 'P', steps: [steps[0]] })).toBe(false)
})

test('movesWork: reads and the questlog tools owe no report; edits, shell, agents and other MCP tools do', () => {
  for (const t of ['Read', 'Grep', 'Glob', 'WebSearch', 'ToolSearch', 'mcp__questlog__questlog', 'mcp__questlog__questlog_close']) expect(movesWork(t)).toBe(false)
  for (const t of ['Write', 'Edit', 'MultiEdit', 'Bash', 'PowerShell', 'Agent', 'NotebookEdit', 'mcp__vercel__deploy']) expect(movesWork(t)).toBe(true)
})

test('turnEndNudge: only a turn that ran tools since its report, with steps left, and never twice in a row', () => {
  const left = [{ text: 'a', status: 'done' as const }, { text: 'b', status: 'now' as const }]
  expect(turnEndNudge(left, 3, false)).toContain('questlog')
  expect(turnEndNudge(left, 0, false)).toBe('')
  expect(turnEndNudge(left, 3, true)).toBe('')
  expect(turnEndNudge([{ text: 'a', status: 'done' }], 3, false)).toBe('')
  expect(turnEndNudge([], 3, false)).toBe('')
})

test('title: repo, worktree slug, plan and stage', () => {
  const t = title({ ...EMPTY, repo: 'myapp', branch: 'feat/x', slug: 'feature-x', plan: 'Pricing wave 3', steps })
  expect(t).toBe('2/4 Pricing wave 3 · feature-x')
})

test('title: main branch is left out, a feature branch is shown', () => {
  expect(title({ ...EMPTY, repo: 'myapp', branch: 'main', plan: 'Fix nav' })).toBe('Fix nav')
  expect(title({ ...EMPTY, repo: 'myapp', branch: 'feat/nav', plan: 'Fix nav' })).toBe('Fix nav · feat/nav')
})

test('title: the plan is trimmed first and the stage survives the cap', () => {
  const t = title({ ...EMPTY, repo: 'myapp', slug: 'a-long-worktree-slug', plan: 'A very long plan name that runs on and on and on', steps }, 60)
  expect(t.length <= 60).toBe(true)
  expect(t.startsWith('2/4 A very')).toBe(true)
  expect(t.endsWith(' · a-long-worktree-slug')).toBe(true)
})

test('title: falls back to the first real prompt when there is no plan', () => {
  expect(title({ ...EMPTY, repo: 'myapp', topic: 'Fix the pricing table on mobile' })).toBe('Fix the pricing table on mobile')
})

test('title: a session tag leads, the stage and plan follow, the cap still holds', () => {
  const c = { ...EMPTY, repo: 'myapp', plan: 'Pricing table fix', steps: [{ text: 'a', status: 'done' as const }, { text: 'b', status: 'now' as const }] }
  expect(title(c, 60, '7b19a4')).toBe('[7b19a4] 1/2 Pricing table fix')
  expect(title({ ...c, plan: 'x'.repeat(80) }, 40, '7b19a4').length).toBeLessThanOrEqual(40)
  expect(title({ ...c, plan: 'x'.repeat(80) }, 40, '7b19a4').startsWith('[7b19a4] 1/2 ')).toBe(true)
})

test('sessionTitleOf and tagOf: a plan-less session gets the tag alone, once', () => {
  expect(tagOf('7B19A432-4e3e-4760-88d1-c02367218db3')).toBe('7b19a4')
  expect(tagOf('')).toBe('')
  expect(sessionTitleOf({ ...EMPTY, repo: 'myapp' }, '', '7b19a4')).toBe('[7b19a4]')
  expect(sessionTitleOf({ ...EMPTY, repo: 'myapp' }, '[7b19a4]', '7b19a4')).toBeUndefined()
  expect(sessionTitleOf({ ...EMPTY, repo: 'myapp', topic: 'Fix the pricing table on mobile' }, '[7b19a4]', '7b19a4')).toBe('[7b19a4] Fix the pricing table on mobile')
})

const NOW = 1_000_000_000_000
const planned = { ...EMPTY, repo: 'myapp', plan: 'Pricing table fix', steps: [{ text: 'a', status: 'done' as const }, { text: 'b', status: 'now' as const }] }
const rowWith = (id: string, rowTitle: string, extra = {}) =>
  ({ id, repo: 'myapp', where: '', plan: '', done: 0, total: 0, now: '', updatedAt: NOW - 1000, title: rowTitle, ...extra }) as never

test('tagModeOf: only always and never are read; anything else is clash', () => {
  expect(tagModeOf('always')).toBe('always')
  expect(tagModeOf('never')).toBe('never')
  expect(tagModeOf('clash')).toBe('clash')
  expect(tagModeOf(undefined)).toBe('clash')
  expect(tagModeOf('ALWAYS')).toBe('clash')
})

test('tagToShow clash: no other session with the title means no tag', () => {
  expect(tagToShow('clash', '7b19a4', undefined, planned, [], 'me', NOW)).toBe('')
  expect(tagToShow('clash', '7b19a4', undefined, planned, [rowWith('other', '1/2 Another plan')], 'me', NOW)).toBe('')
})

test('tagToShow clash: another live session with the same title gets this one tagged', () => {
  const rows = [rowWith('other', '1/2 Pricing table fix')]
  expect(tagToShow('clash', '7b19a4', undefined, planned, rows, 'me', NOW)).toBe('7b19a4')
  // the other session's title may already carry its own tag
  expect(tagToShow('clash', '7b19a4', undefined, planned, [rowWith('other', '[aaaaaa] 1/2 Pricing table fix')], 'me', NOW)).toBe('7b19a4')
})

test('tagToShow clash: itself, ended and long-quiet rows are not a clash', () => {
  expect(tagToShow('clash', '7b19a4', undefined, planned, [rowWith('me', '1/2 Pricing table fix')], 'me', NOW)).toBe('')
  expect(tagToShow('clash', '7b19a4', undefined, planned, [rowWith('other', '1/2 Pricing table fix', { ended: true })], 'me', NOW)).toBe('')
  expect(tagToShow('clash', '7b19a4', undefined, planned, [rowWith('other', '1/2 Pricing table fix', { updatedAt: NOW - 8 * 24 * 3600 * 1000 })], 'me', NOW)).toBe('')
})

test('tagToShow clash: a tagged title stays tagged once the other session is gone', () => {
  const tagged = { ...planned, taggedName: 'Pricing table fix' }
  expect(tagToShow('clash', '7b19a4', '[7b19a4] 1/2 Pricing table fix', tagged, [], 'me', NOW)).toBe('7b19a4')
})

test('tagToShow clash: a new name drops the tag unless it clashes too', () => {
  const renamed = { ...planned, taggedName: 'Continue from the clear-resume handover' }
  expect(tagToShow('clash', '7b19a4', '[7b19a4] Continue from the clear-resume handover', renamed, [], 'me', NOW)).toBe('')
  expect(tagToShow('clash', '7b19a4', '[7b19a4] Continue from the clear-resume handover', renamed, [rowWith('other', '1/2 Pricing table fix')], 'me', NOW)).toBe('7b19a4')
  // Tagged before the name was recorded (0.7.0): judged afresh
  expect(tagToShow('clash', '7b19a4', '[7b19a4] 1/2 Pricing table fix', planned, [], 'me', NOW)).toBe('')
})

test('tagToShow clash: a session with no plan or first prompt is never tagged', () => {
  expect(tagToShow('clash', '7b19a4', undefined, { ...EMPTY, repo: 'myapp' }, [rowWith('other', 'myapp')], 'me', NOW)).toBe('')
})

test('tagToShow always and never ignore the other rows', () => {
  expect(tagToShow('always', '7b19a4', undefined, planned, [], 'me', NOW)).toBe('7b19a4')
  expect(tagToShow('always', '', undefined, planned, [], 'me', NOW)).toBe('')
  expect(tagToShow('never', '7b19a4', '[7b19a4] 1/2 Pricing table fix', planned, [rowWith('other', '1/2 Pricing table fix')], 'me', NOW)).toBe('')
})

test('topicOf: "go" is not a topic', () => {
  expect(topicOf('go')).toBe('')
  expect(topicOf('continue from the handover')).toBe('continue from the handover')
})

test('topicOf: an injected tag block is not a topic', () => {
  expect(topicOf('<browser_instruction># Claude in Chrome browser automation tools are available')).toBe('')
  expect(topicOf('<system-reminder>\nplease keep working on the current task\n</system-reminder>\nfix the pricing table')).toBe('fix the pricing table')
})

test('topicOf: the clear-resume relay prompt is not a topic', () => {
  expect(topicOf('Continue from the clear-resume handover that was just loaded.')).toBe('')
})

test('sessionTitleOf: plan, else topic, sent only when it changes, never the bare repo', () => {
  const planned = { ...EMPTY, repo: 'myapp', plan: 'Pricing table fix', steps: [{ text: 'a', status: 'done' as const }, { text: 'b', status: 'now' as const }] }
  expect(sessionTitleOf(planned, '')).toBe('1/2 Pricing table fix')
  expect(sessionTitleOf(planned, '1/2 Pricing table fix')).toBeUndefined()
  expect(sessionTitleOf({ ...EMPTY, repo: 'myapp', topic: 'Fix the pricing table on mobile' }, '')).toBe('Fix the pricing table on mobile')
  expect(sessionTitleOf({ ...EMPTY, repo: 'myapp' }, '')).toBeUndefined()
})

test('restoreFrom: an empty questlog takes the saved plan, steps and branch back', () => {
  const saved: Row = { ...rowOf('s1', { ...EMPTY, repo: 'myapp', branch: 'feat/x', plan: 'Pricing fix', shownTitle: '1/2 Pricing fix', steps: [{ text: 'a', status: 'done' }, { text: 'b', status: 'now' }] }), ended: true }
  const back = restoreFrom(EMPTY, saved)
  expect(back.plan).toBe('Pricing fix')
  // the title last sent is forgotten: the host restored the tab with an older label, so the first
  // prompt after a restart sends the plan title again
  expect(back.shownTitle).toBeUndefined()
  expect(sessionTitleOf(back, back.shownTitle)).toBe('1/2 Pricing fix · feat/x')
  expect(back.steps).toEqual(saved.steps)
  expect(back.branch).toBe('feat/x')
  // a questlog that already has a plan is left alone
  const live = { ...EMPTY, plan: 'Newer plan' }
  expect(restoreFrom(live, saved)).toBe(live)
})

test('rowToWrite: an empty questlog never wipes a saved plan, it only marks the row ended', () => {
  const saved: Row = rowOf('s1', { ...EMPTY, plan: 'Pricing fix', steps: [{ text: 'a', status: 'now' }], updatedAt: 5 })
  const kept = rowToWrite(saved, 's1', { ...EMPTY, updatedAt: 9 }, true, '/w')
  expect(kept.plan).toBe('Pricing fix')
  expect(kept.steps).toEqual(saved.steps)
  expect(kept.ended).toBe(true)
  // a questlog with content, or no saved row, writes as usual
  expect(rowToWrite(saved, 's1', { ...EMPTY, plan: 'Other', updatedAt: 9 }, false, '/w').plan).toBe('Other')
  expect(rowToWrite(undefined, 's1', EMPTY, false, '/w').plan).toBe('')
})

test('rowToWrite: startedAt is the first write and never moves; a row from before it stays without one', () => {
  const first = rowToWrite(undefined, 's1', { ...EMPTY, plan: 'P', updatedAt: 5 }, false, '/w')
  expect(first.startedAt).toBe(5)
  expect(rowToWrite(first, 's1', { ...EMPTY, plan: 'P', updatedAt: 9 }, false, '/w').startedAt).toBe(5)
  expect(rowToWrite(first, 's1', { ...EMPTY, updatedAt: 9 }, true, '/w').startedAt).toBe(5)
  const old = rowOf('s1', { ...EMPTY, plan: 'P', updatedAt: 3 })
  expect('startedAt' in rowToWrite(old, 's1', { ...EMPTY, plan: 'P', updatedAt: 9 }, false, '/w')).toBe(false)
})

test('statusText and newlyDone', () => {
  expect(statusText({ ...EMPTY, steps })).toBe('2/4 · Now: Pane render')
  expect(statusText(EMPTY)).toBe(undefined)
  const after = steps.map(s => (s.text === 'Pane render' ? { ...s, status: 'done' as const } : s))
  expect(newlyDone(steps, after).map(s => s.text)).toEqual(['Pane render'])
})

test('whereFromGit: main checkout vs linked worktree, both slash styles', () => {
  expect(whereFromGit('C:/work/myapp', 'C:/work/myapp/.git')).toEqual({ repo: 'myapp', slug: '' })
  expect(whereFromGit('C:/work/myapp-feature-x', 'C:/work/myapp/.git')).toEqual({ repo: 'myapp', slug: 'feature-x' })
  expect(whereFromGit('C:\\work\\other', 'C:\\work\\myapp\\.git')).toEqual({ repo: 'myapp', slug: 'other' })
})

test('headingOf and claudeDirOf', () => {
  expect(headingOf('intro\n# Questlog\n## Context')).toBe('Questlog')
  expect(claudeDirOf('C:/Users/me/.claude/dev-mods/x/questlog')).toBe('C:/Users/me/.claude')
  expect(claudeDirOf('C:\\Users\\me\\.claude\\plugins\\cache\\x')).toBe('C:\\Users\\me\\.claude')
})

test('claudeDir: config dir, then the plugin path, then home', () => {
  expect(claudeDir('C:/work/questlog/mod', 'D:/cfg', 'C:/Users/me')).toBe('D:/cfg')
  expect(claudeDir('C:/Users/me/.claude/dev-mods/x/m', undefined, 'C:/Users/other')).toBe('C:/Users/me/.claude')
  expect(claudeDir('C:/work/questlog/mod', undefined, 'C:/Users/me')).toBe('C:/Users/me/.claude')
  expect(claudeDir('C:/work/questlog/mod')).toBe('')
})

test('sessionsReport: drops ended and stale rows, groups by repo, marks self', () => {
  const now = 10 * STALE_MS
  const row = (o: Partial<Row>): Row => ({ id: 'a', repo: 'myapp', where: '', plan: 'P', done: 0, total: 0, now: '', updatedAt: now - 60000, ...o })
  const report = sessionsReport([
    row({ id: 'self', where: 'pricing', plan: 'Pricing', done: 2, total: 5, now: 'Tests' }),
    row({ id: 'b', repo: 'azureprep', plan: 'Redis move' }),
    row({ id: 'old', plan: 'Stale one', updatedAt: now - STALE_MS - 1 }),
    row({ id: 'gone', plan: 'Ended one', ended: true }),
  ], 'self', now)
  expect(report).toBe([
    'azureprep',
    '    main · Redis move · 1m ago',
    'myapp',
    '  ▶ pricing · Pricing · 2/5 · now: Tests · 1m ago',
  ].join('\n'))
  expect(sessionsReport([], 'x', now)).toBe('No live sessions recorded.')
})

test('title: repo stands in when there is no plan or topic', () => {
  expect(title({ ...EMPTY, repo: 'myapp', branch: 'main' })).toBe('myapp')
})

test('rowOf: carries steps, branch and cwd for the sidebar', () => {
  const steps = [{ text: 'a', status: 'done' as const }, { text: 'b', status: 'now' as const }]
  const row = rowOf('id1', { ...EMPTY, repo: 'r', branch: 'feat/x', plan: 'P', steps, updatedAt: 5, shownTitle: '1/2 P' }, false, 'I:/r')
  expect(row).toMatchObject({ id: 'id1', repo: 'r', plan: 'P', done: 1, total: 2, now: 'b', steps, branch: 'feat/x', cwd: 'I:/r', title: '1/2 P' })
  expect(rowOf('id2', EMPTY).title).toBe('')
  // the session a /clear replaced rides along so the sidebar can match a tab still tagged with it; absent otherwise
  expect(rowOf('id3', { ...EMPTY, continuedFrom: 'a3fea4bb-0000-4000-8000-000000000000' }).continuedFrom).toBe('a3fea4bb-0000-4000-8000-000000000000')
  expect('continuedFrom' in rowOf('id2', EMPTY)).toBe(false)
})

test('noteContext: empty note says nothing, a note carries its text and path', () => {
  expect(noteContext('  \n ', '/n.md')).toBe('')
  const c = noteContext('- test the tab switch\n', 'C:/x/restart-note.md')
  expect(c).toContain('- test the tab switch')
  expect(c).toContain('C:/x/restart-note.md')
  expect(c).toContain('first reply')
})

test('paneOpenOf: only an explicit open:true opens the pane', () => {
  expect(paneOpenOf('{"open":true}')).toBe(true)
  expect(paneOpenOf('{"open":false}')).toBe(false)
  expect(paneOpenOf('')).toBe(false)
  expect(paneOpenOf('{"open":"yes"}')).toBe(false)
  expect(paneOpenOf('not json')).toBe(false)
})

test('stepsFromInput keeps a trimmed detail, drops an empty one, and repairs bad status', () => {
  const out = stepsFromInput([
    { text: 'A', status: 'now', detail: '  Reads the worktree state.  ' },
    { text: 'B', status: 'bogus', detail: '   ' },
    { text: 'C', status: 'done' },
    { status: 'todo' },
    null,
  ])
  expect(out).toEqual([
    { text: 'A', status: 'now', detail: 'Reads the worktree state.' },
    { text: 'B', status: 'todo' },
    { text: 'C', status: 'done' },
  ])
  expect(stepsFromInput('nope')).toEqual([])
  expect(stepsFromInput([{ text: 'x', status: 'todo', detail: 'y'.repeat(900) }])[0].detail?.length).toBe(400)
})

test('stepsFromInput keeps a check that names one path as exists or gone, and drops any other shape', () => {
  const kept = stepsFromInput([
    { text: 'A', status: 'todo', check: { exists: ' dist/out.vsix ' } },
    { text: 'B', status: 'todo', check: { gone: 'I:/Scratch/shop-old' } },
  ])
  expect(kept.map(s => s.check)).toEqual([{ exists: 'dist/out.vsix' }, { gone: 'I:/Scratch/shop-old' }])
  const dropped = stepsFromInput([
    { text: 'C', status: 'todo', check: { exists: 'a', gone: 'b' } },
    { text: 'D', status: 'todo', check: { exists: '' } },
    { text: 'E', status: 'todo', check: { run: 'rm -rf /' } },
    { text: 'F', status: 'todo', check: 'dist/out.vsix' },
    { text: 'G', status: 'todo', check: { exists: 'a\nb' } },
    { text: 'H', status: 'done', check: { exists: 'x'.repeat(900) } },
  ])
  expect(dropped.map(s => 'check' in s)).toEqual([false, false, false, false, false, false])
})

test('accountSteps: a close must say of every open step that it is finished or not needed, with why, matched by text', () => {
  const row: Row = { id: 'aaaaaa00-0', repo: 'shop', where: '', plan: 'Add checkout', done: 1, total: 3, now: '', updatedAt: 5, steps: [{ text: 'Write it', status: 'done' }, { text: 'Test it', status: 'now' }, { text: 'Tell the team', status: 'todo' }] }
  const ok = accountSteps(row, [{ text: ' test it ', outcome: 'finished', why: 'npm test passes' }, { text: 'Tell the team', outcome: 'not needed', why: 'they were on the call' }, { text: 'Extra', outcome: 'finished', why: 'ignored' }])
  expect(ok).toEqual({ steps: [{ text: 'Test it', outcome: 'finished', why: 'npm test passes' }, { text: 'Tell the team', outcome: 'not needed', why: 'they were on the call' }] })
  const missing = accountSteps(row, [{ text: 'Test it', outcome: 'finished', why: 'npm test passes' }]) as { error: string }
  expect(missing.error).toContain('Tell the team')
  expect(missing.error).not.toContain('Test it')
  expect('error' in accountSteps(row, [{ text: 'Test it', outcome: 'finished', why: '' }, { text: 'Tell the team', outcome: 'not needed', why: 'x' }])).toBe(true)
  expect('error' in accountSteps(row, [{ text: 'Test it', outcome: 'maybe', why: 'y' }, { text: 'Tell the team', outcome: 'not needed', why: 'x' }])).toBe(true)
  expect('error' in accountSteps(row, 'nope')).toBe(true)
  // A row from before step lists has nothing to account for
  expect(accountSteps({ ...row, steps: undefined }, undefined)).toEqual({ steps: [] })
})

test('filesToMigrate: rows, dismissed list and note, not what the new folder has or the cache', () => {
  expect(filesToMigrate(['a.json', 'dismissed.json', 'restart-note.md', 'live.cache', 'panes'], ['a.json'])).toEqual(['dismissed.json', 'restart-note.md'])
})
