// IMPORTANT:
// Do NOT createClient() here (that caused "already declared").
// This file only re-exports the main client so old imports keep working.

export { supabase } from "../integrations/supabase/client";
