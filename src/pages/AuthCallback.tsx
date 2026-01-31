import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase reads token from URL automatically if detectSessionInUrl = true
    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.error("AuthCallback session error:", error);

      // Go where you want after login
      navigate(data.session ? "/dashboard" : "/auth", { replace: true });
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-sm text-gray-600">Finishing login…</div>
    </div>
  );
}
