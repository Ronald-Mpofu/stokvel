'use client'
// src/app/viewport-check/page.tsx — TEMPORARY DIAGNOSTIC. DELETE AFTER USE.
//
// Prints the numbers that decide whether every responsive layout in the app
// works, on a device with no developer console. Sits under the root layout,
// so it sees the same viewport handling as /dashboard.
//
// Not linked from anywhere; reachable only by typing the URL.

import { useState, useEffect } from 'react'

export default function ViewportCheck() {
  const [info, setInfo] = useState<Record<string, string> | null>(null)

  function read() {
    const meta = document.querySelector('meta[name=viewport]') as HTMLMetaElement | null
    setInfo({
      'window.innerWidth':   String(window.innerWidth),
      'screen.width':        String(window.screen?.width ?? '?'),
      'devicePixelRatio':    String(window.devicePixelRatio),
      'matches (max-640px)': String(window.matchMedia('(max-width: 640px)').matches),
      'viewport meta':       meta?.content || 'MISSING',
      'document scrollWidth': String(document.documentElement.scrollWidth),
      'orientation':         window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
    })
  }

  useEffect(() => {
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  const narrow = info?.['matches (max-640px)'] === 'true'

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '14px' }}>
      <h1 style={{ fontSize: '18px', marginBottom: '4px', fontFamily: 'system-ui' }}>Viewport check</h1>
      <p style={{ fontSize: '12px', color: '#64748B', marginTop: 0, fontFamily: 'system-ui' }}>
        Temporary diagnostic. Delete this file once we have the answer.
      </p>

      {!info ? <p>Reading…</p> : (
        <>
          <div style={{
            background: narrow ? '#DCFCE7' : '#FEF2F2',
            border: `2px solid ${narrow ? '#166534' : '#991B1B'}`,
            borderRadius: '10px', padding: '14px', marginBottom: '16px',
            fontFamily: 'system-ui', fontSize: '15px', fontWeight: 700,
            color: narrow ? '#166534' : '#991B1B',
          }}>
            {narrow
              ? '✅ This device reads as NARROW. The media query is firing — the fault is in the panel.'
              : '❌ This device does NOT read as narrow. The responsive branches will never run.'}
          </div>

          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {Object.entries(info).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: '7px 8px 7px 0', color: '#64748B', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{k}</td>
                  <td style={{ padding: '7px 0', fontWeight: 700, wordBreak: 'break-all' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* A live CSS-only control. If this bar turns green but the JS row
              above says false, the problem is the hook, not the viewport —
              they cannot disagree unless something is wrong with matchMedia. */}
          <div style={{ marginTop: '20px', fontFamily: 'system-ui', fontSize: '12px', color: '#64748B' }}>
            CSS control (independent of JavaScript):
          </div>
          <style>{`
            .vp-css { background:#991B1B; color:white; padding:12px; border-radius:8px;
                      margin-top:6px; font-family:system-ui; font-weight:700; }
            .vp-css::after { content:'CSS says WIDE (over 640px)'; }
            @media (max-width: 640px) {
              .vp-css { background:#166534; }
              .vp-css::after { content:'CSS says NARROW (640px or under)'; }
            }
          `}</style>
          <div className="vp-css" />
        </>
      )}
    </div>
  )
}
