import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className={classNames('flex items-center p-5 border-b h-[var(--header-height)] bg-white', {
        'border-transparent': !chat.started,
        'border-gray-200': chat.started,
      })}
    >
      <div className="flex items-center gap-2 z-logo text-gray-800 cursor-pointer">
        <div className="i-ph:sidebar-simple-duotone text-xl" />
        <a href="/" className="text-xl font-semibold text-accent flex items-center justify-center gap-2">
          <img src="/AIFirstLogo.png" alt="logo" className="w-[40px] inline-block" />
          <span className="text-blue-800 font-bold text-lg">Generatives</span>
        </a>
      </div>
      {chat.started && ( // Display ChatDescription and HeaderActionButtons only when the chat has started.
        <>
          <span className="flex-1 px-4 truncate text-center text-gray-800">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          <ClientOnly>
            {() => (
              <div className="mr-1">
                <HeaderActionButtons />
              </div>
            )}
          </ClientOnly>
        </>
      )}
    </header>
  );
}
