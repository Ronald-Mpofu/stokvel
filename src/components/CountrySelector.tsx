'use client'
// src/components/CountrySelector.tsx — v2.1
// Countries + currencies sourced from /api/reference — each country record
// carries a currencies[] array; the isDefault entry is that country's currency.
// Provinces/cities remain static (not stored in DB)
// Stokvel brands sourced from RefStokvelBrand DB table
import { useState, useEffect, useRef } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'

// ── Currency comes from the fetched country record ────────────
// Shape from /api/reference: currencies: [{ id, name, symbol, isDefault }]
function defaultCurrencyOf(country: any): { code: string; symbol: string } {
  const def = country?.currencies?.find((c: any) => c.isDefault) || country?.currencies?.[0]
  return def ? { code: def.id, symbol: def.symbol } : { code: 'USD', symbol: '$' }
}

// ── Static province/city data (not in DB) ────────────────────
const PROVINCES: Record<string, { code: string; name: string }[]> = {
  ZA: [
    { code:'GP', name:'Gauteng' }, { code:'WC', name:'Western Cape' },
    { code:'KZN', name:'KwaZulu-Natal' }, { code:'EC', name:'Eastern Cape' },
    { code:'LP', name:'Limpopo' }, { code:'MP', name:'Mpumalanga' },
    { code:'NW', name:'North West' }, { code:'FS', name:'Free State' },
    { code:'NC', name:'Northern Cape' },
  ],
  ZW: [
    { code:'HRE', name:'Harare' }, { code:'BYO', name:'Bulawayo' },
    { code:'MAN', name:'Manicaland' }, { code:'MSV', name:'Mashonaland Central' },
    { code:'MSE', name:'Mashonaland East' }, { code:'MSW', name:'Mashonaland West' },
    { code:'MAT', name:'Matabeleland North' }, { code:'MAS', name:'Matabeleland South' },
    { code:'MID', name:'Midlands' }, { code:'MAS2', name:'Masvingo' },
  ],
  ZM: [
    { code:'LSK', name:'Lusaka' }, { code:'CB', name:'Copperbelt' },
    { code:'CTR', name:'Central' }, { code:'EST', name:'Eastern' },
    { code:'LUA', name:'Luapula' }, { code:'MUC', name:'Muchinga' },
    { code:'NOR', name:'Northern' }, { code:'NWE', name:'North-Western' },
    { code:'SOU', name:'Southern' }, { code:'WES', name:'Western' },
  ],
  MW: [
    { code:'BT', name:'Blantyre' }, { code:'LLW', name:'Lilongwe' },
    { code:'MZU', name:'Mzuzu' }, { code:'ZBA', name:'Zomba' },
  ],
  BW: [
    { code:'GAB', name:'Gaborone' }, { code:'FRA', name:'Francistown' },
    { code:'CEN', name:'Central' }, { code:'GHZ', name:'Ghanzi' },
    { code:'KGA', name:'Kgalagadi' }, { code:'KGT', name:'Kgateng' },
    { code:'NED', name:'North-East' }, { code:'NOR', name:'North-West' },
    { code:'SOU', name:'South-East' }, { code:'SWL', name:'Southern' },
  ],
  KE: [
    { code:'NBI', name:'Nairobi' }, { code:'MSA', name:'Mombasa' },
    { code:'KSM', name:'Kisumu' }, { code:'NYR', name:'Nakuru' },
    { code:'ELD', name:'Eldoret' }, { code:'CEN', name:'Central' },
    { code:'CST', name:'Coast' }, { code:'EST', name:'Eastern' },
    { code:'NEB', name:'North Eastern' }, { code:'NYZ', name:'Nyanza' },
    { code:'RVL', name:'Rift Valley' }, { code:'WES', name:'Western' },
  ],
}

