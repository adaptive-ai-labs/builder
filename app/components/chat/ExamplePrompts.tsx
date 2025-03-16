import React from 'react';
import { useTranslation } from 'react-i18next';

const EXAMPLE_PROMPT_KEYS = [
  'examplePrompts.todoApp',
  'examplePrompts.blog',
  'examplePrompts.cookieConsent',
  'examplePrompts.spaceInvaders',
  'examplePrompts.ticTacToe',
];

export function ExamplePrompts(sendMessage?: { (event: React.UIEvent, messageInput?: string): void | undefined }) {
  const { t } = useTranslation('common', { useSuspense: false });
  return (
    <div id="examples" className="relative flex flex-col gap-9 w-full max-w-3xl mx-auto flex justify-center mt-6">
      <div
        className="flex flex-wrap justify-center gap-2"
        style={{
          animation: '.25s ease-out 0s 1 _fade-and-move-in_g2ptj_1 forwards',
        }}
      >
        {EXAMPLE_PROMPT_KEYS.map((promptKey, index: number) => {
          return (
            <button
              key={index}
              onClick={(event) => {
                sendMessage?.(event, t(promptKey));
              }}
              className="border border-blue-500 rounded-full bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 text-xs transition-theme"
            >
              {t(promptKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
