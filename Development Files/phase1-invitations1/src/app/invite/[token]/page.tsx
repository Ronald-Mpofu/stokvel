'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'

// ── Field ─────────────────────────────────────────────────────
function Field({ label, value, onChange, type = 'text', placeholder = '', required = false, hint = '' }: any) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
        {label}{required && <span style={{ color: '#DC2626' }}> *</span>}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #E2E8F0', borderRadius: '10px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as any }} />
      {hint && <p style={{ fontSize: '12px', color: '#94A3B8', margin: '4px 0 0' }}>{hint}</p>}
    </div>
  )
}

// ── States ────────────────────────────────────────────────────
function LoadingState() {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0D2137 0%, #0F6E56 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: 'white' }}>
        <div style={{ fontSize: '40px', marginBottom: '16px' }}>⏳</div>
        <p style={{ fontSize: '16px', opacity: 0.8 }}>Loading your invitation...</p>
      </div>
    </div>
  )
}

function ErrorState({ code, message }: { code?: string; message: string }) {
  const router = useRouter()
  const icons: Record<string, string> = { EXPIRED: '⏰', CANCELLED: '🚫', ALREADY_ACCEPTED: '✅' }
  const icon = icons[code || ''] || '❌'

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0D2137 0%, #0F6E56 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '20px', padding: '48px 40px', maxWidth: '440px', width: '100%', textAlign: 'center', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: '56px', marginBottom: '16px' }}>{icon}</div>
        <h2 style={{ fontSize: '20px', fontWeight: '700', color: NAVY, margin: '0 0 12px' }}>
          {code === 'EXPIRED' ? 'Invitation Expired' :
           code === 'CANCELLED' ? 'Invitation Cancelled' :
           code === 'ALREADY_ACCEPTED' ? 'Already Accepted' : 'Invalid Invitation'}
        </h2>
        <p style={{ fontSize: '14px', color: '#64748B', lineHeight: '1.6', margin: '0 0 24px' }}>{message}</p>
        {code === 'ALREADY_ACCEPTED' && (
          <button onClick={() => router.push('/login')}
            style={{ padding: '12px 28px', background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            Go to Login →
          </button>
        )}
        {code !== 'ALREADY_ACCEPTED' && (
          <p style={{ fontSize: '13px', color: '#94A3B8' }}>Please contact the group administrator for a new invitation.</p>
        )}
      </div>
    </div>
  )
}

function SuccessState({ memberName, groupName, loginUrl }: any) {
  const router = useRouter()
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0D2137 0%, #0F6E56 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '20px', padding: '48px 40px', maxWidth: '480px', width: '100%', textAlign: 'center', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
        <h2 style={{ fontSize: '24px', fontWeight: '700', color: NAVY, margin: '0 0 12px' }}>
          Welcome, {memberName.split(' ')[0]}!
        </h2>
        <p style={{ fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0 0 8px' }}>
          You've successfully joined <strong>{groupName}</strong>.
        </p>
        <p style={{ fontSize: '13px', color: '#94A3B8', margin: '0 0 32px' }}>
          Your account is ready. Log in to see your dashboard, track contributions, and manage your membership.
        </p>
        <div style={{ background: '#F0FDF4', borderRadius: '12px', padding: '16px', marginBottom: '28px', border: '1px solid #BBF7D0' }}>
          {[
            '✅ Account created',
            `✅ Joined ${groupName}`,
            '✅ Welcome email sent',
          ].map(item => (
            <div key={item} style={{ fontSize: '13px', color: '#166534', padding: '4px 0', fontWeight: '500' }}>{item}</div>
          ))}
        </div>
        <button onClick={() => router.push('/login')}
          style={{ width: '100%', padding: '14px', background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: '700', cursor: 'pointer' }}>
          🚀 Go to My Dashboard
        </button>
      </div>
    </div>
  )
}

// ── Main invitation page ──────────────────────────────────────
export default function InvitePage({ params }: { params: { token: string } }) {
  const [invitation, setInvitation] = useState<any>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<{ message: string; code?: string } | null>(null)
  const [success, setSuccess]       = useState<{ memberName: string; groupName: string } | null>(null)
  const [step, setStep]             = useState(1) // 1=details, 2=review & accept
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [form, setForm] = useState({
    fullName: '', phone: '', password: '', confirmPassword: '',
    city: '', country: 'Zimbabwe', nationalId: '', agreedToTerms: false,
  })
  const set = (k: string) => (v: any) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    fetch(`/api/invitations?token=${params.token}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setInvitation(data.data)
          // Pre-fill known fields
          if (data.data.fullName) setForm(f => ({ ...f, fullName: data.data.fullName }))
          if (data.data.phone)    setForm(f => ({ ...f, phone: data.data.phone }))
        } else {
          setError({ message: data.error, code: data.code })
        }
      })
      .catch(() => setError({ message: 'Failed to load invitation. Please check your connection.' }))
      .finally(() => setLoading(false))
  }, [params.token])

  function validateStep1() {
    if (!form.fullName.trim() || form.fullName.trim().length < 2) return 'Please enter your full name'
    if (!form.phone.trim() || form.phone.trim().length < 7) return 'Please enter a valid phone number'
    if (!form.password || form.password.length < 8) return 'Password must be at least 8 characters'
    if (form.password !== form.confirmPassword) return 'Passwords do not match'
    return null
  }

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError('')

    if (!form.agreedToTerms) return setSubmitError('You must agree to the terms and conditions to join.')

    setSubmitting(true)
    try {
      const res = await fetch('/api/invitations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:    'ACCEPT',
          token:     params.token,
          fullName:  form.fullName.trim(),
          phone:     form.phone.trim(),
          password:  form.password,
          nationalId: form.nationalId || undefined,
          city:      form.city || undefined,
          country:   form.country,
          agreedToTerms: form.agreedToTerms,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setSuccess({ memberName: form.fullName, groupName: invitation.groupName })
      } else {
        setSubmitError(data.error || 'Failed to create account')
      }
    } catch {
      setSubmitError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading)  return <LoadingState />
  if (error)    return <ErrorState message={error.message} code={error.code} />
  if (success)  return <SuccessState memberName={success.memberName} groupName={success.groupName} loginUrl="/login" />

  const step1Error = step === 2 ? null : validateStep1()
  const inv = invitation

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0D2137 0%, #0F6E56 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: '520px' }}>

        {/* Platform brand */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ width: '52px', height: '52px', background: 'rgba(255,255,255,0.15)', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', fontSize: '26px' }}>🔄</div>
          <h1 style={{ color: 'white', fontSize: '20px', fontWeight: '700', margin: 0 }}>Stokvel Platform</h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', margin: '4px 0 0' }}>Community Wealth Building</p>
        </div>

        <div style={{ background: 'white', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' }}>

          {/* Group invitation banner */}
          <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, padding: '24px 28px' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '4px' }}>
              {inv.invitedByName} invited you to join
            </div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: 'white', marginBottom: '4px' }}>{inv.groupName}</div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'rgba(255,255,255,0.75)', flexWrap: 'wrap' }}>
              <span>💰 {inv.currency === 'USD' ? '$' : inv.currency}{inv.contributionAmount.toLocaleString()}/month</span>
              <span>👥 {inv.memberCount}/{inv.maxMembers} members</span>
              <span>⏰ Expires in {inv.daysLeft} day{inv.daysLeft !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Personal message */}
          {inv.personalMessage && (
            <div style={{ background: '#F0FDF4', padding: '14px 28px', borderBottom: '1px solid #E2E8F0' }}>
              <p style={{ fontSize: '13px', color: '#166534', fontStyle: 'italic', margin: 0 }}>
                "{inv.personalMessage}"
              </p>
              <p style={{ fontSize: '12px', color: '#94A3B8', margin: '4px 0 0' }}>— {inv.invitedByName}</p>
            </div>
          )}

          {/* Step indicator */}
          <div style={{ padding: '20px 28px 0', display: 'flex', alignItems: 'center', gap: '0' }}>
            {[['1','Your Details'], ['2','Review & Join']].map(([num, label], i) => (
              <div key={num} style={{ display: 'flex', alignItems: 'center', flex: i < 1 ? 1 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', background: step > parseInt(num) ? TEAL : step === parseInt(num) ? NAVY : '#E2E8F0', color: step >= parseInt(num) ? 'white' : '#94A3B8' }}>
                    {step > parseInt(num) ? '✓' : num}
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: step === parseInt(num) ? '600' : '400', color: step === parseInt(num) ? NAVY : '#94A3B8', whiteSpace: 'nowrap' }}>{label}</span>
                </div>
                {i < 1 && <div style={{ flex: 1, height: '1px', background: step > 1 ? TEAL : '#E2E8F0', margin: '0 12px' }} />}
              </div>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleAccept}>
            <div style={{ padding: '20px 28px 28px' }}>

              {/* Step 1 — Personal details */}
              {step === 1 && (
                <>
                  <Field label="Full Name" value={form.fullName} onChange={set('fullName')} placeholder="As per your ID document" required />
                  <Field label="Phone Number" value={form.phone} onChange={set('phone')} placeholder="+263 77 xxx xxxx" required />
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>Password <span style={{ color: '#DC2626' }}>*</span></label>
                    <div style={{ position: 'relative' }}>
                      <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => set('password')(e.target.value)}
                        placeholder="Min 8 characters" required minLength={8}
                        style={{ width: '100%', padding: '11px 44px 11px 14px', border: '1.5px solid #E2E8F0', borderRadius: '10px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as any }} />
                      <button type="button" onClick={() => setShowPassword(p => !p)}
                        style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#94A3B8' }}>
                        {showPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                    {form.password.length > 0 && form.password.length < 8 && (
                      <p style={{ fontSize: '11px', color: '#DC2626', margin: '4px 0 0' }}>Password must be at least 8 characters</p>
                    )}
                  </div>
                  <Field label="Confirm Password" value={form.confirmPassword} onChange={set('confirmPassword')}
                    type={showPassword ? 'text' : 'password'} placeholder="Re-enter your password" required />
                  {form.confirmPassword && form.password !== form.confirmPassword && (
                    <p style={{ fontSize: '11px', color: '#DC2626', margin: '-10px 0 12px' }}>Passwords do not match</p>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <Field label="City / Town" value={form.city} onChange={set('city')} placeholder="e.g. Harare" />
                    <Field label="Country" value={form.country} onChange={set('country')} placeholder="Zimbabwe" />
                  </div>
                  <Field label="National ID / Passport" value={form.nationalId} onChange={set('nationalId')} placeholder="Optional — for KYC" hint="Helps verify your identity for the group" />

                  <button type="button"
                    onClick={() => { const err = validateStep1(); if (err) setSubmitError(err); else { setSubmitError(''); setStep(2) } }}
                    style={{ width: '100%', padding: '13px', background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>
                    Continue →
                  </button>
                </>
              )}

              {/* Step 2 — Review & accept */}
              {step === 2 && (
                <>
                  {/* Summary */}
                  <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '16px', marginBottom: '20px', border: '1px solid #E2E8F0' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: '600', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>Joining as</h3>
                    {[
                      ['Name',    form.fullName],
                      ['Phone',   form.phone],
                      ['Email',   inv.email || 'Not provided'],
                      ['City',    form.city || '—'],
                      ['Country', form.country],
                      ['Group',   inv.groupName],
                      ['Role',    inv.role],
                      ['Monthly contribution', `${inv.currency === 'USD' ? '$' : inv.currency}${inv.contributionAmount.toLocaleString()}`],
                    ].map(([l, v]) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: '13px' }}>
                        <span style={{ color: '#64748B' }}>{l}</span>
                        <span style={{ color: NAVY, fontWeight: '500' }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* Terms */}
                  <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px', marginBottom: '16px', border: '1px solid #E2E8F0', maxHeight: '140px', overflowY: 'auto', fontSize: '12px', color: '#475569', lineHeight: '1.7' }}>
                    <strong style={{ color: NAVY }}>Membership Terms & Conditions</strong><br /><br />
                    1. I agree to contribute {inv.currency === 'USD' ? '$' : inv.currency}{inv.contributionAmount.toLocaleString()} monthly on the agreed collection date.<br />
                    2. I understand that late or missed payments attract a penalty as per the group rules.<br />
                    3. I agree to maintain my payout position and not transfer or sell it without group approval.<br />
                    4. I understand that the group operates on a rotating savings model and my payout is based on my position.<br />
                    5. I agree to keep group financial information confidential.<br />
                    6. I acknowledge that my reputation score will be affected by my payment behaviour.<br />
                    7. I consent to the platform collecting and processing my data for the purpose of group management.
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '20px', cursor: 'pointer' }} onClick={() => set('agreedToTerms')(!form.agreedToTerms)}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '6px', border: `2px solid ${form.agreedToTerms ? TEAL : '#CBD5E1'}`, background: form.agreedToTerms ? TEAL : 'white', flexShrink: 0, marginTop: '1px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {form.agreedToTerms && <span style={{ color: 'white', fontSize: '14px', fontWeight: '700' }}>✓</span>}
                    </div>
                    <span style={{ fontSize: '13px', color: '#374151', lineHeight: '1.5' }}>
                      I have read and agree to the membership terms and conditions, and commit to contributing {inv.currency === 'USD' ? '$' : inv.currency}{inv.contributionAmount.toLocaleString()} monthly.
                      <span style={{ color: '#DC2626' }}> *</span>
                    </span>
                  </div>

                  {submitError && (
                    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '12px 14px', color: '#991B1B', fontSize: '13px', marginBottom: '16px' }}>
                      ❌ {submitError}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="button" onClick={() => setStep(1)}
                      style={{ padding: '13px 20px', background: '#F1F5F9', border: 'none', borderRadius: '10px', fontSize: '14px', cursor: 'pointer', color: '#475569', fontWeight: '500' }}>
                      ← Back
                    </button>
                    <button type="submit" disabled={submitting || !form.agreedToTerms}
                      style={{ flex: 1, padding: '13px', background: submitting || !form.agreedToTerms ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: '700', cursor: submitting || !form.agreedToTerms ? 'not-allowed' : 'pointer' }}>
                      {submitting ? '⏳ Creating your account...' : '🎉 Join Group & Create Account'}
                    </button>
                  </div>
                </>
              )}

              {step === 1 && submitError && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '12px 14px', color: '#991B1B', fontSize: '13px', marginTop: '12px' }}>
                  ❌ {submitError}
                </div>
              )}
            </div>
          </form>

          {/* Footer */}
          <div style={{ padding: '14px 28px', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', textAlign: 'center' }}>
            <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0 }}>
              Already have an account? <a href="/login" style={{ color: TEAL, fontWeight: '500' }}>Log in →</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
