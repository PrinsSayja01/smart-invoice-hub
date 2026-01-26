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
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY; // your anon/publishable key

// ---------- invoice context helper ----------
type InvoiceRow = {
  id?: string;
  vendor_name: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  currency: string | null;
  created_at?: string;
};

function buildInvoiceContext(invoices: InvoiceRow[]) {
  if (!invoices?.length) return 'No invoices found for this user yet.';

  const totalCount = invoices.length;

  // totals per currency
  const totalsByCurrency = new Map<string, number>();
  // vendor totals
  const vendorTotals = new Map<string, number>();
  // count per vendor
  const vendorCount = new Map<string, number>();

  for (const inv of invoices) {
    const currency = (inv.currency || 'UNKNOWN').toUpperCase();
    const amount = typeof inv.total_amount === 'number' ? inv.total_amount : 0;
    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) || 0) + amount);

    const vendor = (inv.vendor_name || 'Unknown Vendor').trim();
    vendorTotals.set(vendor, (vendorTotals.get(vendor) || 0) + amount);
    vendorCount.set(vendor, (vendorCount.get(vendor) || 0) + 1);
  }

  // top vendors by spend
  const topVendors = [...vendorTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, sum]) => `${name}: ${sum.toFixed(2)}`);

  // totals by currency display
  const currencySummary = [...totalsByCurrency.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cur, sum]) => `${cur} ${sum.toFixed(2)}`)
    .slice(0, 5)
    .join(', ');

  // recent window dates
  const dates = invoices
    .map(i => i.invoice_date)
    .filter(Boolean)
    .map(d => new Date(d as string).getTime())
    .sort((a, b) => a - b);

  const dateRange =
    dates.length > 0
      ? `${format(new Date(dates[0]), 'yyyy-MM-dd')} → ${format(new Date(dates[dates.length - 1]), 'yyyy-MM-dd')}`
      : 'No invoice_date values available';

  const mostFrequentVendor = [...vendorCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Keep it short so it fits token limits
  return [
    `Invoice dataset summary (latest ${totalCount} invoices):`,
    `- Date range: ${dateRange}`,
    `- Totals by currency (top): ${currencySummary || 'N/A'}`,
    `- Top vendors by spend: ${topVendors.join(' | ') || 'N/A'}`,
    `- Most frequent vendor: ${mostFrequentVendor || 'N/A'}`,
    `Rules: Answer using this invoice dataset. If user asks for details, explain assumptions. If data missing, say so clearly.`,
  ].join('\n');
}

