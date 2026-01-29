import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Supabase will read the OAuth tokens from the URL automatically.
        // We just wait for session to be available.
        const { data } = await supabase.auth.getSession();

        if (!mounted) return;

        if (data.session) {
          navigate("/dashboard", { replace: true });
        } else {
          navigate("/auth", { replace: true });
        }
      } catch (e) {
        if (!mounted) return;
        navigate("/auth", { replace: true });
      }
    })();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-sm text-muted-foreground">Signing you in…</div>
    </div>
  );
}
