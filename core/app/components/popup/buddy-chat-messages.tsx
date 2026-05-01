import type { RefObject } from 'react';
import type { ChatMsg } from '../avatar/avatar-instance.types';

type Props = {
  messages: ChatMsg[];
  greeting: string;
  busy: boolean;
  messagesRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  onStickinessChange: (stuck: boolean) => void;
};

export default function BuddyChatMessages({ messages, greeting, busy, messagesRef, endRef, onStickinessChange }: Props) {
  return (
    <div
      ref={messagesRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        onStickinessChange(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
      }}
      className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3"
    >
      {messages.length === 0 && (
        <div className="flex justify-start">
          <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
            {greeting}
          </div>
        </div>
      )}
      {messages.map((message) => (
        <div key={message.id} className={`flex ${message.from === 'you' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
            message.from === 'you'
              ? 'bg-violet-600 text-white'
              : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
          }`}>
            {message.text || (busy && message.from === 'buddy' ? '...' : '')}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
