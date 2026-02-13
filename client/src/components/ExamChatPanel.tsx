import { useState, useEffect, useRef } from 'react';
import { socket } from '../services/socket';
import { chatApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { ChatMessage } from '../types';

interface ExamChatPanelProps {
  examId: string;
  isProfessor?: boolean;
}

export default function ExamChatPanel({ examId, isProfessor = false }: ExamChatPanelProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load messages on mount
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const response = await chatApi.getMessages(examId);
        setMessages(response.data);
      } catch (error) {
        console.error('Failed to load chat messages:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();
  }, [examId]);

  // Listen for real-time chat updates
  useEffect(() => {
    const handleChatUpdate = (msg: ChatMessage) => {
      if (msg.examId !== examId) return;

      setMessages(prev => {
        // Check if message already exists (update it)
        const existingIndex = prev.findIndex(m => m.messageId === msg.messageId);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = msg;
          return updated;
        }
        // Add new message
        return [...prev, msg];
      });
    };

    socket.on('chat_update', handleChatUpdate);

    return () => {
      socket.off('chat_update', handleChatUpdate);
    };
  }, [examId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || isSending) return;

    setIsSending(true);
    try {
      // Use socket for real-time delivery
      socket.emit('chat_message', { examId, message: newMessage.trim() });
      setNewMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleReply = async () => {
    if (!replyingTo || !replyText.trim() || isSending) return;

    setIsSending(true);
    try {
      socket.emit('chat_reply', {
        examId,
        messageId: replyingTo.messageId,
        replyMessage: replyText.trim()
      });
      setReplyingTo(null);
      setReplyText('');
    } catch (error) {
      console.error('Failed to reply:', error);
    } finally {
      setIsSending(false);
    }
  };

  const pendingMessages = messages.filter(m => m.status === 'pending');
  const approvedMessages = messages.filter(m => m.status === 'approved');

  // For students, show approved messages + their own pending messages
  const visibleMessages = isProfessor
    ? messages
    : messages.filter(m => m.status === 'approved' || m.senderId === user?.id);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
  };

  if (isMinimized) {
    return (
      <div
        className="fixed bottom-4 left-4 z-50 bg-indigo-600 text-white px-4 py-3 rounded-xl shadow-lg shadow-indigo-500/20 cursor-pointer hover:bg-indigo-500 hover:shadow-indigo-500/40 transition-all flex items-center gap-2"
        onClick={() => setIsMinimized(false)}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span>Chat</span>
        {isProfessor && pendingMessages.length > 0 && (
          <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
            {pendingMessages.length}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-80 bg-zinc-900/80/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-zinc-800/80 flex flex-col max-h-96">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-950/90 rounded-t-2xl border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="font-medium text-white">Exam Chat</span>
          {isProfessor && pendingMessages.length > 0 && (
            <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
              {pendingMessages.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setIsMinimized(true)}
          className="text-zinc-400 hover:text-white"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-48 max-h-64">
        {isLoading ? (
          <div className="text-zinc-400 text-sm text-center py-4">Loading messages...</div>
        ) : visibleMessages.length === 0 ? (
          <div className="text-zinc-400 text-sm text-center py-4">
            {isProfessor ? 'No messages yet' : 'Ask a question to get help from professor'}
          </div>
        ) : (
          visibleMessages.map((msg) => (
            <div key={msg.messageId} className="space-y-1">
              {/* Original message */}
              <div
                className={`rounded-xl p-2.5 ${
                  msg.status === 'pending'
                    ? isProfessor
                      ? 'bg-yellow-900/30 border border-yellow-700/50'
                      : msg.senderId === user?.id
                        ? 'bg-yellow-900/30 border border-yellow-700/50'
                        : 'bg-zinc-800/50/50 blur-sm'
                    : 'bg-zinc-800/50'
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-emerald-400 font-medium">{msg.senderName}</span>
                  <span className="text-zinc-500">{formatTime(msg.createdAt)}</span>
                </div>
                <p className="text-zinc-200 text-sm">{msg.message}</p>
                {msg.status === 'pending' && msg.senderId === user?.id && (
                  <span className="text-xs text-yellow-500 mt-1 block">Waiting for professor...</span>
                )}
                {isProfessor && msg.status === 'pending' && (
                  <button
                    onClick={() => {
                      setReplyingTo(msg);
                      setReplyText('');
                    }}
                    className="text-xs text-emerald-400 hover:text-emerald-300 mt-1 cursor-pointer"
                  >
                    Reply
                  </button>
                )}
              </div>

              {/* Professor's reply (if approved) */}
              {msg.status === 'approved' && msg.replyMessage && (
                <div className="ml-4 bg-emerald-900/30 border border-emerald-700/50 rounded-xl p-2.5">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-green-400 font-medium">{msg.replyAuthorName}</span>
                    <span className="text-zinc-500">{msg.approvedAt ? formatTime(msg.approvedAt) : ''}</span>
                  </div>
                  <p className="text-zinc-200 text-sm">{msg.replyMessage}</p>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply form (for professors) */}
      {isProfessor && replyingTo && (
        <div className="px-3 py-2 bg-zinc-950 border-t border-zinc-800/80">
          <div className="text-xs text-zinc-400 mb-1">
            Replying to: <span className="text-emerald-400">{replyingTo.senderName}</span>
          </div>
          <div className="text-xs text-zinc-500 mb-2 truncate">"{replyingTo.message}"</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleReply()}
              placeholder="Type your reply..."
              className="flex-1 bg-zinc-800/50 border border-zinc-800/80 rounded-lg px-2 py-1 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50"
              autoFocus
            />
            <button
              onClick={handleReply}
              disabled={isSending || !replyText.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white px-3 py-1 rounded-lg text-sm transition-colors cursor-pointer"
            >
              Send
            </button>
            <button
              onClick={() => setReplyingTo(null)}
              className="text-zinc-400 hover:text-white px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Input form (for students) */}
      {!isProfessor && (
        <div className="px-3 py-2 bg-zinc-950 border-t border-zinc-800/80">
          <div className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask a question..."
              className="flex-1 bg-zinc-800/50 border border-zinc-800/80 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50"
            />
            <button
              onClick={handleSendMessage}
              disabled={isSending || !newMessage.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
