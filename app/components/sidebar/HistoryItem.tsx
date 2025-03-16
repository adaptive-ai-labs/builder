import { useParams } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import * as Dialog from '@radix-ui/react-dialog';
import { type ChatHistoryItem } from '~/lib/persistence';
import WithTooltip from '~/components/ui/Tooltip';
import { useEditChatDescription } from '~/lib/hooks';
import { forwardRef, type ForwardedRef } from 'react';

interface HistoryItemProps {
  item: ChatHistoryItem;
  onDelete?: (event: React.UIEvent) => void;
  onDuplicate?: (id: string) => void;
  exportChat: (id?: string) => void;
}

export function HistoryItem({ item, onDelete, onDuplicate, exportChat }: HistoryItemProps) {
  const { id: urlId } = useParams();
  const isActiveChat = urlId === item.urlId;

  const { editing, handleChange, handleBlur, handleSubmit, handleKeyDown, currentDescription, toggleEditMode } =
    useEditChatDescription({
      initialDescription: item.description,
      customChatId: item.id,
      syncWithGlobalStore: isActiveChat,
    });

  return (
    <div
      className={classNames(
        'group rounded-lg text-sm text-blue-600 hover:text-blue-700 bg-white border-2 border-blue-200 overflow-hidden flex justify-between items-center px-3 py-2 transition-colors shadow-sm',
        { 'text-blue-700 bg-blue-50': isActiveChat },
      )}
    >
      {editing ? (
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
          <input
            type="text"
            className="flex-1 bg-white text-blue-600 rounded-md px-3 py-1.5 text-sm border border-blue-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            autoFocus
            value={currentDescription}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
          <button
            type="submit"
            className="i-ph:check h-4 w-4 text-blue-500 hover:text-blue-600 transition-colors"
            onMouseDown={handleSubmit}
          />
        </form>
      ) : (
        <a href={`/chat/${item.urlId}`} className="flex w-full relative truncate block">
          <WithTooltip tooltip={currentDescription}>
            <span className="truncate pr-24">{currentDescription}</span>
          </WithTooltip>
          <div
            className={classNames(
              'absolute right-0 top-0 bottom-0 flex items-center bg-white group-hover:bg-blue-50 px-2',
              { 'bg-blue-50': isActiveChat },
            )}
          >
            <div className="flex items-center gap-2.5 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
              <ChatActionButton
                toolTipContent="Export"
                icon="i-ph:download-simple h-4 w-4"
                onClick={(event) => {
                  event.preventDefault();
                  exportChat(item.id);
                }}
              />
              {onDuplicate && (
                <ChatActionButton
                  toolTipContent="Duplicate"
                  icon="i-ph:copy h-4 w-4"
                  onClick={() => onDuplicate?.(item.id)}
                />
              )}
              <ChatActionButton
                toolTipContent="Rename"
                icon="i-ph:pencil-fill h-4 w-4"
                onClick={(event) => {
                  event.preventDefault();
                  toggleEditMode();
                }}
              />
              <Dialog.Trigger asChild>
                <ChatActionButton
                  toolTipContent="Delete"
                  icon="i-ph:trash h-4 w-4"
                  className="hover:text-red-500"
                  onClick={(event) => {
                    event.preventDefault();
                    onDelete?.(event);
                  }}
                />
              </Dialog.Trigger>
            </div>
          </div>
        </a>
      )}
    </div>
  );
}

const ChatActionButton = forwardRef(
  (
    {
      toolTipContent,
      icon,
      className,
      onClick,
    }: {
      toolTipContent: string;
      icon: string;
      className?: string;
      onClick: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
      btnTitle?: string;
    },
    ref: ForwardedRef<HTMLButtonElement>,
  ) => {
    return (
      <WithTooltip tooltip={toolTipContent} position="bottom" sideOffset={4}>
        <button
          ref={ref}
          type="button"
          className={`text-blue-400 hover:text-blue-600 transition-colors ${icon} ${className ? className : ''}`}
          onClick={onClick}
        />
      </WithTooltip>
    );
  },
);
