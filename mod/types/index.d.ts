export type StepStatus = 'done' | 'now' | 'todo'
export type Step = { text: string; status: StepStatus; detail?: string }
export type Questlog = {
  repo: string
  branch: string
  slug: string
  plan: string
  topic: string
  steps: Step[]
  updatedAt: number
  // When the session last spoke for itself; working out where it is on reopening moves updatedAt only
  reportedAt?: number
  // The tab title last handed to the host; the sidebar matches the active tab's label to it
  shownTitle?: string
  // The plan or topic the session tag was added under; a new name drops the tag unless it clashes too
  taggedName?: string
  // A prompt is being worked on; still set in the row of a session that died mid-turn
  inTurn?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'questlog': { questlog: Questlog; isHidden: boolean }
  }
}
