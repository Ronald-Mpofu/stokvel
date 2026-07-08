// ============================================================
// COUNTRY → CURRENCY MAPPING
// File: src/lib/referenceData/countryCurrencyMap.ts
//
// Maps countries to their currency, CONSTRAINED to the Prisma
// CurrencyCode enum. Countries whose real currency is not in
// the enum (NGN, GHS, INR, etc.) fall back to USD.
//
// Lookup is O(1) via a pre-built Record — no array scanning
// on every dropdown change.
// ============================================================

// Must stay in sync with prisma/schema.prisma → enum CurrencyCode
export type CurrencyCode =
  | 'USD' | 'ZAR' | 'ZWG' | 'KES' | 'TZS' | 'UGX'
  | 'ZMW' | 'BWP' | 'MWK' | 'EUR' | 'GBP';

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

// ------------------------------------------------------------
// Only countries whose currency EXISTS in the enum are listed.
// Everything else resolves to USD via the helper fallback.
// Keyed by both ISO2 and ISO3 in the generated lookup below.
// ------------------------------------------------------------
interface CountryCurrencyEntry {
  iso2: string;
  iso3: string;
  currency: CurrencyCode;
}

const MAPPED_COUNTRIES: CountryCurrencyEntry[] = [
  // ---- Southern Africa ----
  { iso2: 'ZA', iso3: 'ZAF', currency: 'ZAR' }, // South Africa
  { iso2: 'LS', iso3: 'LSO', currency: 'ZAR' }, // Lesotho — LSL pegged 1:1 to ZAR; ZAR legal tender
  { iso2: 'NA', iso3: 'NAM', currency: 'ZAR' }, // Namibia — NAD pegged 1:1 to ZAR; ZAR legal tender
  { iso2: 'SZ', iso3: 'SWZ', currency: 'ZAR' }, // Eswatini — SZL pegged 1:1 to ZAR
  { iso2: 'BW', iso3: 'BWA', currency: 'BWP' }, // Botswana
  { iso2: 'ZW', iso3: 'ZWE', currency: 'ZWG' }, // Zimbabwe
  { iso2: 'ZM', iso3: 'ZMB', currency: 'ZMW' }, // Zambia
  { iso2: 'MW', iso3: 'MWI', currency: 'MWK' }, // Malawi

  // ---- East Africa ----
  { iso2: 'KE', iso3: 'KEN', currency: 'KES' }, // Kenya
  { iso2: 'TZ', iso3: 'TZA', currency: 'TZS' }, // Tanzania
  { iso2: 'UG', iso3: 'UGA', currency: 'UGX' }, // Uganda

  // ---- USD as official currency ----
  { iso2: 'US', iso3: 'USA', currency: 'USD' }, // United States
  { iso2: 'EC', iso3: 'ECU', currency: 'USD' }, // Ecuador
  { iso2: 'SV', iso3: 'SLV', currency: 'USD' }, // El Salvador
  { iso2: 'PA', iso3: 'PAN', currency: 'USD' }, // Panama
  { iso2: 'TL', iso3: 'TLS', currency: 'USD' }, // Timor-Leste
  { iso2: 'FM', iso3: 'FSM', currency: 'USD' }, // Micronesia
  { iso2: 'MH', iso3: 'MHL', currency: 'USD' }, // Marshall Islands
  { iso2: 'PW', iso3: 'PLW', currency: 'USD' }, // Palau
  { iso2: 'PR', iso3: 'PRI', currency: 'USD' }, // Puerto Rico
  { iso2: 'VG', iso3: 'VGB', currency: 'USD' }, // British Virgin Islands
  { iso2: 'VI', iso3: 'VIR', currency: 'USD' }, // US Virgin Islands
  { iso2: 'TC', iso3: 'TCA', currency: 'USD' }, // Turks & Caicos
  { iso2: 'GU', iso3: 'GUM', currency: 'USD' }, // Guam
  { iso2: 'AS', iso3: 'ASM', currency: 'USD' }, // American Samoa
  { iso2: 'MP', iso3: 'MNP', currency: 'USD' }, // Northern Mariana Islands
  { iso2: 'BQ', iso3: 'BES', currency: 'USD' }, // Bonaire, Sint Eustatius & Saba

  // ---- Eurozone ----
  { iso2: 'AT', iso3: 'AUT', currency: 'EUR' }, // Austria
  { iso2: 'BE', iso3: 'BEL', currency: 'EUR' }, // Belgium
  { iso2: 'HR', iso3: 'HRV', currency: 'EUR' }, // Croatia
  { iso2: 'CY', iso3: 'CYP', currency: 'EUR' }, // Cyprus
  { iso2: 'EE', iso3: 'EST', currency: 'EUR' }, // Estonia
  { iso2: 'FI', iso3: 'FIN', currency: 'EUR' }, // Finland
  { iso2: 'FR', iso3: 'FRA', currency: 'EUR' }, // France
  { iso2: 'DE', iso3: 'DEU', currency: 'EUR' }, // Germany
  { iso2: 'GR', iso3: 'GRC', currency: 'EUR' }, // Greece
  { iso2: 'IE', iso3: 'IRL', currency: 'EUR' }, // Ireland
  { iso2: 'IT', iso3: 'ITA', currency: 'EUR' }, // Italy
  { iso2: 'LV', iso3: 'LVA', currency: 'EUR' }, // Latvia
  { iso2: 'LT', iso3: 'LTU', currency: 'EUR' }, // Lithuania
  { iso2: 'LU', iso3: 'LUX', currency: 'EUR' }, // Luxembourg
  { iso2: 'MT', iso3: 'MLT', currency: 'EUR' }, // Malta
  { iso2: 'NL', iso3: 'NLD', currency: 'EUR' }, // Netherlands
  { iso2: 'PT', iso3: 'PRT', currency: 'EUR' }, // Portugal
  { iso2: 'SK', iso3: 'SVK', currency: 'EUR' }, // Slovakia
  { iso2: 'SI', iso3: 'SVN', currency: 'EUR' }, // Slovenia
  { iso2: 'ES', iso3: 'ESP', currency: 'EUR' }, // Spain
  // Non-EU users of the euro
  { iso2: 'AD', iso3: 'AND', currency: 'EUR' }, // Andorra
  { iso2: 'MC', iso3: 'MCO', currency: 'EUR' }, // Monaco
  { iso2: 'SM', iso3: 'SMR', currency: 'EUR' }, // San Marino
  { iso2: 'VA', iso3: 'VAT', currency: 'EUR' }, // Vatican City
  { iso2: 'ME', iso3: 'MNE', currency: 'EUR' }, // Montenegro
  { iso2: 'XK', iso3: 'XKX', currency: 'EUR' }, // Kosovo

  // ---- Pound sterling ----
  { iso2: 'GB', iso3: 'GBR', currency: 'GBP' }, // United Kingdom
  { iso2: 'IM', iso3: 'IMN', currency: 'GBP' }, // Isle of Man
  { iso2: 'JE', iso3: 'JEY', currency: 'GBP' }, // Jersey
  { iso2: 'GG', iso3: 'GGY', currency: 'GBP' }, // Guernsey
];

