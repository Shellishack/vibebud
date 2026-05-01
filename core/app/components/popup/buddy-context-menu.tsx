import { createPortal } from 'react-dom';
import type { PlatformAdapter } from '@/lib/platform/types';

type MenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
};

type Props = {
  position: { x: number; y: number } | null;
  open: boolean;
  canRemove: boolean;
  adapter: PlatformAdapter;
  onClose: () => void;
  onToggleChat: () => void;
  onOpenDetails: () => void;
  onOpenAppSettings?: () => void;
  onSpawn: () => void;
  onRemove: () => void;
};

export default function BuddyContextMenu({
  position,
  open,
  canRemove,
  adapter,
  onClose,
  onToggleChat,
  onOpenDetails,
  onOpenAppSettings,
  onSpawn,
  onRemove,
}: Props) {
  if (!position || typeof document === 'undefined') return null;
  const items: MenuItem[] = [
    { label: open ? 'Close chat' : 'Open chat', onClick: onToggleChat },
    ...(adapter.showPairingWindow ? [{ label: 'Pair phone...', onClick: () => adapter.showPairingWindow?.() }] : []),
    { label: 'Sign in', onClick: () => onOpenAppSettings?.() },
    { label: 'App settings...', onClick: () => onOpenAppSettings?.() },
    { label: 'Buddy details...', onClick: onOpenDetails },
    { label: 'Add buddy', onClick: onSpawn },
    ...(canRemove ? [{ label: 'Remove buddy', onClick: onRemove, danger: true }] : []),
  ];
  return createPortal(
    <>
      <div
        data-buddy-interactive
        className="fixed inset-0 z-[70]"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        data-buddy-interactive
        className="fixed z-[71] min-w-[180px] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        style={{
          left: Math.min(position.x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 200),
          top: Math.min(position.y, (typeof window !== 'undefined' ? window.innerHeight : 9999) - 240),
        }}
      >
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={`block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              item.danger ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