export default function Chat() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // invoice context
  const [invoiceContext, setInvoiceContext] = useState<string>('Loading invoice context...');
  const [loadingInvoices, setLoadingInvoices] = useState(true);

  // reliable scroll
  const endRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const canSend = useMemo(() => !!input.trim() && !loading && !!user, [input, loading, user]);

  useEffect(() => {
    if (!user) return;

    loadChatHistory();
    loadInvoiceContext();

    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    // smooth scroll to end
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loadingHistory]);

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
      toast({ variant: 'destructive', title: 'Failed to load chat', description: error.message });
    } else if (data) {
      setMessages(data as Message[]);
    }

    setLoadingHistory(false);
  };

  const loadInvoiceContext = async () => {
    if (!user) return;
    setLoadingInvoices(true);

    // pull latest invoices for context (you can increase to 500 if needed)
    const { data, error } = await supabase
      .from('invoices')
      .select('vendor_name, invoice_date, total_amount, currency')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      setInvoiceContext(`Invoice context failed to load: ${error.message}`);
      setLoadingInvoices(false);
      return;
    }

    const ctx = buildInvoiceContext((data || []) as InvoiceRow[]);
    setInvoiceContext(ctx);
    setLoadingInvoices(false);
  };

  const clearHistory = async () => {
    if (!user || messages.length === 0) return;

    const { error } = await supabase.from('chat_messages').delete().eq('user_id', user.id);
    if (error) {
      toast({ variant: 'destructive', title: 'Failed to clear chat', description: error.message });
      return;
    }

    setMessages([]);
    toast({ title: 'Chat cleared', description: 'Your conversation history has been deleted.' });
  };

  const sendMessage = useCallback(
    async (messageText: string) => {
      if (!messageText.trim() || loading || !user) return;

      const cleanText = messageText.trim();

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: cleanText,
        created_at: new Date().toISOString(),
      };

      // optimistic UI
      setMessages(prev => [...prev, userMessage]);
      setInput('');
      setLoading(true);

      // stop previous stream
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        // save user msg async (don’t block UI)
        supabase
          .from('chat_messages')
          .insert({ user_id: user.id, role: 'user', content: cleanText })
          .then();

        // IMPORTANT: Use user JWT (not anon key) for Authorization
        const { data: sessionData } = await supabase.auth.getSession();
        const jwt = sessionData.session?.access_token;

        // Build payload:
        // - last 10 chat messages (small context)
        // - invoiceContext (summary of uploaded invoices)
        const payload = {
          messages: [...messages, userMessage].slice(-10).map(m => ({
            role: m.role,
            content: m.content,
          })),
          invoiceContext, // <--- key part
        };

        const response = await fetch(CHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: ANON_KEY,
            Authorization: `Bearer ${jwt || ANON_KEY}`,
          },
          body: JSON.stringify(payload),
          signal: abortRef.current.signal,
        });

        // If your Edge Function returns JSON errors:
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          let parsed: any = null;
          try {
            parsed = JSON.parse(errorText);
          } catch {
            // keep as text
          }

          const msg =
            parsed?.error ||
            parsed?.message ||
            (errorText?.slice(0, 200) ? errorText.slice(0, 200) : 'Failed to get response');

          if (response.status === 429) throw new Error(msg || 'Rate limit exceeded. Please wait a moment.');
          if (response.status === 402) throw new Error(msg || 'Usage limit reached.');
          throw new Error(msg);
        }

        if (!response.body) throw new Error('No response body (stream missing)');

        const assistantId = crypto.randomUUID();
        setMessages(prev => [
          ...prev,
          { id: assistantId, role: 'assistant', content: '', created_at: new Date().toISOString() },
        ]);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let content = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            let line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);

            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (!line.startsWith('data: ') || line.trim() === '') continue;

            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') break;

            try {
              const delta = JSON.parse(jsonStr).choices?.[0]?.delta?.content;
              if (delta) {
                content += delta;
                setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, content } : m)));
              }
            } catch {
              // if partial JSON, put it back and wait for more bytes
              buffer = line + '\n' + buffer;
              break;
            }
          }
        }

        if (content) {
          supabase
            .from('chat_messages')
            .insert({ user_id: user.id, role: 'assistant', content })
            .then();
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return;

        toast({
          variant: 'destructive',
          title: 'Chat error',
          description: error?.message || 'Failed to send message',
        });

        // remove empty assistant bubble if created
        setMessages(prev => prev.filter(m => m.role !== 'assistant' || m.content));
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [loading, messages, user, toast, invoiceContext]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <DashboardLayout>
      {/* better mobile height + padding */}
      <div className="min-h-[calc(100vh-6rem)] h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] flex flex-col max-w-4xl mx-auto px-3 md:px-0">
        {/* Header */}
        <div className="mb-4 md:mb-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-3 md:mb-4">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">AI-Powered Assistant</span>
          </div>

          <h1 className="text-2xl md:text-4xl font-bold mb-2">How can I help you today?</h1>

          <p className="text-muted-foreground max-w-md mx-auto text-sm md:text-base">
            Ask me anything about your invoices — I’ll analyze your uploaded data and provide insights.
          </p>

          {/* small status line */}
          <div className="mt-2 text-xs text-muted-foreground">
            {loadingInvoices ? 'Loading invoice dataset…' : 'Invoice dataset ready ✅'}
          </div>
        </div>

        {/* Chat Area */}
        <Card className="flex-1 flex flex-col overflow-hidden shadow-xl border-0 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex-1 flex flex-col p-0">
            <ScrollArea className="flex-1 p-4 md:p-6">
              {loadingHistory ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Loading your conversation...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-8">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full scale-150" />
                    <div className="relative p-5 rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg">
                      <MessageSquare className="h-10 w-10" />
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold mb-2">Start a Conversation</h3>
                  <p className="text-muted-foreground mb-8 max-w-sm">
                    I can analyze your invoices, find patterns, detect issues, and answer questions about your data.
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
                          <div className={cn('p-2 rounded-lg bg-background', q.color)}>
                            <q.icon className="h-4 w-4" />
                          </div>
                          <span className="text-sm font-medium group-hover:text-primary transition-colors">
                            {q.text}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {messages.map(message => (
                    <div
                      key={message.id}
                      className={cn('flex gap-3 md:gap-4', message.role === 'user' && 'flex-row-reverse')}
                    >
                      <div
                        className={cn(
                          'flex-shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center shadow-sm',
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

                      <div className={cn('flex-1 max-w-[85%] md:max-w-[80%]', message.role === 'user' && 'text-right')}>
                        <div
                          className={cn(
                            'inline-block p-4 rounded-2xl',
                            message.role === 'user'
                              ? 'bg-primary text-primary-foreground rounded-tr-md'
                              : 'bg-muted rounded-tl-md'
                          )}
                        >
                          {message.content ? (
                            <p className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">
                              {message.content}
                            </p>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-sm">Thinking...</span>
                            </div>
                          )}
                        </div>

                        <p className={cn('text-xs mt-2 text-muted-foreground', message.role === 'user' && 'text-right')}>
                          {format(new Date(message.created_at), 'h:mm a')}
                        </p>
                      </div>
                    </div>
                  ))}

                  {/* scroll anchor */}
                  <div ref={endRef} />
                </div>
              )}
            </ScrollArea>

            {/* Input Area */}
            <div className="p-4 md:p-6 border-t border-border bg-background/80 backdrop-blur-sm">
              {messages.length > 0 && (
                <div className="flex justify-center mb-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearHistory}
                    className="text-muted-foreground hover:text-destructive"
                    disabled={loading}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear conversation
                  </Button>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex gap-3">
                <div className="flex-1 relative">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Ask anything about your invoices..."
                    disabled={loading}
                    className="pr-12 py-6 text-base rounded-xl border-2 border-border focus:border-primary transition-colors"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={!canSend}
                  size="lg"
                  className="px-6 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </Button>
              </form>

              <p className="text-xs text-center text-muted-foreground mt-3">
                AI responses are based on your invoice dataset. Always verify important information.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
