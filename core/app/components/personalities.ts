export type Personality = {
  variantId: string;
  name: string;
  greeting: string;
  replies: string[];
};

export const PERSONALITIES: Personality[] = [
  {
    variantId: 'violet',
    name: 'Helper',
    greeting: "hi! I'm Helper. ask me anything, or watch the toasts roll in.",
    replies: [
      "I'm watching 3 repos right now. Issue #42 is in progress.",
      "I can dispatch an agent on any open issue — just tell me which one.",
      "Last PR I shipped passed all checks. Want me to merge?",
      "I'll ping you the moment something needs your eyes.",
    ],
  },
  {
    variantId: 'mint',
    name: 'Tactician',
    greeting: "Tactician here. let's break the work into the right next move.",
    replies: [
      "Two issues are blocking each other. Want me to sequence them?",
      "If we ship #118 first, #42 unblocks two contributors.",
      "I'd hold that PR until CI runs flake-detection — five minutes.",
      "Smallest unit of progress: rebase, run tests, then revisit scope.",
    ],
  },
  {
    variantId: 'peach',
    name: 'Researcher',
    greeting: "Researcher reporting. what should I dig into for you?",
    replies: [
      "Pulled up three prior PRs that touched this file — patterns are mixed.",
      "I found two issues that look like duplicates of #42. Linking them.",
      "Reading the migration notes now — there's a footgun on line 88.",
      "There's a draft RFC from last quarter that proposed exactly this.",
    ],
  },
  {
    variantId: 'midnight',
    name: 'Skeptic',
    greeting: "Skeptic. before we ship, let's make sure we actually want this.",
    replies: [
      "Are we sure that's the bug, or just the closest reproducible symptom?",
      "What happens to existing users on the older schema? I haven't seen a plan.",
      "The tests pass, but they don't cover the empty-state path. Worth a look.",
      "I'd want one more reviewer before merging that one.",
    ],
  },
  {
    variantId: 'sunshine',
    name: 'Cheerleader',
    greeting: "hey hey! Cheerleader here — you're doing great. what's next?",
    replies: [
      "Nice — that PR is clean. Ship it!",
      "The tests went green, I'm so proud of you and the agents.",
      "Three issues closed this week 🎉 (no, I won't stop counting).",
      "Whatever you pick next, I'm rooting for you.",
    ],
  },
  {
    variantId: 'rose',
    name: 'Empath',
    greeting: "Empath here. how are you feeling about the work today?",
    replies: [
      "It's fine to push that one to tomorrow. The repo will be here.",
      "Want me to draft a kind comment to the contributor on #103?",
      "That review felt sharp — I'd soften the second paragraph if you want.",
      "Take five. The agents will keep working while you breathe.",
    ],
  },
];

export const PERSONALITY_BY_VARIANT: Record<string, Personality> = Object.fromEntries(
  PERSONALITIES.map((p) => [p.variantId, p])
);

export function nextUnusedPersonality(takenVariantIds: string[]): Personality {
  const free = PERSONALITIES.filter((p) => !takenVariantIds.includes(p.variantId));
  const pool = free.length ? free : PERSONALITIES;
  return pool[Math.floor(Math.random() * pool.length)];
}
