import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      // This exchanges the ?code=... from Google into a Supabase session
      const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
      // even if error, we navigate so user doesn't get stuck
      navigate("/invoice-upload", { replace: true });
      if (error) console.error("exchangeCodeForSession error:", error);
    })();
  }, [navigate]);

  return (
    <div style={{ padding: 24 }}>
      <h2>Signing you in…</h2>
      <p>Please wait.</p>
    </div>
  );
}
