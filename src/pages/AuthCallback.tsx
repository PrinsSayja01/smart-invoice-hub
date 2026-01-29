import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      // Supabase reads tokens from URL automatically
      const { data } = await supabase.auth.getSession();
      if (data.session) navigate("/dashboard");
      else navigate("/auth");
    })();
  }, [navigate]);

  return <div className="p-6">Signing you in...</div>;
}
