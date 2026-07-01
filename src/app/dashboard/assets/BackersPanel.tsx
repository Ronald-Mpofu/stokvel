'use client'
import { useState, useEffect, useCallback } from 'react'

const TEAL   = '#0F6E56'
const NAVY   = '#0D2137'
const PURPLE = '#7C3AED'
const BLUE   = '#1A5EA8'

// ── Status / KYC meta ─────────────────────────────────────────
const STATUS_META: Record<string, { bg: string; color: string; icon: string; label: string }> = {
  PENDING_KYC:      { bg:'#FEF9C3', color:'#854D0E', icon:'⏳', label:'Pending KYC'      },
  PENDING_APPROVAL: { bg:'#DBEAFE', color:'#1E40AF', icon:'🔍', label:'Pending Approval'  },
  ACTIVE:           { bg:'#DCFCE7', color:'#166534', icon:'✅', label:'Active'             },
  SUSPENDED:        { bg:'#FEE2E2', color:'#991B1B', icon:'⏸️', label:'Suspended'         },
  WITHDRAWN:        { bg:'#F1F5F9', color:'#475569', icon:'↩️', label:'Withdrawn'         },
  REJECTED:         { bg:'#FEE2E2', color:'#7F1D1D', icon:'❌', label:'Rejected'          },
}

const KYC_META: Record<string, { bg: string; color: string; label: string }> = {
  NOT_SUBMITTED: { bg:'#F1F5F9', color:'#475569', label:'Not Submitted' },
  SUBMITTED:     { bg:'#FEF9C3', color:'#854D0E', label:'Under Review'  },
  VERIFIED:      { bg:'#DCFCE7', color:'#166534', label:'Verified ✓'    },
  REJECTED:      { bg:'#FEE2E2', color:'#991B1B', label:'Rejected'      },
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

// ── Pill components ───────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] || { bg:'#F1F5F9', color:'#475569', icon:'?', label: status }
  return (
    <span style={{ background: m.bg, color: m.color, fontSize:'11px', fontWeight:'600', padding:'3px 9px', borderRadius:'999px', display:'inline-flex', alignItems:'center', gap:'4px', whiteSpace:'nowrap' }}>
      {m.icon} {m.label}
    </span>
  )
}

function KycPill({ status }: { status: string }) {
  const m = KYC_META[status] || KYC_META.NOT_SUBMITTED
  return <span style={{ background: m.bg, color: m.color, fontSize:'10px', fontWeight:'600', padding:'2px 7px', borderRadius:'4px' }}>KYC: {m.label}</span>
}

function Toast({ msg, type, onClose }: any) {
  useEffect(() => { const t = setTimeout(onClose, 5000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position:'fixed', top:'20px', right:'20px', zIndex:9999, padding:'12px 20px', borderRadius:'10px', fontWeight:'500', fontSize:'13px', boxShadow:'0 8px 25px rgba(0,0,0,0.15)', background: type==='success'?'#166534':'#991B1B', color:'white', display:'flex', alignItems:'center', gap:'10px', maxWidth:'400px' }}>
      <span>{type==='success'?'✅':'❌'}</span><span style={{ flex:1 }}>{msg}</span>
      <button onClick={onClose} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:'18px' }}>×</button>
    </div>
  )
}

// ── Field helpers ─────────────────────────────────────────────
function Field({ label, value, onChange, type='text', placeholder='', required=false, hint='' }: any) {
  return (
    <div style={{ marginBottom:'13px' }}>
      <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
        {label}{required && <span style={{ color:'#DC2626' }}> *</span>}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required}
        style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }} />
      {hint && <p style={{ fontSize:'11px', color:'#94A3B8', margin:'4px 0 0' }}>{hint}</p>}
    </div>
  )
}