// ------------------------------------------------------------
// Pre-built O(1) lookup — keyed by BOTH iso2 and iso3,
// built once at module load. No per-call array scans.
// ------------------------------------------------------------
const CURRENCY_LOOKUP: Record<string, CurrencyCode> = {};
for (const entry of MAPPED_COUNTRIES) {
  CURRENCY_LOOKUP[entry.iso2] = entry.currency;
  CURRENCY_LOOKUP[entry.iso3] = entry.currency;
}

/**
 * Resolve a country's currency, constrained to the CurrencyCode enum.
 * Accepts ISO2 ("ZA") or ISO3 ("ZAF"), case-insensitive.
 * Countries whose real currency is not in the enum (e.g. Nigeria/NGN,
 * Ghana/GHS) fall back to USD by design.
 */
export function getCurrencyForCountry(isoCode: string | null | undefined): CurrencyCode {
  if (!isoCode) return DEFAULT_CURRENCY;
  return CURRENCY_LOOKUP[isoCode.trim().toUpperCase()] ?? DEFAULT_CURRENCY;
}

/** True if the country's own currency is natively supported by the enum. */
export function isNativeCurrencyCountry(isoCode: string | null | undefined): boolean {
  if (!isoCode) return false;
  return CURRENCY_LOOKUP[isoCode.trim().toUpperCase()] !== undefined;
}
