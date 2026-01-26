import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import {
  Send,
  Bot,
  User,
  Loader2,
  Sparkles,
  Trash2,
  MessageSquare,
  FileText,
  TrendingUp,
  AlertCircle,
  HelpCircle,
  Copy,
  RefreshCw,
  Square,
  ArrowDown,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

const SUGGESTED_QUESTIONS = [
  { icon: FileText, text: 'How many invoices this month?', color: 'text-blue-500' },
  { icon: AlertCircle, text: 'Show suspicious invoices', color: 'text-orange-500' },
  { icon: TrendingUp, text: 'Top vendor by spend?', color: 'text-green-500' },
  { icon: HelpCircle, text: 'Compliance summary', color: 'text-purple-500' },
];

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export default function Chat() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // new features
  const [searchText, setSearchText] = useState('');
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [invoiceStats, setInvoiceStats] = useState<{ count: number; total: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---------- Load chat history ----------
  useEffect(() => {
    if (user) {
      loadChatHistory();
      loadInvoiceStats();
    }
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ---------- Scroll detection + button ----------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
      setShowScrollDown(distanceFromBottom > 200);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // auto scroll to bottom on new messages (only if user is near bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    if (distanceFromBottom < 280) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const loadChatHistory = async () => {
    if (!user) return;
    setLoadingHistory(true);

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, role, content, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } else {
      setMessages((data || []) as Message[]);
    }

    setLoadingHistory(false);
  };

  // ---------- Invoice quick stats ----------
  const loadInvoiceStats = async () => {
    if (!user) return;

    // count
    const { count, error: countErr } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (countErr) return;

    // total
    const { data, error } = await supabase
      .from('invoices')
      .select('total_amount')
      .eq('user_id', user.id)
      .limit(500);

    if (error) return;

    const total = (data || []).reduce((acc: number, r: any) => acc + (Number(r.total_amount) || 0), 0);
    setInvoiceStats({ count: count || 0, total });
  };

  // ---------- Clear history ----------
  const clearHistory = async () => {
    if (!user || messages.length === 0) return;

    abortRef.current?.abort();

    const { error } = await supabase.from('chat_messages').delete().eq('user_id', user.id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      return;
    }

    setMessages([]);
    toast({ title: 'Chat cleared', description: 'Your conversation history has been deleted.' });
  };

  // ---------- Copy message ----------
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: 'Message copied to clipboard.' });
    } catch {
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Please copy manually.' });
    }
  };

  // ---------- Stop streaming ----------
  const stopGenerating = () => {
    abortRef.current?.abort();
    setLoading(false);
    toast({ title: 'Stopped', description: 'Generation stopped.' });
  };

  // ---------- Regenerate last answer ----------
  const regenerateLast = () => {
    if (loading) return;

    // find last user message
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;

    // remove last assistant message (optional cleanup)
    setMessages(prev => {
      const copy = [...prev];
      // remove last assistant if it is the last message
      if (copy.length && copy[copy.length - 1].role === 'assistant') copy.pop();
      return copy;
    });

    sendMessage(lastUser.content, { isRegenerate: true });
  };

  // ---------- Filter messages (search) ----------
  const filteredMessages = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(m => m.content.toLowerCase().includes(q));
  }, [messages, searchText]);

  // ---------- Send message ----------
  const sendMessage = useCallback(
    async (messageText: string, opts?: { isRegenerate?: boolean }) => {
      if (!messageText.trim() || loading || !user) return;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: messageText.trim(),
        created_at: new Date().toISOString(),
      };

      // If regenerate, do NOT re-add user bubble (optional)
      if (!opts?.isRegenerate) {
        setMessages(prev => [...prev, userMessage]);
      }

      setInput('');
      setLoading(true);

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const assistantId = crypto.randomUUID();
      setMessages(prev => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', created_at: new Date().toISOString() },
      ]);

      try {
        // save user message (only if not regenerate)
        if (!opts?.isRegenerate) {
          supabase.from('chat_messages').insert({
            user_id: user.id,
            role: 'user',
            content: userMessage.content,
          }).then();
        }

        // get session JWT
        const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
        if (sessErr) throw sessErr;

        const jwt = sessionData.session?.access_token;
        if (!jwt) throw new Error('Not authenticated. Please login again.');

        const historyForRequest = (opts?.isRegenerate ? messages : [...messages, userMessage])
          .slice(-10)
          .map(m => ({ role: m.role, content: m.content }));

        const res = await fetch(CHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({ messages: historyForRequest }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Chat request failed (${res.status}): ${errText}`);
        }
        if (!res.body) throw new Error('No response body');

        // SSE parse
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = '';
        let buffer = '';
        let doneStreaming = false;

        while (!doneStreaming) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let lineEnd: number;
          while ((lineEnd = buffer.indexOf('\n')) !== -1) {
            let line = buffer.slice(0, lineEnd);
            buffer = buffer.slice(lineEnd + 1);

            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (!line.startsWith('data:')) continue;

            const dataStr = line.replace(/^data:\s*/, '').trim();
            if (!dataStr) continue;

            if (dataStr === '[DONE]') {
              doneStreaming = true;
              break;
            }

            try {
              const json = JSON.parse(dataStr);
              const delta = json?.choices?.[0]?.delta?.content;
              if (delta) {
                content += delta;
                setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, content } : m)));
              }
            } catch {
              // ignore partial/invalid JSON lines
            }
          }
        }

        const finalText = content.trim();

        if (finalText) {
          supabase.from('chat_messages').insert({
            user_id: user.id,
            role: 'assistant',
            content: finalText,
          }).then();
        } else {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content: "I couldn't generate an answer. Please try again." }
                : m
            )
          );
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return;

        toast({
          variant: 'destructive',
          title: 'Chat error',
          description: error?.message || 'Failed to send message',
        });

        // remove empty assistant bubble
        setMessages(prev => prev.filter(m => m.role !== 'assistant' || m.content));
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [loading, messages, user, toast]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-8rem)] flex flex-col max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-4">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">AI-Powered Assistant</span>
          </div>

          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            How can I help you today?
          </h1>

          <p className="text-muted-foreground max-w-md mx-auto">
            Ask me anything about your invoices - I'll analyze your data and provide insights instantly.
          </p>

          {/* Invoice Quick Stats */}
          {user && invoiceStats && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <div className="px-3 py-1 rounded-full bg-muted text-sm">
                Invoices: <span className="font-semibold">{invoiceStats.count}</span>
              </div>
              <div className="px-3 py-1 rounded-full bg-muted text-sm">
                Total spend: <span className="font-semibold">${invoiceStats.total.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        {/* Chat Area */}
        <Card className="flex-1 flex flex-col overflow-hidden shadow-xl border-0 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex-1 flex flex-col p-0">
            {/* Top actions */}
            <div className="px-4 md:px-6 py-3 border-b border-border bg-background/60 backdrop-blur-sm flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search messages..."
                  className="h-9 w-full sm:w-72"
                />
              </div>

              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={regenerateLast}
                  disabled={!user || loading || messages.length === 0}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate
                </Button>

                {loading ? (
                  <Button variant="destructive" size="sm" onClick={stopGenerating}>
                    <Square className="h-4 w-4 mr-2" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearHistory}
                    disabled={!user || messages.length === 0}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <ScrollArea className="flex-1 p-4 md:p-6" ref={scrollRef}>
              {loadingHistory ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Loading your conversation...</p>
                </div>
              ) : filteredMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-8">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full scale-150" />
                    <div className="relative p-5 rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg">
                      <MessageSquare className="h-10 w-10" />
                    </div>
                  </div>

                  {messages.length === 0 ? (
                    <>
                      <h3 className="text-xl font-semibold mb-2">Start a Conversation</h3>
                      <p className="text-muted-foreground mb-8 max-w-sm">
                        I can analyze your invoices, find patterns, detect issues, and answer any questions about your data.
                      </p>

                      <div className="w-full max-w-lg">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                          Try asking me
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {SUGGESTED_QUESTIONS.map((q, i) => (
                            <button
                              key={i}
                              onClick={() => sendMessage(q.text)}
                              className="group flex items-center gap-3 p-4 rounded-xl bg-muted/50 hover:bg-muted border border-border/50 hover:border-primary/30 transition-all duration-200 text-left hover:shadow-md"
                            >
                              <div className={cn("p-2 rounded-lg bg-background", q.color)}>
                                <q.icon className="h-4 w-4" />
                              </div>
                              <span className="text-sm font-medium group-hover:text-primary transition-colors">
                                {q.text}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="text-xl font-semibold mb-2">No matching results</h3>
                      <p className="text-muted-foreground">Try a different search keyword.</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {filteredMessages.map((message) => (
                    <div
                      key={message.id}
                      className={cn('flex gap-4', message.role === 'user' && 'flex-row-reverse')}
                    >
                      <div
                        className={cn(
                          'flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-sm',
                          message.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-gradient-to-br from-muted to-muted/80 border border-border'
                        )}
                      >
                        {message.role === 'user' ? (
                          <User className="h-5 w-5" />
                        ) : (
                          <Bot className="h-5 w-5 text-primary" />
                        )}
                      </div>

                      <div className={cn('flex-1 max-w-[80%]', message.role === 'user' && 'text-right')}>
                        <div
                          className={cn(
                            'inline-block p-4 rounded-2xl relative',
                            message.role === 'user'
                              ? 'bg-primary text-primary-foreground rounded-tr-md'
                              : 'bg-muted rounded-tl-md'
                          )}
                        >
                          {message.content ? (
                            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-sm">Thinking...</span>
                            </div>
                          )}

                          {/* Copy button on assistant */}
                          {message.role === 'assistant' && !!message.content && (
                            <button
                              onClick={() => copyToClipboard(message.content)}
                              className="absolute -top-3 -right-3 p-2 rounded-lg bg-background border border-border shadow-sm hover:bg-muted transition"
                              title="Copy"
                              type="button"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                          )}
                        </div>

                        <p className={cn('text-xs mt-2 text-muted-foreground', message.role === 'user' && 'text-right')}>
                          {format(new Date(message.created_at), 'h:mm a')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Scroll down button */}
            {showScrollDown && (
              <button
                onClick={scrollToBottom}
                className="absolute right-6 bottom-24 p-3 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition"
                type="button"
                title="Scroll to bottom"
              >
                <ArrowDown className="h-5 w-5" />
              </button>
            )}

            {/* Input Area */}
            <div className="p-4 md:p-6 border-t border-border bg-background/80 backdrop-blur-sm">
              <form onSubmit={handleSubmit} className="flex gap-3">
                <div className="flex-1 relative">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask anything about your invoices..."
                    disabled={!user || loading}
                    className="pr-12 py-6 text-base rounded-xl border-2 border-border focus:border-primary transition-colors"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={!user || !input.trim() || loading}
                  size="lg"
                  className="px-6 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </Button>
              </form>

              {!user ? (
                <p className="text-xs text-center text-muted-foreground mt-3">
                  Please login first to use the chat.
                </p>
              ) : (
                <p className="text-xs text-center text-muted-foreground mt-3">
                  AI responses are based on your invoice data. Always verify important information.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
