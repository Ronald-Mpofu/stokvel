import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import SessionKeeper from '@/components/SessionKeeper'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Windfall Community Centre',
  description: 'Asset & Investment Windfall Management Centre',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* Keeps the session alive by refreshing the access token before
            it expires. Renders nothing. Mounted here so it covers the
            portal, the dashboard and every other page at once. */}
        <SessionKeeper />
        {children}
      </body>
    </html>
  )
}
