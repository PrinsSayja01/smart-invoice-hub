import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { fileId } = req.query

    if (!fileId || typeof fileId !== 'string') {
      return res.status(400).json({ error: 'File ID required' })
    }

    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization token' })
    }

    const token = authHeader.replace('Bearer ', '')

    const supabaseUrl = 'https://tkpogjvlepwrsswqzsdu.supabase.co'
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const providerTokenResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey!
      }
    })

    if (!providerTokenResponse.ok) {
      return res.status(401).json({ error: 'Invalid session' })
    }

    const userData = await providerTokenResponse.json()
    const providerToken = userData.app_metadata?.provider_token || userData.identities?.[0]?.identity_data?.provider_token

    if (!providerToken) {
      return res.status(401).json({ error: 'No provider token' })
    }

    const driveResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          'Authorization': `Bearer ${providerToken}`
        }
      }
    )

    if (!driveResponse.ok) {
      throw new Error('Failed to download file')
    }

    const arrayBuffer = await driveResponse.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    const contentType = driveResponse.headers.get('content-type') || 'application/octet-stream'
    
    res.setHeader('Content-Type', contentType)
    return res.send(buffer)

  } catch (error: any) {
    console.error('Download error:', error)
    return res.status(500).json({ error: error.message })
  }
}
