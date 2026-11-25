// Worktrees that no plan names but that are plainly steps of one piece of work ("pricing-s1", "pricing-s2"):
// the step rule and the grouping. Pure, no vscode import. A sequence is worked out when the view is built
// and is never written to the cache or the registry.
import { byName, sameName, type RowVerdict } from "./listing.ts";

/** The closed list of step words. `s` counts only glued to its number ("s1"); the others also as the next part ("phase-2"). */
export const STEP_WORDS = ["s", "slice", "step", "wave", "phase", "round", "part", "stage"] as const;
export type StepWord = (typeof STEP_WORDS)[number];

/** A word from the list glued to one to three digits: "s1", "wave3", "Phase02". */
const GLUED = new RegExp(`^(${STEP_WORDS.join("|")})(\\d{1,3})$`, "i");
/** A word from the list, bar `s`, standing alone: its number is the next part. */
const WORD = new RegExp(`^(${STEP_WORDS.filter((w) => w !== "s").join("|")})$`, "i");
const NUMBER = /^\d{1,3}$/;
/** What parts a name: a dash, an underscore or a slash. */
const PART = /[-_/]+/;

export type Step = {
  /** What comes before the step, as it is spelled, parts joined by a dash: "pricing". Never empty. */
  prefix: string;
  word: StepWord;
  n: number;
  /** The step in words: "s1", "wave 3", "phase 2". */
  step: string;
};

const stepText = (word: StepWord, n: number) => (word === "s" ? `s${n}` : `${word} ${n}`);

/**
 * The first step in `name` that has something before it, or nothing. Never a step: a bare number ("sc-300",
 * "2026-09-14"), a single letter ("feature-a"), "v2", a number of four digits or more ("wave2026").
 */
export const stepOf = (name: string): Step | undefined => {
  const parts = name.split(PART).filter((p) => p !== "");
  for (let i = 1; i < parts.length; i++) {
    const glued = GLUED.exec(parts[i]);
    const spaced = !glued && WORD.test(parts[i]) && NUMBER.test(parts[i + 1] ?? "");
    if (!glued && !spaced) continue;
    const word = (glued ? glued[1] : parts[i]).toLowerCase() as StepWord;
    const n = Number(glued ? glued[2] : parts[i + 1]);
    return { prefix: parts.slice(0, i).join("-"), word, n, step: stepText(word, n) };
  }
  return undefined;
};

/** A branch with its first `type/` part dropped: "feat/pricing-s1" reads "pricing-s1". */
export const branchName = (branch: string): string => {
  const cut = branch.indexOf("/");
  return cut === -1 ? branch : branch.slice(cut + 1);
};

/** A folder's slug with the repo's name dropped from the front: "acme-app-pricing-s1" under acme-app reads "pricing-s1". */
export const slugName = (slug: string, repoName: string): string => {
  const cutAt = repoName.length + 1;
  return repoName && slug.length > cutAt && sameName(slug.slice(0, cutAt), `${repoName}-`) ? slug.slice(cutAt) : slug;
};

export type SequenceMember = { path: string; slug: string; branch: string; detached?: boolean; verdict: RowVerdict; label: string };

/** The step a worktree is on: from its branch, and from its folder when the branch has no step or HEAD is detached. */
export const stepOfWorktree = (w: Pick<SequenceMember, "slug" | "branch" | "detached">, repoName: string): Step | undefined =>
  (!w.detached && w.branch ? stepOf(branchName(w.branch)) : undefined) ?? stepOf(slugName(w.slug, repoName));

/** One step of a sequence: a worktree, by its path, with the verdict its row shows. */
export type SequenceStep = { step: string; path: string; verdict: RowVerdict; label: string };

/** Two or more worktrees of one repo on steps of the same prefix and word, in step order. */
export type Sequence = { name: string; steps: SequenceStep[] };

/**
 * The sequences among one repo's worktrees. Same prefix and same word, letter case ignored; "slice13" and
 * "wave4" under one prefix are not one sequence. Steps are in number order (s2 before s10), then by slug;
 * a gap is fine, and two worktrees on one step are both listed. A lone step is no sequence.
 */
export const sequencesOf = (members: readonly SequenceMember[], repoName: string): Sequence[] => {
  const groups = new Map<string, { name: string; word: StepWord; items: { w: SequenceMember; s: Step }[] }>();
  for (const w of members) {
    const s = stepOfWorktree(w, repoName);
    if (!s) continue;
    const key = `${s.prefix.toLowerCase()}\n${s.word}`;
    const g = groups.get(key) ?? { name: s.prefix, word: s.word, items: [] };
    g.items.push({ w, s });
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.items.length >= 2)
    .sort((a, b) => byName(a.name, b.name) || byName(a.word, b.word))
    .map((g) => ({
      name: g.name,
      steps: g.items
        .sort((a, b) => a.s.n - b.s.n || byName(a.w.slug, b.w.slug))
        .map(({ w, s }): SequenceStep => ({ step: s.step, path: w.path, verdict: w.verdict, label: w.label })),
    }));
};
