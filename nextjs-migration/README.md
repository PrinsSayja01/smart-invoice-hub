# Smart Invoice Hub - Next.js Migration

This is the Next.js + NextAuth version of Smart Invoice Hub, configured for deployment on Vercel with your custom callback URL.

## Setup Instructions

### 1. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth client ID**
5. Choose **Web application**
6. Add these **Authorized redirect URIs**:
   - `https://smart-invoice-hub01.vercel.app/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (for local dev)
7. Copy the Client ID and Client Secret

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

Required variables:
- `NEXTAUTH_SECRET`: Generate with `openssl rand -base64 32`
- `GOOGLE_CLIENT_ID`: From Google Cloud Console
- `GOOGLE_CLIENT_SECRET`: From Google Cloud Console
- `SUPABASE_SERVICE_ROLE_KEY`: From your Lovable Cloud backend

### 3. Deploy to Vercel

1. Push this code to GitHub
2. Go to [Vercel](https://vercel.com) and import the repository
3. Add the environment variables in Vercel's project settings
4. Deploy!

### 4. Verify Callback URL

After deployment, your Google OAuth callback will be:
```
https://smart-invoice-hub01.vercel.app/api/auth/callback/google
```

This matches the callback URL in your NextAuth configuration.

## Database

This app continues to use your existing Lovable Cloud (Supabase) database:
- Tables: `invoices`, `profiles`, `user_roles`, `chat_messages`
- RLS policies remain in effect
- Edge functions still work

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## File Structure

```
├── app/
│   ├── api/auth/[...nextauth]/route.ts  # NextAuth API route
│   ├── auth/page.tsx                     # Login page
│   ├── dashboard/page.tsx                # Dashboard
│   ├── globals.css                       # Global styles
│   ├── layout.tsx                        # Root layout
│   └── page.tsx                          # Home page
├── components/
│   └── providers/AuthProvider.tsx        # NextAuth session provider
├── lib/
│   └── supabase.ts                       # Supabase client helpers
├── middleware.ts                         # Route protection
└── .env.example                          # Environment template
```
