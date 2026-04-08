import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Conversation, Message, Model } from '@shared/types';
import { useInsertMessageMutation } from './messageService';

function messageInsertedUpdate(
  queryClient: ReturnType<typeof useQueryClient>,
  message: Message,
  conversationId: string,
) {
  queryClient.setQueryData(
    ['conversation', conversationId],
    (old: Conversation | undefined) =>
      old
        ? {
            ...old,
            current_message_leaf_id: message.id,
            updated_at: message.created_at,
          }
        : old,
  );
}

export function useAgentLoopMutation({
  conversationId,
}: {
  conversationId: string;
}) {
  const queryClient = useQueryClient();
  const { mutateAsync: insertMessageAsync } = useInsertMessageMutation();

  return useMutation({
    mutationKey: ['agent-loop', conversationId],
    mutationFn: async ({
      model,
      messageId,
      conversationId,
    }: {
      model: Model;
      messageId: string;
      conversationId: string;
    }) => {
      const newMessageId = crypto.randomUUID();
      let initialized = false;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-loop`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${
              (await supabase.auth.getSession()).data.session?.access_token
            }`,
          },
          body: JSON.stringify({
            conversationId,
            messageId,
            model,
            newMessageId,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Network error: ${response.status} ${response.statusText}`,
        );
      }

      if (response.headers.get('Content-Type')?.includes('application/json')) {
        const data = await response.json();
        if (data.message) return data.message;
        throw new Error('No message received');
      }

      async function initialize() {
        await queryClient.cancelQueries({
          queryKey: ['conversation', conversationId],
        });
        queryClient.setQueryData(
          ['conversation', conversationId],
          (old: Conversation) => ({
            ...old,
            current_message_leaf_id: newMessageId,
          }),
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let leftover = '';
      let finalMessage: Message | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          leftover += decoder.decode(value, { stream: true });
          const lines = leftover.split('\n');
          leftover = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            try {
              const data: Message = JSON.parse(line);
              finalMessage = data;

              queryClient.setQueryData(
                ['messages', conversationId],
                (old: Message[] | undefined) => {
                  if (!old || old.length === 0) return [data];
                  if (old.find((m) => m.id === data.id)) {
                    return old.map((m) => (m.id === data.id ? data : m));
                  }
                  return [...old, data];
                },
              );

              if (!initialized) {
                await initialize();
                initialized = true;
              }
            } catch (_) {
              // ignore parse errors
            }
          }
        }

        // Flush remaining
        const tail = (leftover + decoder.decode()).trim();
        if (tail) {
          try {
            const data: Message = JSON.parse(tail);
            finalMessage = data;
            queryClient.setQueryData(
              ['messages', conversationId],
              (old: Message[] | undefined) => {
                if (!old || old.length === 0) return [data];
                if (old.find((m) => m.id === data.id)) {
                  return old.map((m) => (m.id === data.id ? data : m));
                }
                return [...old, data];
              },
            );
          } catch (_) {
            // ignore
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!finalMessage) throw new Error('No final message received');
      return finalMessage;
    },

    onSuccess: (newMessage) => {
      messageInsertedUpdate(queryClient, newMessage, conversationId);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['userExtraData'] });
    },

    onError: async (_error, { messageId }) => {
      try {
        await insertMessageAsync({
          role: 'assistant',
          content: { text: 'An error occurred. Please try again.' },
          parent_message_id: messageId,
          conversation_id: conversationId,
        });
      } catch (_) {
        // ignore
      }
    },
  });
}
