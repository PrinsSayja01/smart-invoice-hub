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

    const supabaseUrl = 'https://tkpogjvlepwrsswqzsdu.supabase.co'
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const sessionResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey!
      }
    })

    if (!sessionResponse.ok) {
      return res.status(401).json({ error: 'Invalid session' })
    }

    const providerTokenResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey!
      }
    })

    const userData = await providerTokenResponse.json()
    const providerToken = userData.app_metadata?.provider_token || userData.identities?.[0]?.identity_data?.provider_token

    if (!providerToken) {
      return res.status(401).json({ 
        error: 'Please log out and log back in to grant Drive access' 
      })
    }

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
