import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      // This ensures Supabase reads the URL hash/code and stores the session.
      const { data, error } = await supabase.auth.getSession();

      // If you want, you can log errors
      // console.log("callback session", data?.session, error);

      if (!mounted) return;

      if (error) {
        navigate("/auth?error=" + encodeURIComponent(error.message), { replace: true });
        return;
      }

      // If session exists → go dashboard
      if (data?.session) {
        navigate("/dashboard", { replace: true });
      } else {
        // No session means login didn't complete
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
      <p className="text-sm text-muted-foreground">Finishing login…</p>
    </div>
  );
}
