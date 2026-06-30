'use client'
import { useState, useEffect, useCallback, useRef } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const BLUE = '#1A5EA8'

// ── Category definitions ───────────────────────────────────────
const CATEGORIES = [
  { value: 'PURCHASE',  label: '🛒 Purchase',           color: '#1A5EA8', bg: '#DBEAFE' },
  { value: 'FREIGHT',   label: '🚢 Freight & Shipping',  color: '#0F6E56', bg: '#DCFCE7' },
  { value: 'CUSTOMS',   label: '🛃 Customs & Duty',      color: '#B45309', bg: '#FEF9C3' },
  { value: 'SERVICES',  label: '🔧 Services & Fees',     color: '#7C3AED', bg: '#F3E8FF' },
  { value: 'INSURANCE', label: '🛡️ Insurance',           color: '#BE185D', bg: '#FCE7F3' },
  { value: 'OTHER',     label: '📦 Other',               color: '#475569', bg: '#F1F5F9' },
]

const CAT = (v: string) => CATEGORIES.find(c => c.value === v) || CATEGORIES[5]

// Default line items for a new sheet
const DEFAULT_ITEMS = [
  { category: 'PURCHASE',  description: 'Purchase price (ex-works / FOB)',  amount: '', isPerUnit: true,  isOptional: false, included: true, notes: '' },
  { category: 'FREIGHT',   description: 'International freight (sea/air)',   amount: '', isPerUnit: false, isOptional: false, included: true, notes: '' },
  { category: 'INSURANCE', description: 'Marine / transit insurance',        amount: '', isPerUnit: false, isOptional: false, included: true, notes: '~0.5-1% of CIF value' },
  { category: 'CUSTOMS',   description: 'Import duty',                       amount: '', isPerUnit: false, isOptional: false, included: true, notes: 'Check HS code rate' },
  { category: 'CUSTOMS',   description: 'VAT / surtax on import',            amount: '', isPerUnit: false, isOptional: false, included: true, notes: '' },
  { category: 'SERVICES',  description: 'Customs clearing / broker fee',     amount: '', isPerUnit: false, isOptional: false, included: true, notes: '' },
  { category: 'SERVICES',  description: 'Port handling & storage',           amount: '', isPerUnit: false, isOptional: false, included: true, notes: '' },
  { category: 'SERVICES',  description: 'Inland transport (port → site)',    amount: '', isPerUnit: false, isOptional: false, included: true, notes: '' },
  { category: 'SERVICES',  description: 'Installation & commissioning',      amount: '', isPerUnit: false, isOptional: true,  included: true, notes: '' },
  { category: 'OTHER',     description: 'Miscellaneous / contingency buffer',amount: '', isPerUnit: false, isOptional: true,  included: false, notes: 'Add anything not captured above' },
]

const EMPTY_ITEM = { category: 'OTHER', description: '', amount: '', isPerUnit: false, isOptional: false, included: true, notes: '' }

// ── Helpers ────────────────────────────────────────────────────
const fmt = (n: number, dp = 2) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n)

function calcTotals(items: any[], units: number, contingencyPct: number) {
  const included = items.filter(i => i.included)
  const subtotal  = included.reduce((s, i) => s + (parseFloat(i.amount || '0') * (i.isPerUnit ? units : 1)), 0)
  const contingency = subtotal * (contingencyPct / 100)
  const grandTotal  = subtotal + contingency
  const perUnit     = units > 0 ? grandTotal / units : grandTotal
  return { subtotal, contingency, grandTotal, perUnit }
}

// ── Sub-components — all at module level ───────────────────────
function Toast({ msg, type, onClose }: any) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 9999, padding: '12px 20px', borderRadius: '10px', fontWeight: '500', fontSize: '13px', boxShadow: '0 8px 25px rgba(0,0,0,0.15)', background: type === 'success' ? '#166534' : '#991B1B', color: 'white', display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span>{type === 'success' ? '✅' : '❌'}</span>
      <span>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '18px' }}>×</button>
    </div>
  )
}

