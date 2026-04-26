import Link from 'next/link';
import Buddy from './components/Buddy';
import InstallButton from './components/InstallButton';
import OverlayButton from './components/OverlayButton';

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-zinc-50 via-violet-50 to-fuchsia-50 font-sans dark:from-zinc-950 dark:via-violet-950/30 dark:to-zinc-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(139,92,246,0.15),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(236,72,153,0.12),transparent_50%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-10 px-8 py-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/60 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur dark:border-violet-500/30 dark:bg-zinc-900/60 dark:text-violet-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
          vibemoji · code buddy preview
        </div>

        <h1 className="max-w-2xl text-5xl font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-6xl">
          your friendly{' '}
          <span className="bg-gradient-to-r from-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
            agent buddy
          </span>
          , floating right where you work.
        </h1>

        <p className="max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          vibemoji sits on top of your desktop, watching what your AI agents are
          doing on your behalf. it talks back in chat bubbles, taps you on the
          shoulder with toasts, and stays out of the way otherwise.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <InstallButton />
          <OverlayButton />
          <Link
            href="/manage"
            className="rounded-full border border-violet-200 bg-white/70 px-4 py-2 text-sm font-medium text-violet-700 backdrop-blur transition-colors hover:border-violet-300 hover:bg-white dark:border-violet-500/30 dark:bg-zinc-900/60 dark:text-violet-300 dark:hover:border-violet-400/50"
          >
            manage avatars
          </Link>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">free · ~40&nbsp;MB · auto-detects your OS</span>
        </div>

        <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
          <Capability emoji="●" title="floating avatar" body="drag the buddy anywhere on screen. swap the avatar to whatever vibe matches your day." />
          <Capability emoji="●" title="chat bubbles" body="click to talk. ask what your agents are up to or kick off a new task." />
          <Capability emoji="●" title="toast pings" body="quietly surfaces PRs ready for review and moments that need your input." />
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white/70 p-5 text-sm text-zinc-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">try it →</p>
          <p className="mt-1">click the buddy in the bottom-right. drag it around. hit <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-xs text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">ping</span> to fire a toast.</p>
        </div>
      </main>

      <Buddy />
    </div>
  );
}

function Capability({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 backdrop-blur transition-colors hover:border-violet-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-violet-500/40">
      <div className="text-lg text-violet-500">{emoji}</div>
      <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>
    </div>
  );
}