// ── Register Backer Modal ─────────────────────────────────────
function RegisterModal({ asset, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ fullName:'', email:'', phone:'', nationalId:'', country:'Zimbabwe', city:'', occupation:'', agreed:false })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k: string) => (v: any) => setForm(p => ({ ...p, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.agreed) return setError('You must agree to the terms and conditions')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/assets/backers', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...form, assetId: asset.id, agreedToTerms: form.agreed }),
      })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error || 'Registration failed')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'20px' }}>
      <div style={{ background:'white', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'520px', maxHeight:'90vh', overflowY:'auto', boxShadow:'0 25px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'20px' }}>
          <div>
            <h3 style={{ fontSize:'17px', fontWeight:'700', color:NAVY, margin:'0 0 4px' }}>🌐 Register as Outside Backer</h3>
            <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>{asset.name}</p>
          </div>
          <button onClick={onClose} style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', width:'32px', height:'32px', cursor:'pointer', fontSize:'18px', color:'#64748B' }}>×</button>
        </div>

        {/* Info banner */}
        <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:'10px', padding:'12px 14px', marginBottom:'20px', fontSize:'12px', color:'#166534' }}>
          <strong>What is a Backer?</strong> As an outside contributor you can fund this campaign and receive a proportional ownership stake. You are not a group member — you cannot vote on group decisions or access other group modules. Full KYC verification is required.
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            <div style={{ gridColumn:'1/-1' }}><Field label="Full Name" value={form.fullName} onChange={set('fullName')} placeholder="As per your ID document" required /></div>
            <Field label="Email Address" value={form.email} onChange={set('email')} type="email" placeholder="your@email.com" required />
            <Field label="Phone Number" value={form.phone} onChange={set('phone')} placeholder="+263 77 xxx xxxx" required />
            <Field label="National ID / Passport" value={form.nationalId} onChange={set('nationalId')} placeholder="ID number" hint="Stored securely — required for KYC" />
            <Field label="Occupation" value={form.occupation} onChange={set('occupation')} placeholder="e.g. Farmer, Engineer" />
            <Field label="Country" value={form.country} onChange={set('country')} placeholder="Zimbabwe" />
            <Field label="City / Town" value={form.city} onChange={set('city')} placeholder="e.g. Harare" />
          </div>

          {/* Terms */}
          <div style={{ background:'#F8FAFC', borderRadius:'10px', padding:'14px', marginBottom:'14px', border:'1px solid #E2E8F0', maxHeight:'120px', overflowY:'auto', fontSize:'12px', color:'#475569', lineHeight:'1.6' }}>
            <strong style={{ color:NAVY }}>Terms & Conditions for Outside Contributors</strong><br /><br />
            1. I understand I am contributing as a non-member backer and will receive proportional ownership only.<br />
            2. I will not have voting rights or access to the group's savings, loans, or payout programmes.<br />
            3. My contribution is subject to KYC verification and group admin approval before I can contribute funds.<br />
            4. My ownership stake is calculated proportionally based on my contribution relative to the total funds raised.<br />
            5. I may only sell or transfer my stake through the platform's internal process with admin approval.<br />
            6. I consent to my personal data being processed for identity verification and financial record-keeping purposes.
          </div>
          <div style={{ display:'flex', alignItems:'flex-start', gap:'10px', marginBottom:'16px', cursor:'pointer' }} onClick={() => set('agreed')(!form.agreed)}>
            <div style={{ width:'20px', height:'20px', borderRadius:'4px', border:`2px solid ${form.agreed?TEAL:'#CBD5E1'}`, background:form.agreed?TEAL:'white', flexShrink:0, marginTop:'1px', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {form.agreed && <span style={{ color:'white', fontSize:'13px', fontWeight:'700' }}>✓</span>}
            </div>
            <span style={{ fontSize:'12px', color:'#374151' }}>I have read and agree to the terms and conditions for outside contributors <span style={{ color:'#DC2626' }}>*</span></span>
          </div>

          {error && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'8px', padding:'10px', color:'#991B1B', fontSize:'12px', marginBottom:'12px' }}>❌ {error}</div>}

          <div style={{ display:'flex', gap:'10px' }}>
            <button type="button" onClick={onClose} style={{ flex:1, padding:'10px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#475569' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ flex:2, padding:'10px', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:saving?'not-allowed':'pointer', background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`, color:'white' }}>
              {saving ? '⏳ Submitting...' : '✓ Submit Application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Backer Detail Panel ────────────────────────────────────────
function BackerDetail({ backer, asset, onClose, onAction, onContribute }: any) {
  const [amount, setAmount]   = useState('')
  const [method, setMethod]   = useState('BANK_TRANSFER')
  const [ref, setRef]         = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [tab, setTab]         = useState<'overview'|'contributions'|'kyc'>('overview')

  const canApprove  = backer.kycStatus === 'VERIFIED' && backer.status === 'PENDING_APPROVAL'
  const canContrib  = backer.status === 'ACTIVE'
  const canKycVerify = backer.kycStatus === 'SUBMITTED'

  async function handleContrib(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || parseFloat(amount) <= 0) return setError('Enter valid amount')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/assets/backers', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'CONTRIBUTE', backerId:backer.id, assetId:asset.id, amount:parseFloat(amount), paymentMethod:method, paymentRef:ref }),
      })
      const data = await res.json()
      if (data.success) { onContribute(data.message); setAmount(''); setRef('') }
      else setError(data.error || 'Failed')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  const initials = backer.fullName.split(' ').map((n: string) => n[0]).join('').slice(0, 2)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'20px' }}>
      <div style={{ background:'white', borderRadius:'16px', width:'100%', maxWidth:'600px', maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 25px 60px rgba(0,0,0,0.3)', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ background:NAVY, padding:'20px 24px', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'14px' }}>
            <div style={{ width:'48px', height:'48px', borderRadius:'50%', background:TEAL, color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px', fontWeight:'700', flexShrink:0 }}>{initials}</div>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                <span style={{ fontSize:'17px', fontWeight:'700', color:'white' }}>{backer.fullName}</span>
                <StatusPill status={backer.status} />
                <KycPill status={backer.kycStatus} />
              </div>
              <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.6)', marginTop:'2px' }}>{backer.email} · {backer.phone}</div>
            </div>
            <button onClick={onClose} style={{ width:'32px', height:'32px', background:'rgba(255,255,255,0.15)', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'18px', color:'white' }}>×</button>
          </div>
          {/* Stats strip */}
          <div style={{ display:'flex', gap:'20px', marginTop:'14px', paddingTop:'14px', borderTop:'1px solid rgba(255,255,255,0.1)' }}>
            {[
              { label:'Contributed',  value:`$${fmt(backer.totalContributed)}` },
              { label:'Ownership',    value:`${backer.ownershipPct.toFixed(4)}%` },
              { label:'Contributions',value: backer.contributions.length },
              { label:'Since',        value: new Date(backer.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{s.label}</div>
                <div style={{ fontSize:'15px', fontWeight:'700', color:'white', marginTop:'2px' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display:'flex', gap:'8px', padding:'12px 24px', background:'#F8FAFC', borderBottom:'1px solid #E2E8F0', flexShrink:0, flexWrap:'wrap' }}>
          {canApprove && (
            <button onClick={() => onAction('APPROVE', backer.id)} style={{ padding:'7px 14px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:'600', cursor:'pointer' }}>✅ Approve Backer</button>
          )}
          {canKycVerify && (
            <button onClick={() => onAction('KYC_VERIFY', backer.id)} style={{ padding:'7px 14px', background:'#166534', color:'white', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:'600', cursor:'pointer' }}>🪪 Verify KYC</button>
          )}
          {backer.status === 'ACTIVE' && (
            <button onClick={() => onAction('SUSPEND', backer.id)} style={{ padding:'7px 14px', background:'#FEF9C3', color:'#854D0E', border:'1px solid #FCD34D', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>⏸️ Suspend</button>
          )}
          {backer.status === 'SUSPENDED' && (
            <button onClick={() => onAction('REINSTATE', backer.id)} style={{ padding:'7px 14px', background:'#DCFCE7', color:'#166534', border:'1px solid #86EFAC', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>✅ Reinstate</button>
          )}
          {['PENDING_KYC','PENDING_APPROVAL'].includes(backer.status) && (
            <button onClick={() => onAction('REJECT', backer.id)} style={{ padding:'7px 14px', background:'#FEF2F2', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>❌ Reject</button>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid #E2E8F0', flexShrink:0 }}>
          {[['overview','📋 Overview'],['contributions','💰 Contributions'],['kyc','🪪 KYC']].map(([id,label]) => (
            <button key={id} onClick={() => setTab(id as any)} style={{ padding:'10px 18px', background:'none', border:'none', borderBottom:tab===id?`2px solid ${TEAL}`:'2px solid transparent', color:tab===id?TEAL:'#64748B', fontWeight:tab===id?'600':'400', fontSize:'13px', cursor:'pointer', marginBottom:'-1px' }}>{label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>

          {tab === 'overview' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                {[
                  ['Full Name',    backer.fullName],
                  ['Email',        backer.email],
                  ['Phone',        backer.phone],
                  ['Country',      backer.country || '—'],
                  ['City',         backer.city || '—'],
                  ['Occupation',   backer.occupation || '—'],
                  ['Status',       backer.status.replace('_',' ')],
                  ['KYC Status',   backer.kycStatus.replace('_',' ')],
                  ['Applied',      new Date(backer.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})],
                  ['Approved',     backer.approvedAt ? new Date(backer.approvedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'],
                  ['Terms signed', backer.agreedToTermsAt ? new Date(backer.agreedToTermsAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'],
                  ['Referral code',backer.referralCode?.slice(0,12) + '...'],
                ].map(([l,v]) => (
                  <div key={l} style={{ background:'#F8FAFC', borderRadius:'8px', padding:'10px 12px' }}>
                    <div style={{ fontSize:'10px', color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.04em' }}>{l}</div>
                    <div style={{ fontSize:'13px', fontWeight:'500', color:NAVY, marginTop:'2px' }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Ownership stake visual */}
              <div style={{ background:'#F0FDF4', borderRadius:'10px', padding:'14px', border:'1px solid #BBF7D0' }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', color:'#166534', marginBottom:'6px' }}>
                  <span>Ownership stake</span>
                  <span style={{ fontWeight:'700' }}>{backer.ownershipPct.toFixed(4)}%</span>
                </div>
                <div style={{ height:'8px', background:'rgba(22,101,52,0.15)', borderRadius:'4px', overflow:'hidden' }}>
                  <div style={{ height:'100%', background:TEAL, borderRadius:'4px', width:`${Math.min(100, backer.ownershipPct)}%` }} />
                </div>
                <div style={{ fontSize:'12px', color:'#166534', marginTop:'6px' }}>
                  ${fmt(backer.totalContributed)} contributed · Share value: ${fmt(asset.raisedAmount * backer.ownershipPct / 100)}
                </div>
              </div>

              {/* Record contribution */}
              {canContrib && (
                <div style={{ background:'white', borderRadius:'10px', border:'1px solid #E2E8F0', padding:'16px' }}>
                  <h4 style={{ fontSize:'13px', fontWeight:'600', color:NAVY, margin:'0 0 12px' }}>💰 Record Contribution</h4>
                  <form onSubmit={handleContrib}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'10px' }}>
                      <div>
                        <label style={{ display:'block', fontSize:'11px', fontWeight:'600', color:'#374151', marginBottom:'4px' }}>Amount ($) *</label>
                        <div style={{ position:'relative' }}>
                          <span style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'#64748B', fontSize:'13px' }}>$</span>
                          <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required
                            style={{ width:'100%', padding:'8px 10px 8px 24px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'14px', fontWeight:'600', outline:'none', boxSizing:'border-box' as any }} />
                        </div>
                      </div>
                      <div>
                        <label style={{ display:'block', fontSize:'11px', fontWeight:'600', color:'#374151', marginBottom:'4px' }}>Method</label>
                        <select value={method} onChange={e => setMethod(e.target.value)}
                          style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white' }}>
                          {[['BANK_TRANSFER','🏦 Bank Transfer'],['ECOCASH','📱 EcoCash'],['CARD','💳 Card'],['CASH','💵 Cash']].map(([v,l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <input type="text" value={ref} onChange={e => setRef(e.target.value)} placeholder="Payment reference (optional)"
                      style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any, marginBottom:'10px' }} />
                    {error && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'6px', padding:'8px', color:'#991B1B', fontSize:'12px', marginBottom:'8px' }}>❌ {error}</div>}
                    <button type="submit" disabled={saving} style={{ width:'100%', padding:'9px', background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:saving?'not-allowed':'pointer' }}>
                      {saving ? '⏳ Recording...' : '✓ Record Contribution'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {tab === 'contributions' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
              {backer.contributions.length === 0 ? (
                <div style={{ textAlign:'center', padding:'40px', color:'#94A3B8' }}>
                  <div style={{ fontSize:'32px', marginBottom:'8px' }}>💰</div>
                  <p>No contributions recorded yet.</p>
                </div>
              ) : (
                <>
                  <div style={{ background:'#F0FDF4', borderRadius:'8px', padding:'12px 14px', border:'1px solid #BBF7D0', display:'flex', justifyContent:'space-between', fontSize:'13px', color:'#166534' }}>
                    <span>Total contributed</span>
                    <strong>${fmt(backer.totalContributed)}</strong>
                  </div>
                  {backer.contributions.map((c: any) => (
                    <div key={c.id} style={{ background:'white', borderRadius:'10px', border:'1px solid #E2E8F0', padding:'12px 16px', display:'flex', alignItems:'center', gap:'12px' }}>
                      <div style={{ width:'36px', height:'36px', borderRadius:'50%', background:'#E1F5EE', color:TEAL, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px', flexShrink:0 }}>💰</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:'14px', fontWeight:'600', color:NAVY }}>${fmt(c.amount)}</div>
                        <div style={{ fontSize:'11px', color:'#94A3B8', marginTop:'2px' }}>
                          {c.paymentMethod?.replace('_',' ')} {c.paymentRef ? `· Ref: ${c.paymentRef}` : ''} {c.notes ? `· ${c.notes}` : ''}
                        </div>
                      </div>
                      <div style={{ fontSize:'11px', color:'#94A3B8', textAlign:'right' }}>
                        {new Date(c.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === 'kyc' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
              <div style={{ background: KYC_META[backer.kycStatus]?.bg || '#F1F5F9', borderRadius:'10px', padding:'14px 16px', border:`1px solid ${backer.kycStatus==='VERIFIED'?'#86EFAC':backer.kycStatus==='REJECTED'?'#FECACA':'#E2E8F0'}` }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY }}>KYC Status</div>
                    <KycPill status={backer.kycStatus} />
                  </div>
                  {backer.kycVerifiedAt && <div style={{ fontSize:'11px', color:'#64748B' }}>Verified: {new Date(backer.kycVerifiedAt).toLocaleDateString('en-GB')}</div>}
                </div>
              </div>

              {backer.kycDocumentUrl && (
                <div style={{ background:'white', borderRadius:'10px', border:'1px solid #E2E8F0', padding:'14px' }}>
                  <div style={{ fontSize:'12px', fontWeight:'600', color:NAVY, marginBottom:'8px' }}>Submitted Documents</div>
                  <a href={backer.kycDocumentUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:'6px', padding:'7px 14px', background:'#DBEAFE', color:'#1E40AF', borderRadius:'8px', fontSize:'12px', fontWeight:'500', textDecoration:'none' }}>
                    🔗 View Document
                  </a>
                </div>
              )}

              {backer.kycStatus === 'REJECTED' && backer.kycRejectionNote && (
                <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'10px', padding:'14px', fontSize:'12px', color:'#991B1B' }}>
                  <strong>Rejection reason:</strong> {backer.kycRejectionNote}
                </div>
              )}

              {/* KYC actions */}
              <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                {canKycVerify && (
                  <button onClick={() => onAction('KYC_VERIFY', backer.id)}
                    style={{ padding:'10px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
                    ✅ Verify KYC Documents
                  </button>
                )}
                {backer.kycStatus === 'SUBMITTED' && (
                  <button onClick={() => onAction('KYC_REJECT', backer.id)}
                    style={{ padding:'10px', background:'#FEF2F2', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'8px', fontSize:'13px', cursor:'pointer' }}>
                    ❌ Reject KYC — Request Resubmission
                  </button>
                )}
              </div>

              <div style={{ background:'#F8FAFC', borderRadius:'8px', padding:'12px 14px', fontSize:'12px', color:'#64748B', lineHeight:'1.6' }}>
                <strong style={{ color:NAVY }}>KYC Workflow:</strong><br />
                Backer submits → Status: "Under Review" → Admin verifies → Status: "Verified" → Admin can then Approve backer → Status: "Active" → Backer can contribute.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Backers Panel ─────────────────────────────────────────
export default function BackersPanel({ asset, onClose }: { asset: any; onClose: () => void }) {
  const [data, setData]         = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [toast, setToast]       = useState<any>(null)
  const [showRegister, setShowRegister] = useState(false)
  const [selectedBacker, setSelectedBacker] = useState<any>(null)
  const [search, setSearch]     = useState('')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [tab, setTab]           = useState<'all'|'pending'|'active'>('all')

  function showToast(msg: string, type: 'success'|'error' = 'success') { setToast({ msg, type }) }

  const fetchBackers = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/assets/backers?assetId=${asset.id}`)
      const json = await res.json()
      if (json.success) setData(json.data)
      else showToast(json.error || 'Failed to load', 'error')
    } catch { showToast('Network error', 'error') }
    finally { setLoading(false) }
  }, [asset.id])

  async function toggleOutsiders() {
    try {
      const res  = await fetch('/api/assets', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ assetId: asset.id, allowOutsiders: !asset.allowOutsiders }) })
      const json = await res.json()
      if (json.success) { showToast(json.message); fetchBackers(); asset.allowOutsiders = !asset.allowOutsiders }
      else showToast(json.error || 'Failed to update', 'error')
    } catch { showToast('Network error', 'error') }
  }

  useEffect(() => { fetchBackers() }, [fetchBackers])

  async function handleAction(action: string, backerId: string) {
    try {
      let body: any = { action: action.startsWith('KYC') ? 'KYC' : action, backerId }
      if (action === 'KYC_VERIFY') body = { action: 'KYC', backerId, action2: 'VERIFY' }
      if (action === 'KYC_REJECT') body = { action: 'KYC', backerId, action2: 'REJECT', rejectionNote: 'Documents unclear — please resubmit' }

      // Map KYC sub-actions
      if (action === 'KYC_VERIFY') body = { action: 'KYC', backerId }

      let apiBody: any = { backerId }
      if (action === 'APPROVE')    apiBody = { action:'APPROVE',    backerId }
      if (action === 'REJECT')     apiBody = { action:'REJECT',     backerId, reason:'Application rejected by admin' }
      if (action === 'SUSPEND')    apiBody = { action:'SUSPEND',    backerId }
      if (action === 'REINSTATE')  apiBody = { action:'REINSTATE',  backerId }
      // Re-build properly
      if (action === 'KYC_VERIFY') { apiBody = { backerId }; apiBody.action = 'KYC'; apiBody.kycAction = 'VERIFY' }

      // Simpler approach
      const payload = action === 'KYC_VERIFY'
        ? { action:'KYC',     backerId, action:'VERIFY' }
        : action === 'KYC_REJECT'
        ? { action:'KYC',     backerId, action:'REJECT', rejectionNote:'Please resubmit clearer documents' }
        : { action,           backerId }

      const res  = await fetch('/api/assets/backers', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (json.success) { showToast(json.message); fetchBackers(); setSelectedBacker(null) }
      else showToast(json.error || 'Action failed', 'error')
    } catch { showToast('Network error', 'error') }
  }

  // Filter
  const backers = data?.backers || []
  const filtered = backers.filter((b: any) => {
    const ms  = b.fullName.toLowerCase().includes(search.toLowerCase()) || b.email.toLowerCase().includes(search.toLowerCase())
    const mst = filterStatus === 'ALL' || b.status === filterStatus
    const mt  = tab === 'all' ? true : tab === 'pending' ? ['PENDING_KYC','PENDING_APPROVAL'].includes(b.status) : b.status === 'ACTIVE'
    return ms && mst && mt
  })

  const pending = backers.filter((b: any) => ['PENDING_KYC','PENDING_APPROVAL'].includes(b.status)).length
  const active  = backers.filter((b: any) => b.status === 'ACTIVE').length

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {showRegister && <RegisterModal asset={asset} onClose={() => setShowRegister(false)} onSuccess={(msg: string) => { showToast(msg); fetchBackers() }} />}
      {selectedBacker && (
        <BackerDetail
          backer={selectedBacker}
          asset={data?.asset || asset}
          onClose={() => setSelectedBacker(null)}
          onAction={(action: string, id: string) => { handleAction(action, id) }}
          onContribute={(msg: string) => { showToast(msg); fetchBackers()
            // Refresh selected backer data
            fetch(`/api/assets/backers?backerId=${selectedBacker.id}`).then(r=>r.json()).then(d=>{ if(d.success) setSelectedBacker(d.data) })
          }}
        />
      )}

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
        <button onClick={onClose} style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', padding:'8px 14px', cursor:'pointer', fontSize:'13px', color:'#475569' }}>← Back</button>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <h2 style={{ fontSize:'18px', fontWeight:'700', color:NAVY, margin:0 }}>🌐 Outside Backers</h2>
            {!asset.allowOutsiders && <span style={{ background:'#FEE2E2', color:'#991B1B', fontSize:'11px', fontWeight:'600', padding:'3px 9px', borderRadius:'999px' }}>⚠️ Disabled for this campaign</span>}
          </div>
          <p style={{ fontSize:'12px', color:'#64748B', margin:'2px 0 0' }}>{asset.name}</p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={fetchBackers} style={{ padding:'8px 12px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#475569' }}>↻</button>
          {asset.allowOutsiders && (
            <button onClick={() => setShowRegister(true)} style={{ padding:'9px 18px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>+ Register Backer</button>
          )}
        </div>
      </div>

      {/* Enable / Disable toggle */}
      <div style={{ background: asset.allowOutsiders ? '#F0FDF4' : '#FEF9C3', border: `1px solid ${asset.allowOutsiders ? '#86EFAC' : '#FCD34D'}`, borderRadius:'12px', padding:'16px 20px', display:'flex', alignItems:'center', gap:'16px' }}>
        <span style={{ fontSize:'24px' }}>{asset.allowOutsiders ? '🌐' : '⚠️'}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:'13px', fontWeight:'600', color: asset.allowOutsiders ? '#166534' : '#854D0E', marginBottom:'4px' }}>
            {asset.allowOutsiders ? 'Outside contributors are ENABLED for this campaign' : 'Outside contributors are DISABLED for this campaign'}
          </div>
          <div style={{ fontSize:'12px', color: asset.allowOutsiders ? '#166534' : '#854D0E', opacity:0.8 }}>
            {asset.allowOutsiders
              ? 'Non-members can register, complete KYC, and contribute to this campaign in exchange for a proportional ownership stake.'
              : 'Enable this to allow people outside the group to fund this campaign and receive a proportional ownership stake.'}
          </div>
        </div>
        <button onClick={toggleOutsiders}
          style={{ padding:'9px 18px', background: asset.allowOutsiders ? '#FEF2F2' : TEAL, color: asset.allowOutsiders ? '#991B1B' : 'white', border: `1px solid ${asset.allowOutsiders ? '#FECACA' : 'transparent'}`, borderRadius:'8px', fontSize:'12px', fontWeight:'600', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
          {asset.allowOutsiders ? '🔒 Disable Backers' : '🔓 Enable Backers'}
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px' }}>
        {[
          { label:'Total Backers',   value: loading?'—':backers.length,                                   color:NAVY    },
          { label:'Pending Review',  value: loading?'—':pending,                                           color:'#854D0E' },
          { label:'Active Backers',  value: loading?'—':active,                                            color:TEAL    },
          { label:'Total Backed',    value: loading?'—':`$${fmt(data?.summary?.totalBacked||0)}`,          color:BLUE    },
        ].map(s => (
          <div key={s.label} style={{ background:'white', borderRadius:'10px', padding:'14px', border:'1px solid #E2E8F0' }}>
            <div style={{ fontSize:'11px', color:'#64748B', marginBottom:'4px' }}>{s.label}</div>
            <div style={{ fontSize:'22px', fontWeight:'700', color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs + filters */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'10px' }}>
        <div style={{ display:'flex', borderBottom:'1px solid #E2E8F0' }}>
          {[
            ['all',     `All (${backers.length})`],
            ['pending', `Pending (${pending})`],
            ['active',  `Active (${active})`],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id as any)} style={{ padding:'8px 16px', background:'none', border:'none', borderBottom:tab===id?`2px solid ${TEAL}`:'2px solid transparent', color:tab===id?TEAL:'#64748B', fontWeight:tab===id?'600':'400', fontSize:'13px', cursor:'pointer', marginBottom:'-1px', whiteSpace:'nowrap' }}>{label}</button>
          ))}
        </div>
        <input placeholder="Search backers..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding:'7px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', width:'220px', outline:'none' }} />
      </div>

      {/* Backers list */}
      {loading ? (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'28px', marginBottom:'10px' }}>⏳</div>
          <p style={{ color:'#64748B' }}>Loading backers...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'40px', marginBottom:'12px' }}>🌐</div>
          <h3 style={{ fontSize:'16px', fontWeight:'600', color:NAVY, margin:'0 0 8px' }}>
            {backers.length === 0 ? 'No backers yet' : 'No backers match your filter'}
          </h3>
          <p style={{ color:'#64748B', fontSize:'13px', marginBottom:'20px' }}>
            {backers.length === 0 && asset.allowOutsiders ? 'Register the first outside backer to get started.' : ''}
          </p>
          {backers.length === 0 && asset.allowOutsiders && (
            <button onClick={() => setShowRegister(true)} style={{ padding:'10px 20px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>+ Register First Backer</button>
          )}
        </div>
      ) : (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#F8FAFC' }}>
                {['Backer','Location','Status','KYC','Contributed','Ownership %','Applied','Actions'].map(h => (
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:'10px', fontWeight:'600', color:'#64748B', borderBottom:'1px solid #E2E8F0', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((b: any, i: number) => (
                <tr key={b.id} style={{ borderBottom:'1px solid #F8FAFC', background: b.status==='ACTIVE'?'#FAFFFE':['PENDING_KYC','PENDING_APPROVAL'].includes(b.status)?'#FFFBEB': i%2===0?'white':'#FAFAFA' }}>
                  <td style={{ padding:'11px 14px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                      <div style={{ width:'32px', height:'32px', borderRadius:'50%', background:'#E1F5EE', color:TEAL, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'700', flexShrink:0 }}>
                        {b.fullName.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                      </div>
                      <div>
                        <div style={{ fontSize:'13px', fontWeight:'500', color:NAVY }}>{b.fullName}</div>
                        <div style={{ fontSize:'11px', color:'#94A3B8' }}>{b.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding:'11px 14px', fontSize:'12px', color:'#475569' }}>{b.city || '—'}, {b.country || '—'}</td>
                  <td style={{ padding:'11px 14px' }}><StatusPill status={b.status} /></td>
                  <td style={{ padding:'11px 14px' }}><KycPill status={b.kycStatus} /></td>
                  <td style={{ padding:'11px 14px', fontSize:'13px', fontWeight:'600', color:TEAL }}>${fmt(b.totalContributed)}</td>
                  <td style={{ padding:'11px 14px', fontSize:'13px', fontWeight:'600', color:NAVY }}>{b.ownershipPct.toFixed(4)}%</td>
                  <td style={{ padding:'11px 14px', fontSize:'11px', color:'#94A3B8' }}>{new Date(b.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'})}</td>
                  <td style={{ padding:'11px 14px' }}>
                    <div style={{ display:'flex', gap:'4px' }}>
                      <button onClick={() => setSelectedBacker(b)} style={{ padding:'4px 10px', background:'#F1F5F9', border:'none', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#475569', fontWeight:'500' }}>View</button>
                      {b.status === 'PENDING_APPROVAL' && b.kycStatus === 'VERIFIED' && (
                        <button onClick={() => handleAction('APPROVE', b.id)} style={{ padding:'4px 10px', background:'#DCFCE7', border:'none', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#166534', fontWeight:'600' }}>Approve</button>
                      )}
                      {b.kycStatus === 'SUBMITTED' && (
                        <button onClick={() => handleAction('KYC_VERIFY', b.id)} style={{ padding:'4px 10px', background:'#DBEAFE', border:'none', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#1E40AF', fontWeight:'500' }}>Verify KYC</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Ownership breakdown */}
      {active > 0 && data && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px' }}>
          <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 14px' }}>📊 Backer Ownership Breakdown</h3>
          {backers.filter((b: any) => b.status === 'ACTIVE' && b.ownershipPct > 0).sort((a: any, b: any) => b.ownershipPct - a.ownershipPct).map((b: any) => (
            <div key={b.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'7px 0', borderBottom:'1px solid #F8FAFC' }}>
              <div style={{ width:'30px', height:'30px', borderRadius:'50%', background:'#E1F5EE', color:TEAL, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'700', flexShrink:0 }}>
                {b.fullName.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
              </div>
              <span style={{ width:'160px', fontSize:'13px', color:NAVY, fontWeight:'500', flexShrink:0 }}>{b.fullName}</span>
              <div style={{ flex:1, height:'8px', background:'#F1F5F9', borderRadius:'4px', overflow:'hidden' }}>
                <div style={{ height:'100%', background:TEAL, borderRadius:'4px', width:`${Math.min(100,b.ownershipPct)}%` }} />
              </div>
              <span style={{ width:'52px', fontSize:'12px', fontWeight:'700', color:TEAL, textAlign:'right', flexShrink:0 }}>{b.ownershipPct.toFixed(2)}%</span>
              <span style={{ width:'80px', fontSize:'12px', color:'#475569', textAlign:'right', flexShrink:0 }}>${fmt(b.totalContributed)}</span>
            </div>
          ))}
          <div style={{ marginTop:'10px', fontSize:'12px', color:'#94A3B8', display:'flex', justifyContent:'space-between' }}>
            <span>Total backer ownership: <strong style={{ color:TEAL }}>{backers.filter((b:any)=>b.status==='ACTIVE').reduce((s:number,b:any)=>s+b.ownershipPct,0).toFixed(4)}%</strong></span>
            <span>Total backed: <strong style={{ color:TEAL }}>${fmt(data.summary.totalBacked)}</strong></span>
          </div>
        </div>
      )}
    </div>
  )
}
