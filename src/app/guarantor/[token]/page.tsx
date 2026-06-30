'use client'
import { useState, useEffect } from 'react'

const TEAL = '#0F6E56'; const NAVY = '#0D2137'
const fmt = (n: number) => new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)

function LoadingState() {
  return (
    <div style={{ minHeight:'100vh',background:`linear-gradient(135deg,${NAVY},${TEAL})`,display:'flex',alignItems:'center',justifyContent:'center' }}>
      <div style={{ textAlign:'center',color:'white' }}>
        <div style={{ fontSize:'40px',marginBottom:'12px' }}>⏳</div>
        <p style={{ fontSize:'16px',opacity:0.8 }}>Loading your request...</p>
      </div>
    </div>
  )
}

function ErrorState({ code, message }: any) {
  const icons: Record<string,string> = { EXPIRED:'⏰', APPROVED:'✅', DECLINED:'❌', NOT_FOUND:'🔍' }
  return (
    <div style={{ minHeight:'100vh',background:`linear-gradient(135deg,${NAVY},${TEAL})`,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px' }}>
      <div style={{ background:'white',borderRadius:'20px',padding:'48px 40px',maxWidth:'440px',width:'100%',textAlign:'center',boxShadow:'0 25px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize:'56px',marginBottom:'16px' }}>{icons[code]||'❌'}</div>
        <h2 style={{ fontSize:'20px',fontWeight:'700',color:NAVY,margin:'0 0 12px' }}>
          {code==='EXPIRED'?'Link Expired':code==='APPROVED'?'Already Approved':code==='DECLINED'?'Already Declined':'Not Found'}
        </h2>
        <p style={{ fontSize:'14px',color:'#64748B',lineHeight:'1.6' }}>{message}</p>
      </div>
    </div>
  )
}

function SuccessState({ action, name }: { action: string; name: string }) {
  return (
    <div style={{ minHeight:'100vh',background:`linear-gradient(135deg,${NAVY},${TEAL})`,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px' }}>
      <div style={{ background:'white',borderRadius:'20px',padding:'48px 40px',maxWidth:'460px',width:'100%',textAlign:'center',boxShadow:'0 25px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize:'64px',marginBottom:'16px' }}>{action==='APPROVE'?'🎉':'👍'}</div>
        <h2 style={{ fontSize:'24px',fontWeight:'700',color:NAVY,margin:'0 0 12px' }}>
          {action==='APPROVE' ? 'Guarantee Confirmed!' : 'Response Recorded'}
        </h2>
        <p style={{ fontSize:'14px',color:'#475569',lineHeight:'1.6',margin:'0 0 24px' }}>
          {action==='APPROVE'
            ? `Thank you, ${name}! Your guarantee has been confirmed and the borrower has been notified.`
            : `Thank you, ${name}. Your response has been recorded. The borrower has been notified.`
          }
        </p>
        <div style={{ background:'#F0FDF4',borderRadius:'12px',padding:'16px',border:'1px solid #BBF7D0',fontSize:'13px',color:'#166534' }}>
          {action==='APPROVE'
            ? '✅ You are now listed as a guarantor for this loan. You will be contacted if the borrower is unable to repay.'
            : '📋 Your decision has been recorded. No further action is required from you.'}
        </div>
      </div>
    </div>
  )
}

export default function GuarantorPage({ params }: { params: { token: string } }) {
  const [data, setData]         = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<any>(null)
  const [result, setResult]     = useState<any>(null)
  const [step, setStep]         = useState<'review'|'confirm_decline'>('review')
  const [declineReason, setDeclineReason] = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [submitError, setSubmitError]     = useState('')

  useEffect(() => {
    fetch(`/api/loans/guarantor?token=${params.token}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setData(d.data)
        else setError({ code: d.code || 'ERROR', message: d.error })
      })
      .catch(() => setError({ code:'ERROR', message:'Failed to load. Please check your connection.' }))
      .finally(() => setLoading(false))
  }, [params.token])

  async function handleRespond(action: 'APPROVE' | 'DECLINE') {
    setSubmitting(true); setSubmitError('')
    try {
      const res = await fetch('/api/loans/guarantor', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action, token: params.token,
          rejectedReason: action === 'DECLINE' ? declineReason : undefined,
        }),
      })
      const d = await res.json()
      if (d.success) setResult({ action, name: data.fullName })
      else setSubmitError(d.error || 'Failed to submit response')
    } catch { setSubmitError('Network error. Please try again.') }
    finally { setSubmitting(false) }
  }

  if (loading) return <LoadingState />
  if (error)   return <ErrorState code={error.code} message={error.message} />
  if (result)  return <SuccessState action={result.action} name={result.name} />

  const loan = data?.loan
  const curr = loan?.currency === 'USD' ? '$' : loan?.currency

  return (
    <div style={{ minHeight:'100vh',background:`linear-gradient(135deg,${NAVY} 0%,#1A3A5C 50%,${TEAL} 100%)`,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',fontFamily:'system-ui,sans-serif' }}>
      <div style={{ width:'100%',maxWidth:'540px' }}>

        {/* Brand */}
        <div style={{ textAlign:'center',marginBottom:'24px' }}>
          <div style={{ width:'52px',height:'52px',background:'rgba(255,255,255,0.15)',borderRadius:'14px',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px',fontSize:'26px' }}>🤝</div>
          <h1 style={{ color:'white',fontSize:'20px',fontWeight:'700',margin:0 }}>Windfall Community Centre</h1>
          <p style={{ color:'rgba(255,255,255,0.6)',fontSize:'13px',margin:'4px 0 0' }}>Loan Guarantee Request</p>
        </div>

        <div style={{ background:'white',borderRadius:'20px',overflow:'hidden',boxShadow:'0 25px 50px rgba(0,0,0,0.3)' }}>

          {/* Header */}
          <div style={{ background:`linear-gradient(135deg,${NAVY},${TEAL})`,padding:'24px 28px' }}>
            <div style={{ fontSize:'12px',color:'rgba(255,255,255,0.6)',marginBottom:'4px' }}>
              {loan?.borrowerName} has requested your guarantee
            </div>
            <div style={{ fontSize:'22px',fontWeight:'700',color:'white',marginBottom:'4px' }}>
              {curr}{fmt(loan?.amount)}
            </div>
            <div style={{ display:'flex',gap:'16px',fontSize:'12px',color:'rgba(255,255,255,0.75)',flexWrap:'wrap' }}>
              <span>📅 {loan?.termMonths} months</span>
              <span>📊 {(Number(loan?.interestRatePa)*100).toFixed(0)}% p.a.</span>
              <span>👥 {loan?.groupName}</span>
              <span style={{ color:'rgba(255,255,255,0.5)' }}>⏰ Expires in {data?.daysLeft}d</span>
            </div>
          </div>

          {/* Content */}
          {step === 'review' && (
            <div style={{ padding:'24px 28px' }}>
              <p style={{ fontSize:'14px',color:'#374151',lineHeight:'1.6',margin:'0 0 20px' }}>
                Hi <strong>{data?.fullName}</strong>, <strong>{loan?.borrowerName}</strong> has applied for a loan
                from <strong>{loan?.groupName}</strong> and has listed you as a guarantor.
              </p>

              {/* Loan details */}
              <div style={{ background:'#F8FAFC',borderRadius:'12px',padding:'16px',marginBottom:'20px',border:'1px solid #E2E8F0' }}>
                <h3 style={{ fontSize:'12px',fontWeight:'600',color:'#64748B',textTransform:'uppercase',letterSpacing:'0.05em',margin:'0 0 12px' }}>Loan Details</h3>
                {[
                  ['Borrower',     loan?.borrowerName],
                  ['Group',        loan?.groupName],
                  ['Loan Amount',  `${curr}${fmt(loan?.amount)}`],
                  ['Term',         `${loan?.termMonths} months`],
                  ['Interest',     `${(Number(loan?.interestRatePa)*100).toFixed(0)}% per annum`],
                  ['Purpose',      loan?.purpose],
                ].map(([l,v]) => (
                  <div key={l} style={{ display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #F1F5F9',fontSize:'13px' }}>
                    <span style={{ color:'#64748B' }}>{l}</span>
                    <span style={{ color:NAVY,fontWeight:'500',maxWidth:'55%',textAlign:'right' }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* What it means */}
              <div style={{ background:'#FEF9C3',borderRadius:'10px',padding:'14px 16px',marginBottom:'24px',border:'1px solid #FCD34D' }}>
                <div style={{ fontSize:'13px',fontWeight:'600',color:'#854D0E',marginBottom:'4px' }}>⚠️ What being a guarantor means</div>
                <ul style={{ margin:'0',paddingLeft:'16px',fontSize:'12px',color:'#92400E',lineHeight:'1.7' }}>
                  <li>You are agreeing to be responsible for this loan if the borrower cannot repay.</li>
                  <li>You may be contacted to make payments if the borrower defaults.</li>
                  <li>This is a serious financial commitment — only approve if you trust the borrower.</li>
                </ul>
              </div>

              {submitError && (
                <div style={{ background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px 14px',color:'#991B1B',fontSize:'12px',marginBottom:'14px' }}>❌ {submitError}</div>
              )}

              {/* Action buttons */}
              <div style={{ display:'flex',gap:'12px' }}>
                <button onClick={() => setStep('confirm_decline')}
                  style={{ flex:1,padding:'13px',background:'#FEF2F2',color:'#991B1B',border:'1px solid #FECACA',borderRadius:'10px',fontSize:'14px',fontWeight:'600',cursor:'pointer' }}>
                  ❌ Decline
                </button>
                <button onClick={() => handleRespond('APPROVE')} disabled={submitting}
                  style={{ flex:2,padding:'13px',background:submitting?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white',border:'none',borderRadius:'10px',fontSize:'14px',fontWeight:'700',cursor:submitting?'not-allowed':'pointer' }}>
                  {submitting ? '⏳ Submitting...' : '✅ Approve Guarantee'}
                </button>
              </div>
            </div>
          )}

          {/* Decline confirmation step */}
          {step === 'confirm_decline' && (
            <div style={{ padding:'24px 28px' }}>
              <h3 style={{ fontSize:'16px',fontWeight:'700',color:NAVY,margin:'0 0 12px' }}>Decline this guarantee?</h3>
              <p style={{ fontSize:'13px',color:'#64748B',marginBottom:'16px',lineHeight:'1.5' }}>
                Please let us know why you are declining. The borrower will be notified.
              </p>
              <div style={{ marginBottom:'16px' }}>
                <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'6px' }}>
                  Reason <span style={{ color:'#94A3B8',fontWeight:'400' }}>(optional)</span>
                </label>
                <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3}
                  placeholder="e.g. Unable to take on financial liability at this time..."
                  style={{ width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any,resize:'vertical' as any }} />
              </div>
              {submitError && (
                <div style={{ background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',marginBottom:'12px' }}>❌ {submitError}</div>
              )}
              <div style={{ display:'flex',gap:'10px' }}>
                <button onClick={() => setStep('review')}
                  style={{ flex:1,padding:'12px',background:'#F1F5F9',border:'none',borderRadius:'10px',fontSize:'13px',cursor:'pointer',color:'#475569',fontWeight:'500' }}>
                  ← Back
                </button>
                <button onClick={() => handleRespond('DECLINE')} disabled={submitting}
                  style={{ flex:2,padding:'12px',background:submitting?'#94A3B8':'#991B1B',color:'white',border:'none',borderRadius:'10px',fontSize:'14px',fontWeight:'700',cursor:submitting?'not-allowed':'pointer' }}>
                  {submitting ? '⏳ Submitting...' : 'Confirm Decline'}
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ padding:'14px 28px',background:'#F8FAFC',borderTop:'1px solid #E2E8F0',textAlign:'center' }}>
            <p style={{ fontSize:'11px',color:'#94A3B8',margin:0 }}>
              This link expires in <strong>{data?.daysLeft} days</strong>. If you did not expect this, you can safely ignore it.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
