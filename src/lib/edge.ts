import { supabase } from "@/integrations/supabase/client";

type InvokeEdgeOptions = {
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export async function invokeEdge<T = any>(
  name: string,
  body: any,
  opts: InvokeEdgeOptions = {}
): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const jwt = sess.session?.access_token;

  const timeoutMs = opts.timeoutMs ?? 20000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { data, error } = await supabase.functions.invoke(name, {
      body,
      headers: {
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        ...(opts.headers ?? {}),
      },
      // @ts-expect-error: supabase-js supports fetch options in some runtimes;
      // if your version doesn't, it will just ignore it.
      signal: controller.signal,
    });

    if (error) {
      // supabase-js error often hides the details; surface it
      const msg =
        (error as any)?.context?.statusText ||
        (error as any)?.message ||
        "Edge Function failed";
      throw new Error(msg);
    }

    return data as T;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`Edge Function "${name}" timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
