import { supabase } from "@/integrations/supabase/client";

export async function invokeFn<T = any>(fnName: string, body: any): Promise<T> {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw sessionErr;

  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("No Supabase access_token. Please login again.");

  const { data, error } = await supabase.functions.invoke(fnName, {
    body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (error) {
    // Surface clean details
    const msg =
      (error as any)?.message ||
      (error as any)?.context?.body ||
      JSON.stringify(error);
    throw new Error(`Edge Function "${fnName}" failed: ${msg}`);
  }

  return data as T;
}
