import { createClient } from '@supabase/supabase-js'
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization token' })
    }

    const token = authHeader.replace('Bearer ', '')

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` }
        }
      }
    )

    const { data: { session }, error } = await supabase.auth.getSession()

    if (error || !session) {
      return res.status(401).json({ error: 'Invalid session' })
    }

    const providerToken = session.provider_token

    if (!providerToken) {
      return res.status(401).json({ error: 'No provider token' })
    }

    // Call Gmail API
    const gmailResponse = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?' +
      'q=has:attachment (invoice OR receipt OR bill)&' +
      'maxResults=20',
      {
        headers: {
          'Authorization': `Bearer ${providerToken}`
        }
      }
    )

    if (!gmailResponse.ok) {
      const error = await gmailResponse.json()
      throw new Error(error.error?.message || 'Failed to fetch messages')
    }

    const data = await gmailResponse.json()
    return res.status(200).json(data)

  } catch (error: any) {
    console.error('Gmail API error:', error)
    return res.status(500).json({ error: error.message })
  }
}
