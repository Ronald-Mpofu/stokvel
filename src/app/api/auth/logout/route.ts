// src/app/api/auth/logout/route.ts
import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.json({ success: true, message: 'Logged out successfully' })
  const isProd = process.env.NODE_ENV === 'production'

  // Must be done server-side — httpOnly cookies cannot be cleared from the browser
  response.cookies.set('access_token', '', {
    httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 0, path: '/',
  })
  response.cookies.set('refresh_token', '', {
    httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 0, path: '/',
  })
  return response
}