function CatBadge({ cat }: { cat: string }) {
  const c = CAT(cat)
  return <span style={{ background: c.bg, color: c.color, fontSize: '10px', fontWeight: '600', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap' }}>{c.label}</span>
}

function SummaryCard({ label, value, sub, color, big = false }: any) {
  return (
    <div style={{ background: 'white', borderRadius: '10px', padding: '14px 16px', border: '1px solid #E2E8F0', textAlign: 'right' }}>
      <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px', textAlign: 'left' }}>{label}</div>
      <div style={{ fontSize: big ? '26px' : '20px', fontWeight: '700', color }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

// Inline editable cell — stable, no focus loss
function EditCell({ value, onChange, type = 'text', placeholder = '', align = 'left', prefix = '' }: {
  value: string; onChange: (v: string) => void
  type?: string; placeholder?: string; align?: string; prefix?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
      {prefix && <span style={{ fontSize: '12px', color: '#94A3B8' }}>{prefix}</span>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', border: 'none', background: 'transparent',
          fontSize: '13px', color: '#1E293B', outline: 'none',
          textAlign: align as any, padding: '2px 4px',
          borderRadius: '4px',
        }}
        onFocus={e => e.target.style.background = '#F0FDF4'}
        onBlur={e => e.target.style.background  = 'transparent'}
      />
    </div>
  )
}

// ── Main CostingSheet component ────────────────────────────────
export default function CostingSheet({ assetId, assetName, currency = 'USD', onClose, onSaved }: {
  assetId: string; assetName: string; currency?: string
  onClose: () => void; onSaved: (msg: string) => void
}) {
  const [items, setItems]         = useState<any[]>(DEFAULT_ITEMS.map((item, i) => ({ ...item, id: `new-${i}` })))
  const [units, setUnits]         = useState(1)
  const [members, setMembers]     = useState(1)
  const [contingency, setContingency] = useState(5)
  const [notes, setNotes]         = useState('')
  const [sheetId, setSheetId]     = useState<string | null>(null)
  const [status, setStatus]       = useState('DRAFT')
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'sheet'|'summary'|'compare'>('sheet')
  const [showAddRow, setShowAddRow] = useState(false)
  const [newItem, setNewItem]     = useState({ ...EMPTY_ITEM })

  function showToast(msg: string, type: 'success'|'error' = 'success') { setToast({ msg, type }) }

  // Fetch existing sheet
  useEffect(() => {
    fetch(`/api/assets/costing?assetId=${assetId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          const s = d.data
          setSheetId(s.id)
          setStatus(s.status)
          setUnits(s.units)
          setMembers(s.membersSharing)
          setContingency(s.contingencyPct)
          setNotes(s.notes || '')
          setItems(s.items.map((item: any) => ({ ...item, amount: String(item.amount) })))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [assetId])

  // Live totals
  const totals = calcTotals(items, units, contingency)
  const perMember = members > 0 ? totals.grandTotal / members : totals.grandTotal

  // Item operations — stable handlers using index
  const updateItem = useCallback((idx: number, key: string, value: any) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [key]: value } : item))
  }, [])

  const toggleIncluded = useCallback((idx: number) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, included: !item.included } : item))
  }, [])

  const removeItem = useCallback((idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }, [])

  function addItem() {
    if (!newItem.description.trim()) return showToast('Description is required', 'error')
    setItems(prev => [...prev, { ...newItem, id: `new-${Date.now()}`, amount: newItem.amount || '0' }])
    setNewItem({ ...EMPTY_ITEM })
    setShowAddRow(false)
  }

  function moveItem(idx: number, dir: 'up'|'down') {
    setItems(prev => {
      const arr = [...prev]
      const target = dir === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= arr.length) return arr
      ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
      return arr
    })
  }

  async function handleSave(approve = false) {
    setSaving(true)
    try {
      const res = await fetch('/api/assets/costing', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId, units, membersSharing: members,
          contingencyPct: contingency, notes,
          currency,
          items: items.map((item, i) => ({
            category:    item.category,
            description: item.description,
            amount:      parseFloat(item.amount || '0'),
            currency,
            isPerUnit:   item.isPerUnit,
            isOptional:  item.isOptional,
            included:    item.included,
            notes:       item.notes || '',
            sortOrder:   i,
          })),
        }),
      })
      const data = await res.json()
      if (!data.success) return showToast(data.error || 'Save failed', 'error')
      setSheetId(data.data.id)
      if (approve) {
        await fetch('/api/assets/costing', {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheetId: data.data.id }),
        })
        setStatus('APPROVED')
        showToast('Costing sheet approved and locked ✓')
      } else {
        showToast(data.message || 'Saved successfully')
      }
      onSaved(data.message)
    } catch { showToast('Network error', 'error') }
    finally { setSaving(false) }
  }

  // Group items by category for summary
  const byCategory = CATEGORIES.map(cat => {
    const catItems = items.filter(i => i.category === cat.value && i.included)
    const total = catItems.reduce((s, i) => s + (parseFloat(i.amount || '0') * (i.isPerUnit ? units : 1)), 0)
    return { ...cat, items: catItems, total }
  }).filter(c => c.items.length > 0)

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '60px', textAlign: 'center' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
        <p style={{ color: '#64748B' }}>Loading costing sheet...</p>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={onClose} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', color: '#475569' }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: NAVY, margin: 0 }}>📊 Asset Costing Sheet</h2>
            <span style={{
              background: status === 'APPROVED' ? '#DCFCE7' : '#FEF9C3',
              color:       status === 'APPROVED' ? '#166534' : '#854D0E',
              fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px',
            }}>{status === 'APPROVED' ? '✓ Approved & Locked' : '✏️ Draft'}</span>
          </div>
          <p style={{ fontSize: '12px', color: '#64748B', margin: '2px 0 0' }}>{assetName} · {currency}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {status !== 'APPROVED' && (
            <>
              <button onClick={() => handleSave(false)} disabled={saving}
                style={{ padding: '8px 16px', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '12px', cursor: saving ? 'not-allowed' : 'pointer', color: '#475569', fontWeight: '500' }}>
                {saving ? '⏳ Saving...' : '💾 Save Draft'}
              </button>
              <button onClick={() => handleSave(true)} disabled={saving}
                style={{ padding: '8px 16px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: saving ? 'not-allowed' : 'pointer' }}>
                ✓ Approve & Lock
              </button>
            </>
          )}
          <button style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: '#475569' }}>
            📥 Export PDF
          </button>
        </div>
      </div>

      {/* Config strip */}
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', alignItems: 'end' }}>
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748B', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Number of Units</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => setUnits(u => Math.max(1, u - 1))} style={{ width: '28px', height: '28px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#F8FAFC', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
            <input type="number" min="1" value={units} onChange={e => setUnits(Math.max(1, parseInt(e.target.value) || 1))} disabled={status === 'APPROVED'}
              style={{ width: '60px', padding: '6px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', fontWeight: '600', textAlign: 'center', outline: 'none' }} />
            <button onClick={() => setUnits(u => u + 1)} style={{ width: '28px', height: '28px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#F8FAFC', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>Units being purchased</div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748B', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Members Sharing Cost</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => setMembers(m => Math.max(1, m - 1))} style={{ width: '28px', height: '28px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#F8FAFC', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
            <input type="number" min="1" value={members} onChange={e => setMembers(Math.max(1, parseInt(e.target.value) || 1))} disabled={status === 'APPROVED'}
              style={{ width: '60px', padding: '6px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', fontWeight: '600', textAlign: 'center', outline: 'none' }} />
            <button onClick={() => setMembers(m => m + 1)} style={{ width: '28px', height: '28px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#F8FAFC', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>Who splits the total</div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748B', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Contingency %</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="number" min="0" max="50" step="0.5" value={contingency} onChange={e => setContingency(parseFloat(e.target.value) || 0)} disabled={status === 'APPROVED'}
              style={{ width: '70px', padding: '6px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', fontWeight: '600', textAlign: 'center', outline: 'none' }} />
            <span style={{ fontSize: '14px', color: '#64748B' }}>%</span>
            <span style={{ fontSize: '12px', color: '#94A3B8' }}>= {currency === 'USD' ? '$' : currency}{fmt(totals.contingency)}</span>
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>Buffer for unexpected costs</div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748B', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any overall notes..." disabled={status === 'APPROVED'}
            style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' as any }} />
        </div>
      </div>

      {/* Live totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
        <SummaryCard label="Subtotal (before contingency)" value={`$${fmt(totals.subtotal)}`} color={NAVY} />
        <SummaryCard label={`Contingency (${contingency}%)`} value={`$${fmt(totals.contingency)}`} color="#B45309" />
        <SummaryCard label="Grand Total (landed cost)" value={`$${fmt(totals.grandTotal)}`} color={TEAL} big />
        <SummaryCard label={`Cost per Unit (÷${units})`} value={`$${fmt(totals.perUnit)}`} color={BLUE} />
        <SummaryCard label={`Cost per Member (÷${members})`} value={`$${fmt(perMember)}`} color="#7C3AED" big sub="Each member contributes this" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid #E2E8F0' }}>
        {[
          { id: 'sheet',   label: '📋 Line Items' },
          { id: 'summary', label: '📊 Category Summary' },
          { id: 'compare', label: '⚖️ Scenario Compare' },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)} style={{
            padding: '10px 20px', background: 'none', border: 'none',
            borderBottom: activeTab === t.id ? `2px solid ${TEAL}` : '2px solid transparent',
            color: activeTab === t.id ? TEAL : '#64748B',
            fontWeight: activeTab === t.id ? '600' : '400',
            fontSize: '13px', cursor: 'pointer', marginBottom: '-1px',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── LINE ITEMS TAB ──────────────────────────────────── */}
      {activeTab === 'sheet' && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '28px 140px 1fr 80px 70px 70px 80px 90px 52px', gap: '0', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', padding: '8px 12px', alignItems: 'center' }}>
            {['', 'Category', 'Description', 'Amount', 'Per Unit?', 'Optional?', '# Applied', 'Line Total', ''].map((h, i) => (
              <div key={i} style={{ fontSize: '10px', fontWeight: '600', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: i >= 5 ? 'right' : 'left' }}>{h}</div>
            ))}
          </div>

          {/* Line items */}
          {items.map((item, idx) => {
            const lineTotal = parseFloat(item.amount || '0') * (item.isPerUnit ? units : 1)
            const applied   = item.isPerUnit ? units : 1
            return (
              <div key={item.id || idx} style={{
                display: 'grid', gridTemplateColumns: '28px 140px 1fr 80px 70px 70px 80px 90px 52px',
                gap: '0', padding: '7px 12px', alignItems: 'center',
                borderBottom: '1px solid #F8FAFC',
                background: !item.included ? '#FAFAFA' : idx % 2 === 0 ? 'white' : '#FDFEFF',
                opacity: item.included ? 1 : 0.5,
              }}>
                {/* Include toggle */}
                <div>
                  <input type="checkbox" checked={item.included} onChange={() => toggleIncluded(idx)} disabled={status === 'APPROVED'}
                    style={{ cursor: 'pointer', width: '14px', height: '14px' }} />
                </div>

                {/* Category */}
                <div>
                  {status === 'APPROVED' ? (
                    <CatBadge cat={item.category} />
                  ) : (
                    <select value={item.category} onChange={e => updateItem(idx, 'category', e.target.value)}
                      style={{ width: '100%', padding: '3px 6px', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '11px', background: 'white', outline: 'none' }}>
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  )}
                </div>

                {/* Description */}
                <div style={{ paddingRight: '8px' }}>
                  {status === 'APPROVED' ? (
                    <span style={{ fontSize: '13px', color: '#1E293B' }}>{item.description}</span>
                  ) : (
                    <EditCell value={item.description} onChange={v => updateItem(idx, 'description', v)} placeholder="Enter description..." />
                  )}
                  {item.notes && <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '1px' }}>{item.notes}</div>}
                </div>

                {/* Amount */}
                <div style={{ textAlign: 'right' }}>
                  {status === 'APPROVED' ? (
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#1E293B' }}>${fmt(parseFloat(item.amount || '0'))}</span>
                  ) : (
                    <EditCell value={item.amount} onChange={v => updateItem(idx, 'amount', v)} type="number" placeholder="0.00" align="right" prefix="$" />
                  )}
                </div>

                {/* Per unit toggle */}
                <div style={{ textAlign: 'center' }}>
                  {status === 'APPROVED' ? (
                    <span style={{ fontSize: '11px', color: item.isPerUnit ? TEAL : '#94A3B8' }}>{item.isPerUnit ? '× unit' : '—'}</span>
                  ) : (
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer', fontSize: '11px', color: item.isPerUnit ? TEAL : '#94A3B8' }}>
                      <input type="checkbox" checked={item.isPerUnit} onChange={e => updateItem(idx, 'isPerUnit', e.target.checked)} style={{ cursor: 'pointer' }} />
                      {item.isPerUnit ? '× unit' : 'fixed'}
                    </label>
                  )}
                </div>

                {/* Optional */}
                <div style={{ textAlign: 'center', fontSize: '11px', color: item.isOptional ? '#94A3B8' : '#1E293B' }}>
                  {status === 'APPROVED' ? (
                    item.isOptional ? 'Optional' : '—'
                  ) : (
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={item.isOptional} onChange={e => updateItem(idx, 'isOptional', e.target.checked)} style={{ cursor: 'pointer' }} />
                      <span style={{ fontSize: '11px' }}>Opt.</span>
                    </label>
                  )}
                </div>

                {/* Applied count */}
                <div style={{ textAlign: 'right', fontSize: '12px', color: '#64748B' }}>
                  {item.isPerUnit ? `${units} unit${units !== 1 ? 's' : ''}` : '1×'}
                </div>

                {/* Line total */}
                <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: '700', color: item.included ? NAVY : '#CBD5E1' }}>
                  ${fmt(lineTotal)}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '2px', justifyContent: 'flex-end' }}>
                  {status !== 'APPROVED' && (
                    <>
                      <button onClick={() => moveItem(idx, 'up')} disabled={idx === 0} title="Move up"
                        style={{ width: '22px', height: '22px', border: 'none', background: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#CBD5E1' : '#64748B', fontSize: '12px', borderRadius: '4px', padding: 0 }}>↑</button>
                      <button onClick={() => moveItem(idx, 'down')} disabled={idx === items.length - 1} title="Move down"
                        style={{ width: '22px', height: '22px', border: 'none', background: 'none', cursor: idx === items.length - 1 ? 'default' : 'pointer', color: idx === items.length - 1 ? '#CBD5E1' : '#64748B', fontSize: '12px', borderRadius: '4px', padding: 0 }}>↓</button>
                      <button onClick={() => removeItem(idx)} title="Remove"
                        style={{ width: '22px', height: '22px', border: 'none', background: 'none', cursor: 'pointer', color: '#FCA5A5', fontSize: '14px', borderRadius: '4px', padding: 0 }}>×</button>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {/* Add row */}
          {status !== 'APPROVED' && (
            <>
              {showAddRow ? (
                <div style={{ display: 'grid', gridTemplateColumns: '28px 140px 1fr 80px 70px 70px 80px 90px 52px', gap: '0', padding: '8px 12px', alignItems: 'center', background: '#F0FDF4', borderTop: '1px solid #BBF7D0' }}>
                  <div />
                  <select value={newItem.category} onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))}
                    style={{ padding: '4px 6px', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '11px', background: 'white', outline: 'none' }}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <div style={{ paddingRight: '8px' }}>
                    <input type="text" value={newItem.description} onChange={e => setNewItem(p => ({ ...p, description: e.target.value }))}
                      placeholder="Description *" autoFocus
                      style={{ width: '100%', padding: '4px 8px', border: '1.5px solid #BBF7D0', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any }} />
                  </div>
                  <div>
                    <input type="number" value={newItem.amount} onChange={e => setNewItem(p => ({ ...p, amount: e.target.value }))}
                      placeholder="0.00"
                      style={{ width: '100%', padding: '4px 6px', border: '1.5px solid #BBF7D0', borderRadius: '6px', fontSize: '13px', outline: 'none', textAlign: 'right' }} />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={newItem.isPerUnit} onChange={e => setNewItem(p => ({ ...p, isPerUnit: e.target.checked }))} />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={newItem.isOptional} onChange={e => setNewItem(p => ({ ...p, isOptional: e.target.checked }))} />
                  </div>
                  <div />
                  <div />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={addItem} style={{ padding: '4px 8px', background: TEAL, color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>Add</button>
                    <button onClick={() => { setShowAddRow(false); setNewItem({ ...EMPTY_ITEM }) }} style={{ padding: '4px 6px', background: '#F1F5F9', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#475569' }}>✕</button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '12px 16px', borderTop: '1px solid #F1F5F9' }}>
                  <button onClick={() => setShowAddRow(true)}
                    style={{ background: 'none', border: '1.5px dashed #CBD5E1', borderRadius: '8px', padding: '8px 16px', fontSize: '12px', color: '#64748B', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
                    + Add line item
                  </button>
                </div>
              )}
            </>
          )}

          {/* Totals footer */}
          <div style={{ padding: '12px 16px', borderTop: '2px solid #E2E8F0', background: '#F8FAFC' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' }}>
              <div />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end', minWidth: '280px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '13px', color: '#64748B' }}>
                  <span>Subtotal ({items.filter(i => i.included).length} items included)</span>
                  <span style={{ fontWeight: '600', color: NAVY }}>${fmt(totals.subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '13px', color: '#B45309' }}>
                  <span>Contingency ({contingency}%)</span>
                  <span style={{ fontWeight: '600' }}>${fmt(totals.contingency)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '15px', fontWeight: '700', color: TEAL, borderTop: '1px solid #E2E8F0', paddingTop: '6px', marginTop: '2px' }}>
                  <span>Grand Total (Landed Cost)</span>
                  <span>${fmt(totals.grandTotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '13px', color: '#7C3AED', background: '#F3E8FF', padding: '6px 8px', borderRadius: '6px', marginTop: '4px' }}>
                  <span>💜 Cost per member (÷ {members})</span>
                  <span style={{ fontWeight: '700' }}>${fmt(perMember)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CATEGORY SUMMARY TAB ───────────────────────────── */}
      {activeTab === 'summary' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {byCategory.map(cat => (
            <div key={cat.value} style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
              <div style={{ background: cat.bg, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: cat.color }}>{cat.label}</span>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '16px', fontWeight: '700', color: cat.color }}>${fmt(cat.total)}</span>
                  <span style={{ fontSize: '11px', color: cat.color, opacity: 0.7, marginLeft: '8px' }}>
                    {totals.grandTotal > 0 ? Math.round(cat.total / totals.grandTotal * 100) : 0}% of total
                  </span>
                </div>
              </div>
              {cat.items.map((item: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #F8FAFC', fontSize: '13px' }}>
                  <div>
                    <span style={{ color: '#374151' }}>{item.description}</span>
                    {item.isOptional && <span style={{ fontSize: '10px', color: '#94A3B8', marginLeft: '6px' }}>optional</span>}
                    {item.notes && <div style={{ fontSize: '11px', color: '#94A3B8' }}>{item.notes}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '600', color: NAVY }}>${fmt(parseFloat(item.amount || '0') * (item.isPerUnit ? units : 1))}</div>
                    {item.isPerUnit && units > 1 && <div style={{ fontSize: '10px', color: '#94A3B8' }}>${fmt(parseFloat(item.amount || '0'))} × {units}</div>}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Visual breakdown bar */}
          {byCategory.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '16px 20px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: NAVY, marginBottom: '12px' }}>Cost Breakdown</div>
              <div style={{ display: 'flex', height: '28px', borderRadius: '8px', overflow: 'hidden', marginBottom: '10px' }}>
                {byCategory.filter(c => c.total > 0).map(cat => (
                  <div key={cat.value} title={`${cat.label}: $${fmt(cat.total)}`}
                    style={{ flex: cat.total, background: cat.bg, borderRight: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '24px' }}>
                    <span style={{ fontSize: '10px', fontWeight: '600', color: cat.color, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                      {totals.grandTotal > 0 && cat.total / totals.grandTotal > 0.08 ? `${Math.round(cat.total / totals.grandTotal * 100)}%` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {byCategory.filter(c => c.total > 0).map(cat => (
                  <div key={cat.value} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: cat.bg, border: `1px solid ${cat.color}` }} />
                    <span style={{ fontSize: '11px', color: '#64748B' }}>{cat.label.split(' ').slice(1).join(' ')}: <strong style={{ color: cat.color }}>${fmt(cat.total)}</strong></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SCENARIO COMPARE TAB ───────────────────────────── */}
      {activeTab === 'compare' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: '#F0FDF4', borderRadius: '10px', padding: '14px 18px', border: '1px solid #BBF7D0', fontSize: '13px', color: '#166534' }}>
            💡 This tab shows how the total and per-member cost changes with different unit counts or member splits. Useful for group decisions.
          </div>

          {/* Sensitivity table */}
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #E2E8F0' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: 0 }}>Units vs Cost per Member</h3>
              <p style={{ fontSize: '12px', color: '#64748B', margin: '4px 0 0' }}>Buying more units spreads per-unit fixed costs, reducing total cost</p>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Units', 'Total Landed Cost', `Per Unit`, ...Array.from({ length: 4 }, (_, i) => `${members + (i - 1) * 5 < 1 ? members : members + (i - 1) * 5} members`)].map((h, i) => (
                    <th key={i} style={{ padding: '10px 14px', textAlign: i === 0 ? 'left' : 'right', fontSize: '11px', fontWeight: '600', color: '#64748B', borderBottom: '1px solid #E2E8F0', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 5, 10, 20].filter(u => u <= units * 5).map((u, ri) => {
                  const t = calcTotals(items, u, contingency)
                  const memberVariants = [
                    Math.max(1, members - 5),
                    members,
                    members + 5,
                    members + 10,
                  ]
                  return (
                    <tr key={u} style={{ borderBottom: '1px solid #F8FAFC', background: u === units ? '#F0FDF4' : ri % 2 === 0 ? 'white' : '#FAFAFA' }}>
                      <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: u === units ? '700' : '400', color: u === units ? TEAL : NAVY }}>
                        {u} unit{u !== 1 ? 's' : ''} {u === units ? '← current' : ''}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: NAVY, textAlign: 'right' }}>${fmt(t.grandTotal)}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: '#475569', textAlign: 'right' }}>${fmt(t.grandTotal / u)}</td>
                      {memberVariants.map((m, mi) => (
                        <td key={mi} style={{ padding: '10px 14px', fontSize: '12px', color: m === members && u === units ? '#7C3AED' : '#475569', fontWeight: m === members && u === units ? '700' : '400', textAlign: 'right' }}>
                          ${fmt(t.grandTotal / m)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Key insight */}
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '16px 20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 12px' }}>📌 Key Decision Points</h3>
            {[
              { label: 'Current scenario',      value: `${units} unit${units!==1?'s':''} ÷ ${members} members = $${fmt(perMember)} each`, color: TEAL },
              { label: 'Total landed cost',      value: `$${fmt(totals.grandTotal)} (incl. ${contingency}% contingency)`, color: NAVY },
              { label: 'Largest cost category',  value: byCategory.sort((a,b) => b.total - a.total)[0] ? `${byCategory.sort((a,b) => b.total - a.total)[0].label} ($${fmt(byCategory.sort((a,b) => b.total - a.total)[0].total)})` : 'No items entered yet', color: BLUE },
              { label: 'Non-purchase costs',     value: `$${fmt(items.filter(i => i.included && i.category !== 'PURCHASE').reduce((s, i) => s + parseFloat(i.amount||'0') * (i.isPerUnit ? units : 1), 0))} (${totals.grandTotal > 0 ? Math.round((1 - items.filter(i => i.included && i.category === 'PURCHASE').reduce((s, i) => s + parseFloat(i.amount||'0') * (i.isPerUnit ? units : 1), 0) / totals.grandTotal) * 100) : 0}% on top of purchase price)`, color: '#B45309' },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F8FAFC', fontSize: '13px' }}>
                <span style={{ color: '#64748B' }}>{row.label}</span>
                <span style={{ fontWeight: '600', color: row.color }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
