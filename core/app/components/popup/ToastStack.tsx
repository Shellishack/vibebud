import { createPortal } from 'react-dom';
import type { Toast } from '../avatar/avatar-instance.types';

type Props = {
  toasts: Toast[];
  isMobile: boolean;
};

export default function ToastStack({ toasts, isMobile }: Props) {
  if (toasts.length === 0) return null;
  const content = (
    <div className={isMobile
      ? 'pointer-events-none fixed left-3 right-3 bottom-36 z-[60] flex flex-col gap-2'
      : 'pointer-events-none absolute bottom-full right-0 mb-3 flex w-80 flex-col gap-2'
    }>
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
  if (isMobile && typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}

function ToastCard({ toast }: { toast: Toast }) {
  return (
    <div
      data-buddy-interactive
      className={`pointer-events-auto rounded-2xl border bg-white/95 p-4 shadow-xl backdrop-blur-md transition-all dark:bg-zinc-900/95 ${
        toast.tone === 'action' ? 'border-violet-300 dark:border-violet-500/50'
        : toast.tone === 'success' ? 'border-emerald-300 dark:border-emerald-500/50'
        : 'border-zinc-200 dark:border-zinc-700'
      }`}
      style={{ animation: 'buddy-toast-in 240ms ease-out' }}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
          toast.tone === 'action' ? 'bg-violet-500' : toast.tone === 'success' ? 'bg-emerald-500' : 'bg-zinc-400'
        }`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{toast.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{toast.body}</p>
        </div>
      </div>
    </div>
  );
}
