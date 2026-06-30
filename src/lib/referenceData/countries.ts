// src/lib/referenceData/countries.ts
// Global reference data constants for Windfall Community Deals.
// Authoritative source is the DB (RefCountry / RefCurrency / RefPaymentMethod / RefStokvelBrand).
// This file provides fast client-side constants for dropdowns — no API call needed.

export interface RefCountry {
  id:         string;   // ISO 2-letter code
  iso3:       string;
  name:       string;
  dialCode:   string;
  region:     string;
  subRegion:  string;
  flagEmoji:  string;
}

// ── ALL COUNTRIES (195 sovereign states) ──────────────────────
export const COUNTRIES: RefCountry[] = [
  // Africa — Southern
  { id:'ZW', iso3:'ZWE', name:'Zimbabwe',            dialCode:'+263', region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇿🇼' },
  { id:'ZA', iso3:'ZAF', name:'South Africa',        dialCode:'+27',  region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇿🇦' },
  { id:'ZM', iso3:'ZMB', name:'Zambia',              dialCode:'+260', region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇿🇲' },
  { id:'MW', iso3:'MWI', name:'Malawi',              dialCode:'+265', region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇲🇼' },
  { id:'BW', iso3:'BWA', name:'Botswana',            dialCode:'+267', region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇧🇼' },
  { id:'MZ', iso3:'MOZ', name:'Mozambique',          dialCode:'+258', region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇲🇿' },
  { id:'NA', iso3:'NAM', name:'Namibia',             dialCode:'+264', region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇳🇦' },
  { id:'SZ', iso3:'SWZ', name:'Eswatini',            dialCode:'+268', region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇸🇿' },
  { id:'LS', iso3:'LSO', name:'Lesotho',             dialCode:'+266', region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇱🇸' },
  { id:'MG', iso3:'MDG', name:'Madagascar',          dialCode:'+261', region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇲🇬' },
  { id:'MU', iso3:'MUS', name:'Mauritius',           dialCode:'+230', region:'Africa',   subRegion:'Southern Africa', flagEmoji:'🇲🇺' },
  // Africa — East
  { id:'KE', iso3:'KEN', name:'Kenya',               dialCode:'+254', region:'Africa',   subRegion:'East Africa',     flagEmoji:'🇰🇪' },
  { id:'TZ', iso3:'TZA', name:'Tanzania',            dialCode:'+255', region:'Africa',   subRegion:'East Africa',     flagEmoji:'🇹🇿' },
  { id:'UG', iso3:'UGA', name:'Uganda',              dialCode:'+256', region:'Africa',   subRegion:'East Africa',     flagEmoji:'🇺🇬' },
  { id:'ET', iso3:'ETH', name:'Ethiopia',            dialCode:'+251', region:'Africa',   subRegion:'East Africa',     flagEmoji:'🇪🇹' },
  { id:'RW', iso3:'RWA', name:'Rwanda',              dialCode:'+250', region:'Africa',   subRegion:'East Africa',     flagEmoji:'🇷🇼' },
  { id:'BI', iso3:'BDI', name:'Burundi',             dialCode:'+257', region:'Africa',   subRegion:'East Africa',     flagEmoji:'🇧🇮' },
  { id:'SS', iso3:'SSD', name:'South Sudan',         dialCode:'+211', region:'Africa',   subRegion:'East Africa',     flagEmoji:'🇸🇸' },
  { id:'SD', iso3:'SDN', name:'Sudan',               dialCode:'+249', region:'Africa',   subRegion:'East Africa',     flagEmoji:'🇸🇩' },
  // Africa — West
  { id:'GH', iso3:'GHA', name:'Ghana',               dialCode:'+233', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇬🇭' },
  { id:'NG', iso3:'NGA', name:'Nigeria',             dialCode:'+234', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇳🇬' },
  { id:'SN', iso3:'SEN', name:'Senegal',             dialCode:'+221', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇸🇳' },
  { id:'CI', iso3:'CIV', name:"Côte d'Ivoire",       dialCode:'+225', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇨🇮' },
  { id:'ML', iso3:'MLI', name:'Mali',                dialCode:'+223', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇲🇱' },
  { id:'BF', iso3:'BFA', name:'Burkina Faso',        dialCode:'+226', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇧🇫' },
  { id:'GN', iso3:'GIN', name:'Guinea',              dialCode:'+224', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇬🇳' },
  { id:'BJ', iso3:'BEN', name:'Benin',               dialCode:'+229', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇧🇯' },
  { id:'NE', iso3:'NER', name:'Niger',               dialCode:'+227', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇳🇪' },
  { id:'TG', iso3:'TGO', name:'Togo',                dialCode:'+228', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇹🇬' },
  { id:'SL', iso3:'SLE', name:'Sierra Leone',        dialCode:'+232', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇸🇱' },
  { id:'LR', iso3:'LBR', name:'Liberia',             dialCode:'+231', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇱🇷' },
  { id:'GM', iso3:'GMB', name:'Gambia',              dialCode:'+220', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇬🇲' },
  { id:'CV', iso3:'CPV', name:'Cape Verde',          dialCode:'+238', region:'Africa',   subRegion:'West Africa',     flagEmoji:'🇨🇻' },
  // Africa — Central
  { id:'CM', iso3:'CMR', name:'Cameroon',            dialCode:'+237', region:'Africa',   subRegion:'Central Africa',  flagEmoji:'🇨🇲' },
  { id:'AO', iso3:'AGO', name:'Angola',              dialCode:'+244', region:'Africa',   subRegion:'Central Africa',  flagEmoji:'🇦🇴' },
  { id:'CD', iso3:'COD', name:'DR Congo',            dialCode:'+243', region:'Africa',   subRegion:'Central Africa',  flagEmoji:'🇨🇩' },
  { id:'CG', iso3:'COG', name:'Republic of Congo',   dialCode:'+242', region:'Africa',   subRegion:'Central Africa',  flagEmoji:'🇨🇬' },
  { id:'GA', iso3:'GAB', name:'Gabon',               dialCode:'+241', region:'Africa',   subRegion:'Central Africa',  flagEmoji:'🇬🇦' },
  // Africa — North
  { id:'EG', iso3:'EGY', name:'Egypt',               dialCode:'+20',  region:'Africa',   subRegion:'North Africa',    flagEmoji:'🇪🇬' },
  { id:'MA', iso3:'MAR', name:'Morocco',             dialCode:'+212', region:'Africa',   subRegion:'North Africa',    flagEmoji:'🇲🇦' },
  { id:'DZ', iso3:'DZA', name:'Algeria',             dialCode:'+213', region:'Africa',   subRegion:'North Africa',    flagEmoji:'🇩🇿' },
  { id:'TN', iso3:'TUN', name:'Tunisia',             dialCode:'+216', region:'Africa',   subRegion:'North Africa',    flagEmoji:'🇹🇳' },
  { id:'LY', iso3:'LBY', name:'Libya',               dialCode:'+218', region:'Africa',   subRegion:'North Africa',    flagEmoji:'🇱🇾' },
  // Asia — South
  { id:'IN', iso3:'IND', name:'India',               dialCode:'+91',  region:'Asia',     subRegion:'South Asia',      flagEmoji:'🇮🇳' },
  { id:'PK', iso3:'PAK', name:'Pakistan',            dialCode:'+92',  region:'Asia',     subRegion:'South Asia',      flagEmoji:'🇵🇰' },
  { id:'BD', iso3:'BGD', name:'Bangladesh',          dialCode:'+880', region:'Asia',     subRegion:'South Asia',      flagEmoji:'🇧🇩' },
  { id:'LK', iso3:'LKA', name:'Sri Lanka',           dialCode:'+94',  region:'Asia',     subRegion:'South Asia',      flagEmoji:'🇱🇰' },
  { id:'NP', iso3:'NPL', name:'Nepal',               dialCode:'+977', region:'Asia',     subRegion:'South Asia',      flagEmoji:'🇳🇵' },
  // Asia — Southeast
  { id:'PH', iso3:'PHL', name:'Philippines',         dialCode:'+63',  region:'Asia',     subRegion:'Southeast Asia',  flagEmoji:'🇵🇭' },
  { id:'ID', iso3:'IDN', name:'Indonesia',           dialCode:'+62',  region:'Asia',     subRegion:'Southeast Asia',  flagEmoji:'🇮🇩' },
  { id:'MY', iso3:'MYS', name:'Malaysia',            dialCode:'+60',  region:'Asia',     subRegion:'Southeast Asia',  flagEmoji:'🇲🇾' },
  { id:'TH', iso3:'THA', name:'Thailand',            dialCode:'+66',  region:'Asia',     subRegion:'Southeast Asia',  flagEmoji:'🇹🇭' },
  { id:'VN', iso3:'VNM', name:'Vietnam',             dialCode:'+84',  region:'Asia',     subRegion:'Southeast Asia',  flagEmoji:'🇻🇳' },
  { id:'MM', iso3:'MMR', name:'Myanmar',             dialCode:'+95',  region:'Asia',     subRegion:'Southeast Asia',  flagEmoji:'🇲🇲' },
  { id:'SG', iso3:'SGP', name:'Singapore',           dialCode:'+65',  region:'Asia',     subRegion:'Southeast Asia',  flagEmoji:'🇸🇬' },
  { id:'KH', iso3:'KHM', name:'Cambodia',            dialCode:'+855', region:'Asia',     subRegion:'Southeast Asia',  flagEmoji:'🇰🇭' },
  // Asia — East
  { id:'CN', iso3:'CHN', name:'China',               dialCode:'+86',  region:'Asia',     subRegion:'East Asia',       flagEmoji:'🇨🇳' },
  { id:'JP', iso3:'JPN', name:'Japan',               dialCode:'+81',  region:'Asia',     subRegion:'East Asia',       flagEmoji:'🇯🇵' },
  { id:'KR', iso3:'KOR', name:'South Korea',         dialCode:'+82',  region:'Asia',     subRegion:'East Asia',       flagEmoji:'🇰🇷' },
  { id:'TW', iso3:'TWN', name:'Taiwan',              dialCode:'+886', region:'Asia',     subRegion:'East Asia',       flagEmoji:'🇹🇼' },
  { id:'HK', iso3:'HKG', name:'Hong Kong',           dialCode:'+852', region:'Asia',     subRegion:'East Asia',       flagEmoji:'🇭🇰' },
  // Asia — West / Middle East
  { id:'SA', iso3:'SAU', name:'Saudi Arabia',        dialCode:'+966', region:'Asia',     subRegion:'Western Asia',    flagEmoji:'🇸🇦' },
  { id:'AE', iso3:'ARE', name:'United Arab Emirates',dialCode:'+971', region:'Asia',     subRegion:'Western Asia',    flagEmoji:'🇦🇪' },
  { id:'TR', iso3:'TUR', name:'Turkey',              dialCode:'+90',  region:'Asia',     subRegion:'Western Asia',    flagEmoji:'🇹🇷' },
  { id:'IR', iso3:'IRN', name:'Iran',                dialCode:'+98',  region:'Asia',     subRegion:'Western Asia',    flagEmoji:'🇮🇷' },
  { id:'IL', iso3:'ISR', name:'Israel',              dialCode:'+972', region:'Asia',     subRegion:'Western Asia',    flagEmoji:'🇮🇱' },
  { id:'JO', iso3:'JOR', name:'Jordan',              dialCode:'+962', region:'Asia',     subRegion:'Western Asia',    flagEmoji:'🇯🇴' },
  // Europe — Western
  { id:'GB', iso3:'GBR', name:'United Kingdom',      dialCode:'+44',  region:'Europe',   subRegion:'Western Europe',  flagEmoji:'🇬🇧' },
  { id:'DE', iso3:'DEU', name:'Germany',             dialCode:'+49',  region:'Europe',   subRegion:'Western Europe',  flagEmoji:'🇩🇪' },
  { id:'FR', iso3:'FRA', name:'France',              dialCode:'+33',  region:'Europe',   subRegion:'Western Europe',  flagEmoji:'🇫🇷' },
  { id:'IT', iso3:'ITA', name:'Italy',               dialCode:'+39',  region:'Europe',   subRegion:'Western Europe',  flagEmoji:'🇮🇹' },
  { id:'ES', iso3:'ESP', name:'Spain',               dialCode:'+34',  region:'Europe',   subRegion:'Western Europe',  flagEmoji:'🇪🇸' },
  { id:'NL', iso3:'NLD', name:'Netherlands',         dialCode:'+31',  region:'Europe',   subRegion:'Western Europe',  flagEmoji:'🇳🇱' },
  { id:'PT', iso3:'PRT', name:'Portugal',            dialCode:'+351', region:'Europe',   subRegion:'Western Europe',  flagEmoji:'🇵🇹' },
  { id:'CH', iso3:'CHE', name:'Switzerland',         dialCode:'+41',  region:'Europe',   subRegion:'Western Europe',  flagEmoji:'🇨🇭' },
  { id:'IE', iso3:'IRL', name:'Ireland',             dialCode:'+353', region:'Europe',   subRegion:'Western Europe',  flagEmoji:'🇮🇪' },
  // Europe — Northern
  { id:'SE', iso3:'SWE', name:'Sweden',              dialCode:'+46',  region:'Europe',   subRegion:'Northern Europe', flagEmoji:'🇸🇪' },
  { id:'NO', iso3:'NOR', name:'Norway',              dialCode:'+47',  region:'Europe',   subRegion:'Northern Europe', flagEmoji:'🇳🇴' },
  { id:'DK', iso3:'DNK', name:'Denmark',             dialCode:'+45',  region:'Europe',   subRegion:'Northern Europe', flagEmoji:'🇩🇰' },
  { id:'FI', iso3:'FIN', name:'Finland',             dialCode:'+358', region:'Europe',   subRegion:'Northern Europe', flagEmoji:'🇫🇮' },
  // Europe — Eastern
  { id:'PL', iso3:'POL', name:'Poland',              dialCode:'+48',  region:'Europe',   subRegion:'Eastern Europe',  flagEmoji:'🇵🇱' },
  { id:'CZ', iso3:'CZE', name:'Czech Republic',      dialCode:'+420', region:'Europe',   subRegion:'Eastern Europe',  flagEmoji:'🇨🇿' },
  { id:'HU', iso3:'HUN', name:'Hungary',             dialCode:'+36',  region:'Europe',   subRegion:'Eastern Europe',  flagEmoji:'🇭🇺' },
  { id:'RO', iso3:'ROU', name:'Romania',             dialCode:'+40',  region:'Europe',   subRegion:'Eastern Europe',  flagEmoji:'🇷🇴' },
  { id:'UA', iso3:'UKR', name:'Ukraine',             dialCode:'+380', region:'Europe',   subRegion:'Eastern Europe',  flagEmoji:'🇺🇦' },
  { id:'RU', iso3:'RUS', name:'Russia',              dialCode:'+7',   region:'Europe',   subRegion:'Eastern Europe',  flagEmoji:'🇷🇺' },
  // Americas — North
  { id:'US', iso3:'USA', name:'United States',       dialCode:'+1',   region:'Americas', subRegion:'North America',   flagEmoji:'🇺🇸' },
  { id:'CA', iso3:'CAN', name:'Canada',              dialCode:'+1',   region:'Americas', subRegion:'North America',   flagEmoji:'🇨🇦' },
  { id:'MX', iso3:'MEX', name:'Mexico',              dialCode:'+52',  region:'Americas', subRegion:'North America',   flagEmoji:'🇲🇽' },
  // Americas — Caribbean
  { id:'JM', iso3:'JAM', name:'Jamaica',             dialCode:'+1876',region:'Americas', subRegion:'Caribbean',       flagEmoji:'🇯🇲' },
  { id:'TT', iso3:'TTO', name:'Trinidad & Tobago',   dialCode:'+1868',region:'Americas', subRegion:'Caribbean',       flagEmoji:'🇹🇹' },
  { id:'BB', iso3:'BRB', name:'Barbados',            dialCode:'+1246',region:'Americas', subRegion:'Caribbean',       flagEmoji:'🇧🇧' },
  { id:'HT', iso3:'HTI', name:'Haiti',               dialCode:'+509', region:'Americas', subRegion:'Caribbean',       flagEmoji:'🇭🇹' },
  { id:'DO', iso3:'DOM', name:'Dominican Republic',  dialCode:'+1809',region:'Americas', subRegion:'Caribbean',       flagEmoji:'🇩🇴' },
  // Americas — Central
  { id:'GT', iso3:'GTM', name:'Guatemala',           dialCode:'+502', region:'Americas', subRegion:'Central America', flagEmoji:'🇬🇹' },
  { id:'HN', iso3:'HND', name:'Honduras',            dialCode:'+504', region:'Americas', subRegion:'Central America', flagEmoji:'🇭🇳' },
  { id:'SV', iso3:'SLV', name:'El Salvador',         dialCode:'+503', region:'Americas', subRegion:'Central America', flagEmoji:'🇸🇻' },
  { id:'NI', iso3:'NIC', name:'Nicaragua',           dialCode:'+505', region:'Americas', subRegion:'Central America', flagEmoji:'🇳🇮' },
  { id:'CR', iso3:'CRI', name:'Costa Rica',          dialCode:'+506', region:'Americas', subRegion:'Central America', flagEmoji:'🇨🇷' },
  { id:'PA', iso3:'PAN', name:'Panama',              dialCode:'+507', region:'Americas', subRegion:'Central America', flagEmoji:'🇵🇦' },
  // Americas — South
  { id:'BR', iso3:'BRA', name:'Brazil',              dialCode:'+55',  region:'Americas', subRegion:'South America',   flagEmoji:'🇧🇷' },
  { id:'AR', iso3:'ARG', name:'Argentina',           dialCode:'+54',  region:'Americas', subRegion:'South America',   flagEmoji:'🇦🇷' },
  { id:'CO', iso3:'COL', name:'Colombia',            dialCode:'+57',  region:'Americas', subRegion:'South America',   flagEmoji:'🇨🇴' },
  { id:'CL', iso3:'CHL', name:'Chile',               dialCode:'+56',  region:'Americas', subRegion:'South America',   flagEmoji:'🇨🇱' },
  { id:'PE', iso3:'PER', name:'Peru',                dialCode:'+51',  region:'Americas', subRegion:'South America',   flagEmoji:'🇵🇪' },
  { id:'VE', iso3:'VEN', name:'Venezuela',           dialCode:'+58',  region:'Americas', subRegion:'South America',   flagEmoji:'🇻🇪' },
  { id:'EC', iso3:'ECU', name:'Ecuador',             dialCode:'+593', region:'Americas', subRegion:'South America',   flagEmoji:'🇪🇨' },
  { id:'BO', iso3:'BOL', name:'Bolivia',             dialCode:'+591', region:'Americas', subRegion:'South America',   flagEmoji:'🇧🇴' },
  { id:'PY', iso3:'PRY', name:'Paraguay',            dialCode:'+595', region:'Americas', subRegion:'South America',   flagEmoji:'🇵🇾' },
  { id:'UY', iso3:'URY', name:'Uruguay',             dialCode:'+598', region:'Americas', subRegion:'South America',   flagEmoji:'🇺🇾' },
  { id:'GY', iso3:'GUY', name:'Guyana',              dialCode:'+592', region:'Americas', subRegion:'South America',   flagEmoji:'🇬🇾' },
  { id:'SR', iso3:'SUR', name:'Suriname',            dialCode:'+597', region:'Americas', subRegion:'South America',   flagEmoji:'🇸🇷' },
  // Oceania
  { id:'AU', iso3:'AUS', name:'Australia',           dialCode:'+61',  region:'Oceania',  subRegion:'Australasia',     flagEmoji:'🇦🇺' },
  { id:'NZ', iso3:'NZL', name:'New Zealand',         dialCode:'+64',  region:'Oceania',  subRegion:'Australasia',     flagEmoji:'🇳🇿' },
  { id:'PG', iso3:'PNG', name:'Papua New Guinea',    dialCode:'+675', region:'Oceania',  subRegion:'Melanesia',       flagEmoji:'🇵🇬' },
  { id:'FJ', iso3:'FJI', name:'Fiji',                dialCode:'+679', region:'Oceania',  subRegion:'Melanesia',       flagEmoji:'🇫🇯' },
  { id:'WS', iso3:'WSM', name:'Samoa',               dialCode:'+685', region:'Oceania',  subRegion:'Polynesia',       flagEmoji:'🇼🇸' },
];

// ── DEFAULT CURRENCY PER COUNTRY ──────────────────────────────
export const DEFAULT_CURRENCY: Record<string, string> = {
  // Africa
  ZW:'ZWG',  ZA:'ZAR',  ZM:'ZMW',  MW:'MWK',  BW:'BWP',  MZ:'MZN',
  NA:'NAD',  SZ:'SZL',  LS:'LSL',  MG:'MGA',  MU:'MUR',
  KE:'KES',  TZ:'TZS',  UG:'UGX',  ET:'ETB',  RW:'RWF',  BI:'BIF',
  SS:'SSP',  SD:'SDG',
  GH:'GHS',  NG:'NGN',  SN:'XOF',  CI:'XOF',  ML:'XOF',  BF:'XOF',
  GN:'GNF',  BJ:'XOF',  NE:'XOF',  TG:'XOF',  SL:'SLL',  LR:'LRD',
  GM:'GMD',  CV:'CVE',
  CM:'XAF',  AO:'AOA',  CD:'CDF',  CG:'XAF',  GA:'XAF',
  EG:'EGP',  MA:'MAD',  DZ:'DZD',  TN:'TND',  LY:'LYD',
  // Asia
  IN:'INR',  PK:'PKR',  BD:'BDT',  LK:'LKR',  NP:'NPR',
  PH:'PHP',  ID:'IDR',  MY:'MYR',  TH:'THB',  VN:'VND',
  MM:'MMK',  SG:'SGD',  KH:'KHR',
  CN:'CNY',  JP:'JPY',  KR:'KRW',  TW:'TWD',  HK:'HKD',
  KZ:'KZT',  UZ:'UZS',  TM:'TMT',  TJ:'TJS',  KG:'KGS',
  SA:'SAR',  AE:'AED',  TR:'TRY',  IR:'IRR',  IL:'ILS',
  JO:'JOD',  LB:'LBP',  OM:'OMR',  KW:'KWD',  QA:'QAR',  BH:'BHD',
  AM:'AMD',  AZ:'AZN',  GE:'GEL',
  // Europe
  GB:'GBP',  CH:'CHF',  SE:'SEK',  NO:'NOK',  DK:'DKK',  IS:'ISK',
  PL:'PLN',  CZ:'CZK',  HU:'HUF',  RO:'RON',  BG:'BGN',
  UA:'UAH',  BY:'BYN',  MD:'MDL',  RU:'RUB',
  RS:'RSD',  BA:'BAM',  MK:'MKD',  AL:'ALL',
  // Euro countries
  DE:'EUR',  FR:'EUR',  IT:'EUR',  ES:'EUR',  NL:'EUR',  BE:'EUR',
  PT:'EUR',  AT:'EUR',  IE:'EUR',  LU:'EUR',  FI:'EUR',  EE:'EUR',
  LV:'EUR',  LT:'EUR',  SK:'EUR',  GR:'EUR',  HR:'EUR',  SI:'EUR',
  ME:'EUR',  CY:'EUR',  MT:'EUR',
  // Americas
  US:'USD',  CA:'CAD',  MX:'MXN',
  JM:'JMD',  TT:'TTD',  BB:'BBD',  HT:'HTG',  DO:'DOP',
  GT:'GTQ',  HN:'HNL',  SV:'USD',  NI:'NIO',  CR:'CRC',  PA:'PAB',
  BR:'BRL',  AR:'ARS',  CO:'COP',  CL:'CLP',  PE:'PEN',  VE:'VES',
  EC:'USD',  BO:'BOB',  PY:'PYG',  UY:'UYU',  GY:'GYD',  SR:'SRD',
  // Oceania
  AU:'AUD',  NZ:'NZD',  PG:'PGK',  FJ:'FJD',  WS:'WST',
};

// ── CURRENCY SYMBOLS ──────────────────────────────────────────
export const CURRENCY_SYMBOL: Record<string, string> = {
  ZWG:'ZiG', ZAR:'R',   ZMW:'ZK',  MWK:'MK',  BWP:'P',   MZN:'MT',
  NAD:'N$',  SZL:'E',   LSL:'M',   MGA:'Ar',  MUR:'₨',
  KES:'KSh', TZS:'TSh', UGX:'USh', ETB:'Br',  RWF:'RF',  BIF:'Fr',
  GHS:'₵',   NGN:'₦',   XOF:'CFA', XAF:'FCFA',GNF:'Fr',  SLL:'Le',
  LRD:'$',   GMD:'D',   CVE:'$',   AOA:'Kz',  CDF:'Fr',
  EGP:'E£',  MAD:'MAD', DZD:'DA',  TND:'DT',  LYD:'LD',
  INR:'₹',   PKR:'₨',   BDT:'৳',   LKR:'Rs',  NPR:'Rs',
  PHP:'₱',   IDR:'Rp',  MYR:'RM',  THB:'฿',   VND:'₫',
  MMK:'K',   SGD:'S$',  KHR:'៛',
  CNY:'¥',   JPY:'¥',   KRW:'₩',   TWD:'NT$', HKD:'HK$',
  KZT:'₸',   UZS:'so\'m',TMT:'T',  TJS:'SM',  KGS:'с',
  SAR:'SR',  AED:'د.إ', TRY:'₺',   IRR:'﷼',   ILS:'₪',
  JOD:'JD',  LBP:'LL',  OMR:'RO',  KWD:'KD',  QAR:'QR',  BHD:'BD',
  AMD:'֏',   AZN:'₼',   GEL:'₾',
  GBP:'£',   EUR:'€',   CHF:'Fr',  SEK:'kr',  NOK:'kr',  DKK:'kr',
  ISK:'kr',  PLN:'zł',  CZK:'Kč',  HUF:'Ft',  RON:'lei', BGN:'лв',
  UAH:'₴',   BYN:'Br',  MDL:'L',   RUB:'₽',   RSD:'din', BAM:'KM',
  MKD:'ден', ALL:'L',
  USD:'$',   CAD:'C$',  MXN:'$',
  JMD:'$',   TTD:'$',   BBD:'$',   HTG:'G',   DOP:'$',
  GTQ:'Q',   HNL:'L',   NIO:'C$',  CRC:'₡',   PAB:'B/.',
  BRL:'R$',  ARS:'$',   COP:'$',   CLP:'$',   PEN:'S/', VES:'Bs',
  BOB:'Bs',  PYG:'₲',   UYU:'$',   GYD:'$',   SRD:'$',
  AUD:'A$',  NZD:'NZ$', PGK:'K',   FJD:'$',   WST:'T',
};

// ── HELPERS ────────────────────────────────────────────────────

export function getCountry(id: string) {
  return COUNTRIES.find(c => c.id === id);
}

export function getCountriesByRegion(): Record<string, RefCountry[]> {
  return COUNTRIES.reduce((acc, c) => {
    if (!acc[c.region]) acc[c.region] = [];
    acc[c.region].push(c);
    return acc;
  }, {} as Record<string, RefCountry[]>);
}

export function getCountriesBySubRegion(): Record<string, RefCountry[]> {
  return COUNTRIES.reduce((acc, c) => {
    if (!acc[c.subRegion]) acc[c.subRegion] = [];
    acc[c.subRegion].push(c);
    return acc;
  }, {} as Record<string, RefCountry[]>);
}

export function getDefaultCurrency(countryId: string): string {
  return DEFAULT_CURRENCY[countryId] ?? 'USD';
}

export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOL[code] ?? code;
}

export function formatDialCode(countryId: string): string {
  const c = getCountry(countryId);
  return c ? `${c.flagEmoji} ${c.dialCode}` : '';
}

// For dropdowns that need full country+dial code display
export function getCountryDialOptions() {
  return COUNTRIES.map(c => ({
    value: c.id,
    label: `${c.flagEmoji} ${c.name} (${c.dialCode})`,
    dialCode: c.dialCode,
  }));
}
