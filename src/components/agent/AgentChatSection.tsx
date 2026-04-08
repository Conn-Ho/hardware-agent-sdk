import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Content, Message, Model } from '@shared/types';
import TextAreaChat from '@/components/TextAreaChat';
import { useAuth } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { AssistantLoading } from '@/components/chat/AssistantLoading';
import { UserMessage } from '@/components/chat/UserMessage';
import { AgentStepList } from './AgentStepList';
import { Avatar, AvatarImage } from '@/components/ui/avatar';
import { LimitReachedMessage } from '@/components/LimitReachedMessage';
import { TreeNode } from '@shared/Tree';

interface AgentChatSectionProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (content: Content) => void;
  stopGenerating?: () => void;
}

function toTreeNode(msg: Message): TreeNode<Message> {
  return {
    ...msg,
    children: [],
    parent: null,
    get siblings() {
      return [];
    },
  };
}

export function AgentChatSection({
  messages,
  isLoading,
  onSendMessage,
  stopGenerating,
}: AgentChatSectionProps) {
  const { totalTokens } = useAuth();
  const { conversation } = useConversation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState<Model>('quality');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoading]);

  const lastUserMessageId = [...messages]
    .reverse()
    .find((m) => m.role === 'user')?.id;

  const handleSend = useCallback(
    (content: Content) => {
      if (!isLoading && totalTokens > 0) {
        onSendMessage({ ...content, model });
      }
    },
    [isLoading, totalTokens, onSendMessage, model],
  );

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="space-y-4 px-4 pb-4 pt-6">
          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <UserMessage
                  key={msg.id}
                  message={toTreeNode(msg)}
                  isLoading={isLoading && msg.id === lastUserMessageId}
                />
              );
            }

            // Assistant message
            const toolCalls = msg.content.toolCalls ?? [];
            const hasText = !!msg.content.text;
            const hasError = !!msg.content.error;

            return (
              <div key={msg.id} className="flex gap-3">
                <Avatar className="mt-1 h-7 w-7 shrink-0">
                  <AvatarImage
                    src={`${import.meta.env.BASE_URL}adam-logo.svg`}
                    alt="Agent"
                    className="h-full w-full object-contain p-1"
                  />
                </Avatar>
                <div className="flex-1 space-y-1 pt-0.5">
                  <AgentStepList toolCalls={toolCalls} />
                  {hasText && (
                    <p className="text-sm leading-relaxed text-adam-neutral-100">
                      {msg.content.text}
                    </p>
                  )}
                  {hasError && (
                    <p className="text-xs text-red-400">
                      {msg.content.error === 'insufficient_tokens'
                        ? 'Not enough tokens.'
                        : msg.content.error}
                    </p>
                  )}
                  {msg.content.artifact && !hasText && !toolCalls.length && (
                    <p className="text-sm text-adam-neutral-300">
                      ✓ Model generated:{' '}
                      <span className="font-medium text-adam-neutral-100">
                        {msg.content.artifact.title}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {isLoading &&
            !messages.some(
              (m) => m.role === 'assistant' && m.content.toolCalls?.length,
            ) && <AssistantLoading />}
        </div>
        <div ref={bottomRef} />
      </ScrollArea>

      <div className="border-t border-adam-neutral-700 p-3">
        {totalTokens <= 0 ? (
          <LimitReachedMessage />
        ) : (
          <TextAreaChat
            type="parametric"
            model={model}
            setModel={setModel}
            conversation={{
              id: conversation.id,
              user_id: conversation.user_id,
            }}
            onSubmit={handleSend}
            isLoading={isLoading}
            disabled={isLoading}
            stopGenerating={stopGenerating}
          />
        )}
      </div>
    </div>
  );
}
