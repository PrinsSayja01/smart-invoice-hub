import { supabase } from "@/integrations/supabase/client";

/**
 * Returns Google OAuth access token (provider_token) from Supabase session.
 * If null => user must re-login with correct scopes.
 */
export async function getGoogleProviderToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.provider_token ?? null;
}
