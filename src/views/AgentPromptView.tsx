import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { Content, Model } from '@shared/types';
import { SelectedItemsContext } from '@/contexts/SelectedItemsContext';
import { MessageItem } from '../types/misc.ts';
import TextAreaChat from '@/components/TextAreaChat';
import { LimitReachedMessage } from '@/components/LimitReachedMessage';

export function AgentPromptView() {
  const navigate = useNavigate();
  const { user, totalTokens } = useAuth();
  const queryClient = useQueryClient();
  const [images, setImages] = useState<MessageItem[]>([]);
  const [mesh, setMesh] = useState<MessageItem | null>(null);
  const [model, setModel] = useState<Model>('quality');

  const newConversationId = useMemo(() => crypto.randomUUID(), []);

  const { mutate: createAndNavigate, isPending } = useMutation({
    mutationFn: async (content: Content) => {
      const { data: conversation, error } = await supabase
        .from('conversations')
        .insert([
          {
            id: newConversationId,
            user_id: user?.id ?? '',
            title: 'New Agent Session',
            type: 'parametric',
            settings: { model: content.model ?? model },
          },
        ])
        .select()
        .single();

      if (error) throw error;

      supabase.functions
        .invoke('title-generator', {
          body: { content, conversationId: conversation.id },
        })
        .then(({ data: titleData, error: titleError }) => {
          if (!titleError && titleData?.title) {
            supabase
              .from('conversations')
              .update({ title: titleData.title })
              .eq('id', conversation.id)
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['conversations'] });
              });
          }
        });

      return { conversationId: conversation.id, content };
    },
    onSuccess: ({ conversationId, content }) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate(`/agent/${conversationId}`, {
        state: { initialContent: content },
      });
    },
  });

  const fakeConversation = useMemo(
    () => ({ id: newConversationId, user_id: user?.id ?? '' }),
    [newConversationId, user?.id],
  );

  return (
    <SelectedItemsContext.Provider value={{ images, setImages, mesh, setMesh }}>
      <div className="flex h-full w-full flex-col items-center justify-center bg-adam-bg-secondary-dark px-4">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-adam-blue/30 bg-adam-blue/10">
            <Cpu className="h-7 w-7 text-adam-blue" />
          </div>
          <h1 className="text-2xl font-semibold text-adam-neutral-100">
            Hardware Agent
          </h1>
          <p className="max-w-md text-sm text-adam-neutral-400">
            Describe your hardware project. The agent will search component
            specs, generate a CAD enclosure, and analyze images — all in one
            loop.
          </p>
        </div>

        <div className="w-full max-w-2xl">
          {totalTokens <= 0 ? (
            <LimitReachedMessage />
          ) : (
            <TextAreaChat
              type="parametric"
              model={model}
              setModel={setModel}
              conversation={fakeConversation}
              onSubmit={createAndNavigate}
              isLoading={isPending}
              disabled={isPending}
            />
          )}
        </div>
      </div>
    </SelectedItemsContext.Provider>
  );
}