const CITIES: Record<string, Record<string, string[]>> = {
  ZA: {
    GP:  ['Johannesburg','Pretoria','Soweto','Ekurhuleni','Centurion','Randburg','Sandton','Roodepoort'],
    WC:  ['Cape Town','Stellenbosch','George','Paarl','Knysna','Worcester','Bellville'],
    KZN: ['Durban','Pietermaritzburg','Richards Bay','Newcastle','Pinetown','Umhlanga'],
    EC:  ['Port Elizabeth','East London','Mthatha','Grahamstown','King William\'s Town'],
    LP:  ['Polokwane','Tzaneen','Thohoyandou','Bela-Bela','Mokopane'],
    MP:  ['Nelspruit','Witbank','Secunda','Middelburg','Standerton'],
    NW:  ['Mahikeng','Rustenburg','Klerksdorp','Potchefstroom','Brits'],
    FS:  ['Bloemfontein','Welkom','Bethlehem','Sasolburg','Kroonstad'],
    NC:  ['Kimberley','Upington','Springbok','De Aar'],
  },
  ZW: {
    HRE:  ['Harare','Chitungwiza','Epworth','Norton','Ruwa'],
    BYO:  ['Bulawayo','Luveve','Nkulumane','Pumula'],
    MAN:  ['Mutare','Rusape','Chipinge','Birchenough Bridge'],
    MSV:  ['Bindura','Shamva','Mvurwi','Guruve'],
    MSE:  ['Marondera','Ruwa','Mutoko','Wedza'],
    MSW:  ['Chinhoyi','Kadoma','Chegutu','Karoi'],
    MAT:  ['Hwange','Victoria Falls','Lupane','Binga'],
    MAS:  ['Gwanda','Plumtree','Beitbridge','Filabusi'],
    MID:  ['Gweru','Kwekwe','Redcliff','Mvuma','Shurugwi'],
    MAS2: ['Masvingo','Chiredzi','Zvishavane','Triangle'],
  },
  ZM: {
    LSK: ['Lusaka','Kafue','Chongwe','Luangwa'],
    CB:  ['Kitwe','Ndola','Mufulira','Chingola','Luanshya','Kalulushi'],
    CTR: ['Kabwe','Kapiri Mposhi','Mkushi','Serenje'],
    EST: ['Chipata','Petauke','Lundazi','Katete'],
    LUA: ['Mansa','Samfya','Kawambwa','Nchelenge'],
    MUC: ['Chinsali','Mpika','Isoka','Nakonde'],
    NOR: ['Kasama','Mbala','Mporokoso','Luwingu'],
    NWE: ['Solwezi','Mwinilunga','Kasempa','Zambezi'],
    SOU: ['Livingstone','Choma','Monze','Mazabuka','Kalomo'],
    WES: ['Mongu','Kaoma','Senanga','Sesheke'],
  },
}

function getProvinces(countryCode: string) {
  return PROVINCES[countryCode] || []
}

function getCities(countryCode: string, provinceCode: string) {
  return CITIES[countryCode]?.[provinceCode] || []
}

// ── Brand type colours (local — no import needed) ─────────────
const STOKVEL_TYPE_COLORS: Record<string, { icon: string; color: string; bg: string }> = {
  SAVINGS:    { icon: '💰', color: '#1A5EA8', bg: '#DBEAFE' },
  GENERAL:    { icon: '🤝', color: '#0F6E56', bg: '#DCFCE7' },
  GROCERY:    { icon: '🛒', color: '#166534', bg: '#DCFCE7' },
  INVESTMENT: { icon: '📈', color: '#7C3AED', bg: '#F3E8FF' },
}

export interface CountrySelectionResult {
  countryCode:   string
  countryName:   string
  provinceCode:  string
  provinceName:  string
  city:          string
  currency:      string
  suggestedName: string
}

interface Props {
  value: {
    countryCode:  string
    provinceCode: string
    city:         string
    currency:     string
  }
  onChange:        (result: CountrySelectionResult) => void
  onNameSuggested: (name: string) => void
  compact?:        boolean
}

