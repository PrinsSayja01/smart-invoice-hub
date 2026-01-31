import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        // After Google redirect, Supabase finalizes the session automatically
        const { data, error } = await supabase.auth.getSession();

        // If session exists -> go dashboard
        if (!mounted) return;

        if (error) {
          console.error("AuthCallback getSession error:", error);
          navigate("/auth", { replace: true });
          return;
        }

        if (data?.session) {
          navigate("/dashboard", { replace: true });
        } else {
          navigate("/auth", { replace: true });
        }
      } catch (e) {
        console.error("AuthCallback unexpected:", e);
        navigate("/auth", { replace: true });
      }
    };

    run();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-sm text-muted-foreground">Finishing sign-in…</div>
    </div>
  );
}
