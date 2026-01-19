import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email) return false;

      try {
        // Check if user exists in profiles table
        const { data: existingProfile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("email", user.email)
          .single();

        if (!existingProfile) {
          // Create new profile for Google user
          const { error: profileError } = await supabaseAdmin
            .from("profiles")
            .insert({
              user_id: user.id, // NextAuth user id
              email: user.email,
              full_name: user.name,
              avatar_url: user.image,
            });

          if (profileError) {
            console.error("Error creating profile:", profileError);
            // Don't block sign-in, profile can be created later
          }

          // Assign default role
          const { error: roleError } = await supabaseAdmin
            .from("user_roles")
            .insert({
              user_id: user.id,
              role: "user",
            });

          if (roleError) {
            console.error("Error creating role:", roleError);
          }
        }

        return true;
      } catch (error) {
        console.error("SignIn callback error:", error);
        return true; // Allow sign-in even if profile creation fails
      }
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        
        // Fetch user role from database
        const { data: roleData } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", token.sub)
          .single();
        
        (session.user as any).role = roleData?.role || "user";
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
  },
  pages: {
    signIn: "/auth",
    error: "/auth/error",
  },
  session: {
    strategy: "jwt",
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
