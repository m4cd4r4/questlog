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
  // The tab title last handed to the host; the sidebar matches the active tab's label to it
  shownTitle?: string
  // The plan or topic the session tag was added under; a new name drops the tag unless it clashes too
  taggedName?: string
}

declare module 'claude-code' {
  interface PluginState {
    'questlog': { questlog: Questlog; isHidden: boolean }
  }
}
