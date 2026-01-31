<<<<<<< HEAD
import { createClient } from "@supabase/supabase-js";
=======
import { createClient } from '@supabase/supabase-js';
>>>>>>> 167cf85 (Initial commit: full project setup with Vite + React + shadcn/ui)

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

<<<<<<< HEAD
=======
if (!supabaseUrl || !supabaseAnonKey) {
  // Helps catch missing env vars early
  // eslint-disable-next-line no-console
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

>>>>>>> 167cf85 (Initial commit: full project setup with Vite + React + shadcn/ui)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
