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
    // Get the token from Authorization header
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization token' })
    }

    const token = authHeader.replace('Bearer ', '')

    // Initialize Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` }
        }
      }
    )

    // Get the session to extract Google's provider token
    const { data: { session }, error } = await supabase.auth.getSession()

    if (error || !session) {
      return res.status(401).json({ error: 'Invalid session' })
    }

    const providerToken = session.provider_token

    if (!providerToken) {
      return res.status(401).json({ 
        error: 'Please log out and log back in to grant Drive access' 
      })
    }

    // Call Google Drive API
    const driveResponse = await fetch(
      'https://www.googleapis.com/drive/v3/files?' +
      'q=mimeType="application/pdf" or mimeType="image/jpeg" or mimeType="image/png"&' +
      'fields=files(id,name,mimeType,modifiedTime,size)&' +
      'orderBy=modifiedTime desc&' +
      'pageSize=50',
      {
        headers: {
          'Authorization': `Bearer ${providerToken}`
        }
      }
    )

    if (!driveResponse.ok) {
      const error = await driveResponse.json()
      throw new Error(error.error?.message || 'Failed to fetch files')
    }

    const data = await driveResponse.json()
    return res.status(200).json(data)

  } catch (error: any) {
    console.error('Drive API error:', error)
    return res.status(500).json({ error: error.message })
  }
}
