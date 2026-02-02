import { supabase } from "../lib/supabaseClient";

export async function connectGoogleDrive() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: "openid email profile https://www.googleapis.com/auth/drive.readonly",
      queryParams: {
        access_type: "offline",
        prompt: "consent", // IMPORTANT: forces new consent (new token with Drive scope)
      },
      redirectTo: `${window.location.origin}/dashboard/upload`,
    },
  });

  if (error) throw error;
  return data;
}
