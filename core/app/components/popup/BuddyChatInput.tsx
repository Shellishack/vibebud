type Props = {
  value: string;
  disabled: boolean;
  placeholder: string;
  onChange: (next: string) => void;
  onSend: () => void;
  onStop: () => void;
};

export default function BuddyChatInput({ value, disabled, placeholder, onChange, onSend, onStop }: Props) {
  return (
    <div className="border-t border-zinc-200 p-2 dark:border-zinc-700">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-violet-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        {disabled ? (
          <button
            onClick={onStop}
            className="rounded-full bg-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
          >
            stop
          </button>
        ) : (
          <button
            onClick={onSend}
            className="rounded-full bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            send
          </button>
        )}
      </div>
    </div>
  );
}
