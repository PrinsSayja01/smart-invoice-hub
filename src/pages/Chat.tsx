import { useState, useRef, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

const SUGGESTED_QUESTIONS = [
  { icon: FileText, text: "How many invoices this month?", color: "text-blue-500" },
  { icon: AlertCircle, text: "Show suspicious invoices", color: "text-orange-500" },
  { icon: TrendingUp, text: "Top vendor by spend?", color: "text-green-500" },
  { icon: HelpCircle, text: "Compliance summary", color: "text-purple-500" },
];

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export default function Chat() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const chatBodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (user) loadChatHistory();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const el = chatBodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const loadChatHistory = async () => {
    if (!user) return;
    setLoadingHistory(true);

    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) {
      toast({
        variant: "destructive",
        title: "Failed to load chat history",
        description: error.message,
      });
    } else {
      setMessages((data || []) as Message[]);
    }

    setLoadingHistory(false);
  };

  const clearHistory = async () => {
    if (!user) return;

    const { error } = await supabase.from("chat_messages").delete().eq("user_id", user.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Cannot clear chat",
        description:
          error.message +
          " — If this says permission denied, add DELETE policy for chat_messages (SQL below).",
      });
      return;
    }

    setMessages([]);
    toast({ title: "Chat cleared", description: "Your conversation history has been deleted." });
  };

  const sendMessage = useCallback(
    async (messageText: string) => {
      if (!messageText.trim() || loading || !user) return;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: messageText.trim(),
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setLoading(true);

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString() },
      ]);

      try {
        // Save user message (no await)
        supabase
          .from("chat_messages")
          .insert({ user_id: user.id, role: "user", content: userMessage.content })
          .then();

        // ✅ Use real JWT
        const { data: sessionData } = await supabase.auth.getSession();
        const jwt = sessionData.session?.access_token;

        const response = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            messages: [...messages, userMessage].slice(-10).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const t = await response.text().catch(() => "");
          throw new Error(`Chat request failed (${response.status}). ${t}`);
        }

        const ct = response.headers.get("content-type") || "";

        // ✅ If JSON { answer }
        if (ct.includes("application/json")) {
          const json = await response.json();
          const answer = (json?.answer || "").toString().trim() || "No answer returned.";

          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: answer } : m)));

          supabase
            .from("chat_messages")
            .insert({ user_id: user.id, role: "assistant", content: answer })
            .then();

          return;
        }

        // ✅ If SSE stream
        if (!response.body) throw new Error("No response body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let content = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);

            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;

            const payload = line.slice(6).trim();
            if (payload === "[DONE]") break;

            try {
              const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
              if (delta) {
                content += delta;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content } : m))
                );
              }
            } catch {
              // ignore partial chunks
            }
          }
        }

        const finalAnswer = content.trim() || "No answer returned. Try again.";
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: finalAnswer } : m))
        );

        supabase
          .from("chat_messages")
          .insert({ user_id: user.id, role: "assistant", content: finalAnswer })
          .then();
      } catch (err: any) {
        if (err?.name === "AbortError") return;

        toast({
          variant: "destructive",
          title: "Chat error",
          description: err?.message || "Failed to send message",
        });

        // remove empty assistant bubble
        setMessages((prev) => prev.filter((m) => !(m.id === assistantId && !m.content)));
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
          <h1 className="text-3xl md:text-4xl font-bold mb-2">How can I help you today?</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Ask me anything about your invoices - I'll analyze your data and provide insights instantly.
          </p>
        </div>

        {/* Chat Area */}
        <Card className="flex-1 flex flex-col overflow-hidden shadow-xl border-0 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex-1 flex flex-col p-0">
            {/* ✅ IMPORTANT: normal scroll div (fixes input blocking) */}
            <div ref={chatBodyRef} className="flex-1 overflow-y-auto p-4 md:p-6">
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
                </div>
              ) : (
                <div className="space-y-6">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn("flex gap-4", message.role === "user" && "flex-row-reverse")}
                    >
                      <div
                        className={cn(
                          "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-sm",
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-gradient-to-br from-muted to-muted/80 border border-border"
                        )}
                      >
                        {message.role === "user" ? (
                          <User className="h-5 w-5" />
                        ) : (
                          <Bot className="h-5 w-5 text-primary" />
                        )}
                      </div>

                      <div className={cn("flex-1 max-w-[80%]", message.role === "user" && "text-right")}>
                        <div
                          className={cn(
                            "inline-block p-4 rounded-2xl",
                            message.role === "user"
                              ? "bg-primary text-primary-foreground rounded-tr-md"
                              : "bg-muted rounded-tl-md"
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
                        </div>

                        <p
                          className={cn(
                            "text-xs mt-2 text-muted-foreground",
                            message.role === "user" && "text-right"
                          )}
                        >
                          {format(new Date(message.created_at), "h:mm a")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 md:p-6 border-t border-border bg-background/80 backdrop-blur-sm">
              {messages.length > 0 && (
                <div className="flex justify-center mb-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearHistory}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear conversation
                  </Button>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex gap-3">
                <div className="flex-1 relative z-10 pointer-events-auto">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask anything about your invoices..."
                    className="pr-12 py-6 text-base rounded-xl border-2 border-border focus:border-primary transition-colors"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={!input.trim() || loading}
                  size="lg"
                  className="px-6 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </Button>
              </form>

              <p className="text-xs text-center text-muted-foreground mt-3">
                AI responses are based on your invoice data. Always verify important information.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
