import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleNotch } from '@phosphor-icons/react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Content, Conversation, Message } from '@shared/types';
import { useAuth } from '@/contexts/AuthContext';
import { ConversationContext } from '@/contexts/ConversationContext';
import { CurrentMessageContext } from '@/contexts/CurrentMessageContext';
import { SelectedItemsContext } from '@/contexts/SelectedItemsContext';
import { useConversation } from '@/contexts/ConversationContext';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import {
  useInsertMessageMutation,
  useMessagesQuery,
} from '@/services/messageService';
import { useAgentLoopMutation } from '@/services/agentService';
import { AgentChatSection } from '@/components/agent/AgentChatSection';
import { AgentPreviewSection } from '@/components/agent/AgentPreviewSection';
import { MessageItem } from '../types/misc.ts';

function AgentEditorInner() {
  const { conversation } = useConversation();
  const { setCurrentMessage } = useCurrentMessage();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [_currentOutput, setCurrentOutput] = useState<Blob | undefined>();
  const [color] = useState('#00A6FF');
  const [images, setImages] = useState<MessageItem[]>([]);
  const [mesh, setMesh] = useState<MessageItem | null>(null);
  const autoSentRef = useRef(false);

  const { mutateAsync: insertMessageAsync } = useInsertMessageMutation();

  const { mutate: runAgentLoop, isPending: isAgentRunning } =
    useAgentLoopMutation({ conversationId: conversation.id });

  const { data: messages = [] } = useMessagesQuery();

  const lastAssistantMessage = useMemo(() => {
    const assistants = messages.filter((m) => m.role === 'assistant');
    return assistants[assistants.length - 1] ?? null;
  }, [messages]);

  useEffect(() => {
    if (lastAssistantMessage) {
      setCurrentMessage(lastAssistantMessage);
    }
  }, [lastAssistantMessage, setCurrentMessage]);

  const handleSendMessage = useCallback(
    async (content: Content) => {
      const userMessage = await insertMessageAsync({
        role: 'user',
        content,
        parent_message_id: conversation.current_message_leaf_id ?? null,
        conversation_id: conversation.id,
      });

      runAgentLoop({
        model: content.model ?? conversation.settings?.model ?? 'quality',
        messageId: userMessage.id,
        conversationId: conversation.id,
      });

      if (!messages.length) {
        supabase.functions
          .invoke('title-generator', {
            body: { content, conversationId: conversation.id },
          })
          .then(({ data: titleData, error }) => {
            if (!error && titleData?.title) {
              supabase
                .from('conversations')
                .update({ title: titleData.title })
                .eq('id', conversation.id)
                .then(() => {
                  queryClient.invalidateQueries({
                    queryKey: ['conversations'],
                  });
                  queryClient.setQueryData(
                    ['conversation', conversation.id],
                    (old: Conversation | undefined) =>
                      old ? { ...old, title: titleData.title } : old,
                  );
                });
            }
          });
      }
    },
    [
      conversation,
      insertMessageAsync,
      runAgentLoop,
      messages.length,
      queryClient,
    ],
  );

  // Auto-send first message if navigated from AgentPromptView
  useEffect(() => {
    const initialContent = location.state?.initialContent as
      | Content
      | undefined;
    if (initialContent && !autoSentRef.current) {
      autoSentRef.current = true;
      handleSendMessage(initialContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SelectedItemsContext.Provider value={{ images, setImages, mesh, setMesh }}>
      <PanelGroup
        direction="horizontal"
        className="h-full w-full"
        autoSaveId="agent-panels"
      >
        <Panel
          defaultSize={35}
          minSize={25}
          maxSize={50}
          id="agent-chat"
          order={0}
        >
          <AgentChatSection
            messages={messages}
            isLoading={isAgentRunning}
            onSendMessage={handleSendMessage}
          />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel defaultSize={65} minSize={40} id="agent-preview" order={1}>
          <AgentPreviewSection
            color={color}
            isLoading={isAgentRunning}
            onOutputChange={setCurrentOutput}
          />
        </Panel>
      </PanelGroup>
    </SelectedItemsContext.Provider>
  );
}

export default function AgentView() {
  const { id: conversationId } = useParams();
  const { user } = useAuth();
  const [currentMessage, setCurrentMessage] = useState<Message | null>(null);
  const navigate = useNavigate();

  const { mutate: updateConversation, mutateAsync: updateConversationAsync } =
    useMutation({
      mutationFn: async (conv: Conversation) => {
        const { data, error } = await supabase
          .from('conversations')
          .update(conv)
          .eq('id', conv.id)
          .select()
          .single()
          .overrideTypes<Conversation>();
        if (error) throw error;
        return data;
      },
    });

  const { data: conversation, isLoading: isConversationLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      if (!conversationId) throw new Error('Conversation ID is required');
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', user?.id ?? '')
        .limit(1)
        .single();
      if (error) throw error;
      return data as Conversation;
    },
  });

  useEffect(() => {
    if (!conversationId) navigate('/');
  }, [conversationId, navigate]);

  if (isConversationLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <CircleNotch className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <span className="text-2xl font-medium">404</span>
        <span className="text-sm">Conversation not found</span>
      </div>
    );
  }

  return (
    <CurrentMessageContext.Provider
      value={{ currentMessage, setCurrentMessage }}
    >
      <ConversationContext.Provider
        value={{ conversation, updateConversation, updateConversationAsync }}
      >
        <AgentEditorInner />
      </ConversationContext.Provider>
    </CurrentMessageContext.Provider>
  );
}