// ── Searchable dropdown ───────────────────────────────────────
function SearchableSelect({ value, onChange, options, placeholder, icon }: {
  value:     string
  onChange:  (v: string) => void
  options:   { value: string; label: string }[]
  placeholder: string
  icon?:     string
}) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const ref               = useRef<HTMLDivElement>(null)
  const selected          = options.find(o => o.value === value)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <div onClick={() => { setOpen(o => !o); setQuery('') }}
        style={{ display:'flex', alignItems:'center', gap:'8px', padding:'9px 12px',
          border:`1.5px solid ${open ? TEAL : '#E2E8F0'}`, borderRadius:'8px',
          cursor:'pointer', background:'white', userSelect:'none' as any }}>
        {icon && <span>{icon}</span>}
        <span style={{ flex:1, fontSize:'13px', color: selected ? NAVY : '#94A3B8' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ fontSize:'12px', color:'#94A3B8', transition:'transform 0.2s',
          display:'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
      </div>

      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0,
          background:'white', border:'1.5px solid #E2E8F0', borderRadius:'10px',
          boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:200, overflow:'hidden',
          maxHeight:'280px', display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'8px', borderBottom:'1px solid #F1F5F9', flexShrink:0 }}>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search..." onClick={e => e.stopPropagation()}
              style={{ width:'100%', padding:'6px 10px', border:'1.5px solid #E2E8F0',
                borderRadius:'6px', fontSize:'12px', outline:'none', boxSizing:'border-box' as any }}/>
          </div>
          <div style={{ overflowY:'auto', flex:1 }}>
            {filtered.length === 0
              ? <div style={{ padding:'12px', textAlign:'center', fontSize:'12px', color:'#94A3B8' }}>No results</div>
              : filtered.map(o => (
                  <div key={o.value} onClick={() => { onChange(o.value); setOpen(false); setQuery('') }}
                    style={{ padding:'9px 12px', fontSize:'13px', cursor:'pointer',
                      background: value === o.value ? '#F0FDF4' : 'white',
                      color: value === o.value ? TEAL : NAVY,
                      fontWeight: value === o.value ? '600' : '400',
                      borderLeft: value === o.value ? `3px solid ${TEAL}` : '3px solid transparent' }}
                    onMouseEnter={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.background = '#F8FAFC' }}
                    onMouseLeave={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.background = 'white' }}>
                    {o.label}
                  </div>
                ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export default function CountrySelector({ value, onChange, onNameSuggested, compact = false }: Props) {
  const [countries, setCountries]   = useState<any[]>([])
  const [brands, setBrands]         = useState<any[]>([])
  const [loadingC, setLoadingC]     = useState(true)

  // Fetch countries once on mount
  useEffect(() => {
    fetch('/api/reference?type=countries')
      .then(r => r.json())
      .then(d => { if (d.success) setCountries(d.data) })
      .catch(() => {})
      .finally(() => setLoadingC(false))
  }, [])

  // Fetch brands when country changes
  useEffect(() => {
    if (!value.countryCode) { setBrands([]); return }
    fetch(`/api/reference?type=stokvel-brands&countryId=${value.countryCode}`)
      .then(r => r.json())
      .then(d => setBrands(d.success ? d.data : []))
      .catch(() => setBrands([]))
  }, [value.countryCode])

  const provinces      = getProvinces(value.countryCode)
  const cities         = getCities(value.countryCode, value.provinceCode)
  const provinceOptions = provinces.map(p => ({ value: p.code, label: p.name }))
  const cityOptions     = cities.map(c => ({ value: c, label: c }))

  const country         = countries.find((c: any) => c.id === value.countryCode)
  const countryOptions  = countries.map((c: any) => ({
    value: c.id,
    label: `${c.flagEmoji} ${c.name}`,
  }))

  function handleCountryChange(code: string) {
    const c        = countries.find((x: any) => x.id === code)
    const currency = defaultCurrencyOf(c)
    onChange({
      countryCode:   code,
      countryName:   c?.name || '',
      provinceCode:  '',
      provinceName:  '',
      city:          '',
      currency:      currency.code,
      suggestedName: '',
    })
  }

  function handleProvinceChange(code: string) {
    const prov = provinces.find(p => p.code === code)
    onChange({
      countryCode:   value.countryCode,
      countryName:   country?.name || '',
      provinceCode:  code,
      provinceName:  prov?.name || '',
      city:          '',
      currency:      value.currency,
      suggestedName: '',
    })
  }

  function handleCityChange(city: string) {
    onChange({
      countryCode:   value.countryCode,
      countryName:   country?.name || '',
      provinceCode:  value.provinceCode,
      provinceName:  provinces.find(p => p.code === value.provinceCode)?.name || '',
      city,
      currency:      value.currency,
      suggestedName: '',
    })
  }

  const labelStyle: React.CSSProperties = {
    display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px'
  }

  if (loadingC) {
    return (
      <div style={{ padding:'14px', background:'#F8FAFC', borderRadius:'8px',
        fontSize:'13px', color:'#94A3B8', border:'1.5px dashed #E2E8F0' }}>
        Loading countries...
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>

      {/* Country + Currency row */}
      <div style={{ display:'grid', gridTemplateColumns: compact ? '1fr' : '1fr auto', gap:'10px', alignItems:'end' }}>
        <div>
          <label style={labelStyle}>Country *</label>
          <SearchableSelect
            value={value.countryCode}
            onChange={handleCountryChange}
            options={countryOptions}
            placeholder="Search and select country..."
            icon="🌍"
          />
        </div>
        {value.countryCode && !compact && (
          <div style={{ paddingBottom:'1px' }}>
            <label style={labelStyle}>Currency</label>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'9px 14px',
              background:'#F0FDF4', border:'1.5px solid #BBF7D0', borderRadius:'8px', minWidth:'100px' }}>
              <span style={{ fontSize:'16px' }}>{country?.flagEmoji}</span>
              <div>
                <div style={{ fontSize:'13px', fontWeight:'700', color:TEAL }}>{value.currency}</div>
                <div style={{ fontSize:'10px', color:'#64748B' }}>{defaultCurrencyOf(country).symbol}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Province */}
      {value.countryCode && provinceOptions.length > 0 && (
        <div>
          <label style={labelStyle}>
            {['US','CA','AU'].includes(value.countryCode) ? 'State / Territory' : 'Province / Region'} *
          </label>
          <SearchableSelect
            value={value.provinceCode}
            onChange={handleProvinceChange}
            options={provinceOptions}
            placeholder={`Select ${['US','CA','AU'].includes(value.countryCode) ? 'state' : 'province'}...`}
          />
        </div>
      )}

      {/* City */}
      {value.countryCode && (
        <div>
          <label style={labelStyle}>City *</label>
          {cityOptions.length > 0 ? (
            <SearchableSelect
              value={value.city}
              onChange={handleCityChange}
              options={cityOptions}
              placeholder="Select city..."
            />
          ) : (
            <input type="text" value={value.city}
              onChange={e => handleCityChange(e.target.value)}
              placeholder="Enter city name..."
              style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0',
                borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }}/>
          )}
        </div>
      )}

      {/* Stokvel brand suggestions */}
      {value.countryCode && brands.length > 0 && (
        <div style={{ background:'#F8FAFC', borderRadius:'12px', padding:'14px', border:'1px solid #E2E8F0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px' }}>
            <span style={{ fontSize:'16px' }}>{country?.flagEmoji}</span>
            <div>
              <div style={{ fontSize:'12px', fontWeight:'600', color:NAVY }}>
                Trending savings group names in {country?.name}
              </div>
              <div style={{ fontSize:'11px', color:'#94A3B8' }}>Click a name to use it for your group</div>
            </div>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'7px', marginBottom:'10px' }}>
            {brands.map((s: any) => {
              const meta = STOKVEL_TYPE_COLORS[s.type] || STOKVEL_TYPE_COLORS.GENERAL
              return (
                <div key={s.name} onClick={() => onNameSuggested(s.name)}
                  title={s.description || s.name}
                  style={{ display:'inline-flex', alignItems:'center', gap:'5px',
                    padding:'5px 10px', background:meta.bg, color:meta.color,
                    borderRadius:'999px', fontSize:'12px', fontWeight:'500',
                    cursor:'pointer', border:`1px solid ${meta.bg}`, transition:'all 0.15s' }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'
                    el.style.transform = 'translateY(-1px)'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.boxShadow = 'none'
                    el.style.transform = 'translateY(0)'
                  }}>
                  <span>{meta.icon}</span>
                  <span>{s.name}</span>
                </div>
              )
            })}
          </div>
          {/* Type legend */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:'8px', paddingTop:'8px', borderTop:'1px solid #F1F5F9' }}>
            {Object.entries(STOKVEL_TYPE_COLORS).map(([type, meta]) => (
              <span key={type} style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'10px', color:'#94A3B8' }}>
                <span style={{ width:'6px', height:'6px', borderRadius:'50%', background:meta.color, display:'inline-block' }}/>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Dial code hint */}
      {value.countryCode && country && (
        <div style={{ fontSize:'11px', color:'#94A3B8', display:'flex', alignItems:'center', gap:'6px' }}>
          <span>📞 International dial code:</span>
          <strong style={{ color:'#64748B' }}>{country.dialCode}</strong>
        </div>
      )}

    </div>
  )
}
