// src/app/api/reference/route.ts
// Fully self-contained — no external HTTP calls, zero network dependency.
// All ~250 countries bundled; currencies mapped to schema CurrencyCode enum.
// Payment methods mapped to schema PaymentMethod enum.

import { NextRequest, NextResponse } from 'next/server';

const ok  = (data: unknown) => NextResponse.json({ success: true, data });
const err = (error: string, s = 400) => NextResponse.json({ success: false, error }, { status: s });

// ── Types ─────────────────────────────────────────────────────────────────────
interface RefCurrency { id: string; name: string; symbol: string; isDefault: boolean; }
interface RefPayment  { code: string; name: string; category: string; isDefault: boolean; }
interface RefCountry  {
  id: string; name: string; dialCode: string; flagEmoji: string;
  region: string; currencies: RefCurrency[]; paymentMethods: RefPayment[];
}

// ── Schema-valid currencies only (CurrencyCode enum in schema.prisma) ─────────
const CURRENCY_META: Record<string, RefCurrency> = {
  USD: { id: 'USD', name: 'US Dollar',            symbol: '$',   isDefault: false },
  ZAR: { id: 'ZAR', name: 'South African Rand',   symbol: 'R',   isDefault: false },
  ZWG: { id: 'ZWG', name: 'Zimbabwe Gold (ZiG)',  symbol: 'ZiG', isDefault: false },
  KES: { id: 'KES', name: 'Kenyan Shilling',      symbol: 'KSh', isDefault: false },
  TZS: { id: 'TZS', name: 'Tanzanian Shilling',   symbol: 'TSh', isDefault: false },
  UGX: { id: 'UGX', name: 'Ugandan Shilling',     symbol: 'USh', isDefault: false },
  ZMW: { id: 'ZMW', name: 'Zambian Kwacha',       symbol: 'ZK',  isDefault: false },
  BWP: { id: 'BWP', name: 'Botswana Pula',        symbol: 'P',   isDefault: false },
  MWK: { id: 'MWK', name: 'Malawian Kwacha',      symbol: 'MK',  isDefault: false },
  EUR: { id: 'EUR', name: 'Euro',                 symbol: '€',   isDefault: false },
  GBP: { id: 'GBP', name: 'British Pound',        symbol: '£',   isDefault: false },
};

const USD = (): RefCurrency => ({ ...CURRENCY_META.USD, isDefault: false });
const cur = (id: string, def = false): RefCurrency => ({ ...CURRENCY_META[id], isDefault: def });

// ── Payment methods (PaymentMethod enum in schema.prisma) ─────────────────────
const PM = {
  bank:  (def=false): RefPayment => ({ code:'BANK_TRANSFER', name:'Bank Transfer',      category:'bank',         isDefault:def }),
  card:  (def=false): RefPayment => ({ code:'CARD',          name:'Debit / Credit Card', category:'card',         isDefault:def }),
  mtn:   (def=false): RefPayment => ({ code:'MTN_MOMO',      name:'MTN MoMo',           category:'mobile_money', isDefault:def }),
  mpesa: (def=false): RefPayment => ({ code:'MPESA',         name:'M-Pesa',             category:'mobile_money', isDefault:def }),
  eco:   (def=false): RefPayment => ({ code:'ECOCASH',       name:'EcoCash',            category:'mobile_money', isDefault:def }),
  ussd:  (def=false): RefPayment => ({ code:'USSD',          name:'USSD',               category:'mobile_money', isDefault:def }),
};
const DEF_PM = (): RefPayment[] => [PM.bank(true), PM.card()];

// ── Country data (bundled — no external fetch) ────────────────────────────────
// Format: [cca2, name, dialCode, flag, region, [currencies...], [payments...]]
// currencies: first in array = default; USD appended automatically if not present
// payments:   first in array = default

const COUNTRIES: RefCountry[] = (() => {

  // Raw seed data: [id, name, dialCode, flagEmoji, region, primaryCurrencyId, paymentMethods]
  // Countries with schema-valid primary currencies listed explicitly.
  // All others get USD as default currency.
  type Seed = [string, string, string, string, string, string | null, RefPayment[]];

  const seeds: Seed[] = [
    // ── Africa ───────────────────────────────────────────────────────────────
    ['DZ','Algeria',         '+213','🇩🇿','North Africa',        null,  DEF_PM()],
    ['AO','Angola',          '+244','🇦🇴','Central Africa',      null,  DEF_PM()],
    ['BJ','Benin',           '+229','🇧🇯','West Africa',         null,  [PM.mtn(true),   PM.bank()]],
    ['BW','Botswana',        '+267','🇧🇼','Southern Africa',     'BWP', DEF_PM()],
    ['BF','Burkina Faso',    '+226','🇧🇫','West Africa',         null,  [PM.mtn(true),   PM.bank()]],
    ['BI','Burundi',         '+257','🇧🇮','East Africa',         null,  [PM.bank(true),  PM.ussd()]],
    ['CM','Cameroon',        '+237','🇨🇲','Central Africa',      null,  [PM.mtn(true),   PM.bank()]],
    ['CV','Cape Verde',      '+238','🇨🇻','West Africa',         null,  DEF_PM()],
    ['CF','Central African Republic','+236','🇨🇫','Central Africa',null,[PM.bank(true)]],
    ['TD','Chad',            '+235','🇹🇩','Central Africa',      null,  [PM.bank(true)]],
    ['KM','Comoros',         '+269','🇰🇲','East Africa',         null,  DEF_PM()],
    ['CD','DR Congo',        '+243','🇨🇩','Central Africa',      null,  [PM.mtn(true),   PM.bank()]],
    ['CG','Republic of Congo','+242','🇨🇬','Central Africa',     null,  [PM.mtn(true),   PM.bank()]],
    ['CI','Côte d\'Ivoire',  '+225','🇨🇮','West Africa',         null,  [PM.mtn(true),   PM.bank()]],
    ['DJ','Djibouti',        '+253','🇩🇯','East Africa',         null,  DEF_PM()],
    ['EG','Egypt',           '+20', '🇪🇬','North Africa',        null,  [PM.bank(true),  PM.card()]],
    ['GQ','Equatorial Guinea','+240','🇬🇶','Central Africa',     null,  DEF_PM()],
    ['ER','Eritrea',         '+291','🇪🇷','East Africa',         null,  DEF_PM()],
    ['SZ','Eswatini',        '+268','🇸🇿','Southern Africa',     'ZAR', DEF_PM()],
    ['ET','Ethiopia',        '+251','🇪🇹','East Africa',         null,  [PM.bank(true),  PM.ussd()]],
    ['GA','Gabon',           '+241','🇬🇦','Central Africa',      null,  DEF_PM()],
    ['GM','Gambia',          '+220','🇬🇲','West Africa',         null,  DEF_PM()],
    ['GH','Ghana',           '+233','🇬🇭','West Africa',         null,  [PM.mtn(true),   PM.mpesa(), PM.bank()]],
    ['GN','Guinea',          '+224','🇬🇳','West Africa',         null,  [PM.mtn(true),   PM.bank()]],
    ['GW','Guinea-Bissau',   '+245','🇬🇼','West Africa',         null,  DEF_PM()],
    ['KE','Kenya',           '+254','🇰🇪','East Africa',         'KES', [PM.mpesa(true), PM.bank(),  PM.card()]],
    ['LS','Lesotho',         '+266','🇱🇸','Southern Africa',     'ZAR', DEF_PM()],
    ['LR','Liberia',         '+231','🇱🇷','West Africa',         null,  DEF_PM()],
    ['LY','Libya',           '+218','🇱🇾','North Africa',        null,  DEF_PM()],
    ['MG','Madagascar',      '+261','🇲🇬','East Africa',         null,  DEF_PM()],
    ['MW','Malawi',          '+265','🇲🇼','East Africa',         'MWK', [PM.mtn(true),   PM.bank()]],
    ['ML','Mali',            '+223','🇲🇱','West Africa',         null,  [PM.mtn(true),   PM.bank()]],
    ['MR','Mauritania',      '+222','🇲🇷','West Africa',         null,  DEF_PM()],
    ['MU','Mauritius',       '+230','🇲🇺','East Africa',         null,  DEF_PM()],
    ['MA','Morocco',         '+212','🇲🇦','North Africa',        null,  [PM.bank(true),  PM.card()]],
    ['MZ','Mozambique',      '+258','🇲🇿','East Africa',         null,  [PM.mpesa(true), PM.bank()]],
    ['NA','Namibia',         '+264','🇳🇦','Southern Africa',     'ZAR', DEF_PM()],
    ['NE','Niger',           '+227','🇳🇪','West Africa',         null,  [PM.mtn(true),   PM.bank()]],
    ['NG','Nigeria',         '+234','🇳🇬','West Africa',         null,  [PM.bank(true),  PM.card(),  PM.ussd()]],
    ['RW','Rwanda',          '+250','🇷🇼','East Africa',         null,  [PM.mtn(true),   PM.mpesa(), PM.bank()]],
    ['ST','São Tomé and Príncipe','+239','🇸🇹','Central Africa', null,  DEF_PM()],
    ['SN','Senegal',         '+221','🇸🇳','West Africa',         null,  [PM.mtn(true),   PM.bank()]],
    ['SC','Seychelles',      '+248','🇸🇨','East Africa',         null,  DEF_PM()],
    ['SL','Sierra Leone',    '+232','🇸🇱','West Africa',         null,  DEF_PM()],
    ['SO','Somalia',         '+252','🇸🇴','East Africa',         null,  [PM.mpesa(true), PM.bank()]],
    ['ZA','South Africa',    '+27', '🇿🇦','Southern Africa',     'ZAR', [PM.bank(true),  PM.card(),  PM.mtn()]],
    ['SS','South Sudan',     '+211','🇸🇸','East Africa',         null,  DEF_PM()],
    ['SD','Sudan',           '+249','🇸🇩','North Africa',        null,  DEF_PM()],
    ['TZ','Tanzania',        '+255','🇹🇿','East Africa',         'TZS', [PM.mpesa(true), PM.mtn(),   PM.bank()]],
    ['TG','Togo',            '+228','🇹🇬','West Africa',         null,  [PM.mtn(true),   PM.bank()]],
    ['TN','Tunisia',         '+216','🇹🇳','North Africa',        null,  [PM.bank(true),  PM.card()]],
    ['UG','Uganda',          '+256','🇺🇬','East Africa',         'UGX', [PM.mtn(true),   PM.bank(),  PM.ussd()]],
    ['ZM','Zambia',          '+260','🇿🇲','Southern Africa',     'ZMW', [PM.mtn(true),   PM.bank()]],
    ['ZW','Zimbabwe',        '+263','🇿🇼','Southern Africa',     'ZWG', [PM.eco(true),   PM.bank(),  PM.card(), PM.ussd()]],

    // ── Americas ──────────────────────────────────────────────────────────────
    ['AG','Antigua and Barbuda','+1','🇦🇬','Caribbean',          null,  DEF_PM()],
    ['AR','Argentina',       '+54', '🇦🇷','South America',       null,  DEF_PM()],
    ['BS','Bahamas',         '+1',  '🇧🇸','Caribbean',           null,  DEF_PM()],
    ['BB','Barbados',        '+1',  '🇧🇧','Caribbean',           null,  DEF_PM()],
    ['BZ','Belize',          '+501','🇧🇿','Central America',     null,  DEF_PM()],
    ['BO','Bolivia',         '+591','🇧🇴','South America',       null,  DEF_PM()],
    ['BR','Brazil',          '+55', '🇧🇷','South America',       null,  [PM.bank(true),  PM.card()]],
    ['CA','Canada',          '+1',  '🇨🇦','North America',       null,  [PM.bank(true),  PM.card()]],
    ['CL','Chile',           '+56', '🇨🇱','South America',       null,  DEF_PM()],
    ['CO','Colombia',        '+57', '🇨🇴','South America',       null,  DEF_PM()],
    ['CR','Costa Rica',      '+506','🇨🇷','Central America',     null,  DEF_PM()],
    ['CU','Cuba',            '+53', '🇨🇺','Caribbean',           null,  DEF_PM()],
    ['DM','Dominica',        '+1',  '🇩🇲','Caribbean',           null,  DEF_PM()],
    ['DO','Dominican Republic','+1','🇩🇴','Caribbean',           null,  DEF_PM()],
    ['EC','Ecuador',         '+593','🇪🇨','South America',       null,  DEF_PM()],
    ['SV','El Salvador',     '+503','🇸🇻','Central America',     null,  DEF_PM()],
    ['GD','Grenada',         '+1',  '🇬🇩','Caribbean',           null,  DEF_PM()],
    ['GT','Guatemala',       '+502','🇬🇹','Central America',     null,  DEF_PM()],
    ['GY','Guyana',          '+592','🇬🇾','South America',       null,  DEF_PM()],
    ['HT','Haiti',           '+509','🇭🇹','Caribbean',           null,  DEF_PM()],
    ['HN','Honduras',        '+504','🇭🇳','Central America',     null,  DEF_PM()],
    ['JM','Jamaica',         '+1',  '🇯🇲','Caribbean',           null,  DEF_PM()],
    ['MX','Mexico',          '+52', '🇲🇽','North America',       null,  [PM.bank(true),  PM.card()]],
    ['NI','Nicaragua',       '+505','🇳🇮','Central America',     null,  DEF_PM()],
    ['PA','Panama',          '+507','🇵🇦','Central America',     null,  DEF_PM()],
    ['PY','Paraguay',        '+595','🇵🇾','South America',       null,  DEF_PM()],
    ['PE','Peru',            '+51', '🇵🇪','South America',       null,  DEF_PM()],
    ['KN','Saint Kitts and Nevis','+1','🇰🇳','Caribbean',        null,  DEF_PM()],
    ['LC','Saint Lucia',     '+1',  '🇱🇨','Caribbean',           null,  DEF_PM()],
    ['VC','Saint Vincent and the Grenadines','+1','🇻🇨','Caribbean',null,DEF_PM()],
    ['SR','Suriname',        '+597','🇸🇷','South America',       null,  DEF_PM()],
    ['TT','Trinidad and Tobago','+1','🇹🇹','Caribbean',          null,  DEF_PM()],
    ['US','United States',   '+1',  '🇺🇸','North America',       null,  [PM.bank(true),  PM.card()]],
    ['UY','Uruguay',         '+598','🇺🇾','South America',       null,  DEF_PM()],
    ['VE','Venezuela',       '+58', '🇻🇪','South America',       null,  DEF_PM()],

    // ── Asia ─────────────────────────────────────────────────────────────────
    ['AF','Afghanistan',     '+93', '🇦🇫','Southern Asia',       null,  DEF_PM()],
    ['AM','Armenia',         '+374','🇦🇲','Western Asia',        null,  DEF_PM()],
    ['AZ','Azerbaijan',      '+994','🇦🇿','Western Asia',        null,  DEF_PM()],
    ['BH','Bahrain',         '+973','🇧🇭','Western Asia',        null,  DEF_PM()],
    ['BD','Bangladesh',      '+880','🇧🇩','Southern Asia',       null,  [PM.bank(true),  PM.ussd()]],
    ['BT','Bhutan',          '+975','🇧🇹','Southern Asia',       null,  DEF_PM()],
    ['BN','Brunei',          '+673','🇧🇳','South-Eastern Asia',  null,  DEF_PM()],
    ['KH','Cambodia',        '+855','🇰🇭','South-Eastern Asia',  null,  DEF_PM()],
    ['CN','China',           '+86', '🇨🇳','Eastern Asia',        null,  [PM.bank(true),  PM.card()]],
    ['CY','Cyprus',          '+357','🇨🇾','Western Asia',        'EUR', DEF_PM()],
    ['GE','Georgia',         '+995','🇬🇪','Western Asia',        null,  DEF_PM()],
    ['IN','India',           '+91', '🇮🇳','Southern Asia',       null,  [PM.bank(true),  PM.card(),  PM.ussd()]],
    ['ID','Indonesia',       '+62', '🇮🇩','South-Eastern Asia',  null,  [PM.bank(true),  PM.card()]],
    ['IR','Iran',            '+98', '🇮🇷','Southern Asia',       null,  DEF_PM()],
    ['IQ','Iraq',            '+964','🇮🇶','Western Asia',        null,  DEF_PM()],
    ['IL','Israel',          '+972','🇮🇱','Western Asia',        null,  DEF_PM()],
    ['JP','Japan',           '+81', '🇯🇵','Eastern Asia',        null,  [PM.bank(true),  PM.card()]],
    ['JO','Jordan',          '+962','🇯🇴','Western Asia',        null,  DEF_PM()],
    ['KZ','Kazakhstan',      '+7',  '🇰🇿','Central Asia',        null,  DEF_PM()],
    ['KW','Kuwait',          '+965','🇰🇼','Western Asia',        null,  DEF_PM()],
    ['KG','Kyrgyzstan',      '+996','🇰🇬','Central Asia',        null,  DEF_PM()],
    ['LA','Laos',            '+856','🇱🇦','South-Eastern Asia',  null,  DEF_PM()],
    ['LB','Lebanon',         '+961','🇱🇧','Western Asia',        null,  DEF_PM()],
    ['MY','Malaysia',        '+60', '🇲🇾','South-Eastern Asia',  null,  [PM.bank(true),  PM.card()]],
    ['MV','Maldives',        '+960','🇲🇻','Southern Asia',       null,  DEF_PM()],
    ['MN','Mongolia',        '+976','🇲🇳','Eastern Asia',        null,  DEF_PM()],
    ['MM','Myanmar',         '+95', '🇲🇲','South-Eastern Asia',  null,  DEF_PM()],
    ['NP','Nepal',           '+977','🇳🇵','Southern Asia',       null,  DEF_PM()],
    ['KP','North Korea',     '+850','🇰🇵','Eastern Asia',        null,  DEF_PM()],
    ['OM','Oman',            '+968','🇴🇲','Western Asia',        null,  DEF_PM()],
    ['PK','Pakistan',        '+92', '🇵🇰','Southern Asia',       null,  [PM.bank(true),  PM.ussd()]],
    ['PS','Palestine',       '+970','🇵🇸','Western Asia',        null,  DEF_PM()],
    ['PH','Philippines',     '+63', '🇵🇭','South-Eastern Asia',  null,  [PM.bank(true),  PM.card()]],
    ['QA','Qatar',           '+974','🇶🇦','Western Asia',        null,  DEF_PM()],
    ['SA','Saudi Arabia',    '+966','🇸🇦','Western Asia',        null,  [PM.bank(true),  PM.card()]],
    ['SG','Singapore',       '+65', '🇸🇬','South-Eastern Asia',  null,  [PM.bank(true),  PM.card()]],
    ['KR','South Korea',     '+82', '🇰🇷','Eastern Asia',        null,  [PM.bank(true),  PM.card()]],
    ['LK','Sri Lanka',       '+94', '🇱🇰','Southern Asia',       null,  DEF_PM()],
    ['SY','Syria',           '+963','🇸🇾','Western Asia',        null,  DEF_PM()],
    ['TW','Taiwan',          '+886','🇹🇼','Eastern Asia',        null,  DEF_PM()],
    ['TJ','Tajikistan',      '+992','🇹🇯','Central Asia',        null,  DEF_PM()],
    ['TH','Thailand',        '+66', '🇹🇭','South-Eastern Asia',  null,  [PM.bank(true),  PM.card()]],
    ['TL','Timor-Leste',     '+670','🇹🇱','South-Eastern Asia',  null,  DEF_PM()],
    ['TR','Turkey',          '+90', '🇹🇷','Western Asia',        null,  [PM.bank(true),  PM.card()]],
    ['TM','Turkmenistan',    '+993','🇹🇲','Central Asia',        null,  DEF_PM()],
    ['AE','United Arab Emirates','+971','🇦🇪','Western Asia',    null,  [PM.bank(true),  PM.card()]],
    ['UZ','Uzbekistan',      '+998','🇺🇿','Central Asia',        null,  DEF_PM()],
    ['VN','Vietnam',         '+84', '🇻🇳','South-Eastern Asia',  null,  [PM.bank(true),  PM.card()]],
    ['YE','Yemen',           '+967','🇾🇪','Western Asia',        null,  DEF_PM()],

    // ── Europe ────────────────────────────────────────────────────────────────
    ['AL','Albania',         '+355','🇦🇱','Southern Europe',     'EUR', DEF_PM()],
    ['AD','Andorra',         '+376','🇦🇩','Southern Europe',     'EUR', DEF_PM()],
    ['AT','Austria',         '+43', '🇦🇹','Western Europe',      'EUR', DEF_PM()],
    ['BY','Belarus',         '+375','🇧🇾','Eastern Europe',      null,  DEF_PM()],
    ['BE','Belgium',         '+32', '🇧🇪','Western Europe',      'EUR', DEF_PM()],
    ['BA','Bosnia and Herzegovina','+387','🇧🇦','Southern Europe',null, DEF_PM()],
    ['BG','Bulgaria',        '+359','🇧🇬','Eastern Europe',      'EUR', DEF_PM()],
    ['HR','Croatia',         '+385','🇭🇷','Southern Europe',     'EUR', DEF_PM()],
    ['CZ','Czech Republic',  '+420','🇨🇿','Eastern Europe',      null,  DEF_PM()],
    ['DK','Denmark',         '+45', '🇩🇰','Northern Europe',     null,  DEF_PM()],
    ['EE','Estonia',         '+372','🇪🇪','Northern Europe',     'EUR', DEF_PM()],
    ['FI','Finland',         '+358','🇫🇮','Northern Europe',     'EUR', DEF_PM()],
    ['FR','France',          '+33', '🇫🇷','Western Europe',      'EUR', DEF_PM()],
    ['DE','Germany',         '+49', '🇩🇪','Western Europe',      'EUR', DEF_PM()],
    ['GR','Greece',          '+30', '🇬🇷','Southern Europe',     'EUR', DEF_PM()],
    ['HU','Hungary',         '+36', '🇭🇺','Eastern Europe',      'EUR', DEF_PM()],
    ['IS','Iceland',         '+354','🇮🇸','Northern Europe',     null,  DEF_PM()],
    ['IE','Ireland',         '+353','🇮🇪','Northern Europe',     'EUR', DEF_PM()],
    ['IT','Italy',           '+39', '🇮🇹','Southern Europe',     'EUR', DEF_PM()],
    ['XK','Kosovo',          '+383','🇽🇰','Southern Europe',     'EUR', DEF_PM()],
    ['LV','Latvia',          '+371','🇱🇻','Northern Europe',     'EUR', DEF_PM()],
    ['LI','Liechtenstein',   '+423','🇱🇮','Western Europe',      null,  DEF_PM()],
    ['LT','Lithuania',       '+370','🇱🇹','Northern Europe',     'EUR', DEF_PM()],
    ['LU','Luxembourg',      '+352','🇱🇺','Western Europe',      'EUR', DEF_PM()],
    ['MT','Malta',           '+356','🇲🇹','Southern Europe',     'EUR', DEF_PM()],
    ['MD','Moldova',         '+373','🇲🇩','Eastern Europe',      null,  DEF_PM()],
    ['MC','Monaco',          '+377','🇲🇨','Western Europe',      'EUR', DEF_PM()],
    ['ME','Montenegro',      '+382','🇲🇪','Southern Europe',     'EUR', DEF_PM()],
    ['NL','Netherlands',     '+31', '🇳🇱','Western Europe',      'EUR', DEF_PM()],
    ['MK','North Macedonia', '+389','🇲🇰','Southern Europe',     null,  DEF_PM()],
    ['NO','Norway',          '+47', '🇳🇴','Northern Europe',     null,  DEF_PM()],
    ['PL','Poland',          '+48', '🇵🇱','Eastern Europe',      null,  DEF_PM()],
    ['PT','Portugal',        '+351','🇵🇹','Southern Europe',     'EUR', DEF_PM()],
    ['RO','Romania',         '+40', '🇷🇴','Eastern Europe',      null,  DEF_PM()],
    ['RU','Russia',          '+7',  '🇷🇺','Eastern Europe',      null,  DEF_PM()],
    ['SM','San Marino',      '+378','🇸🇲','Southern Europe',     'EUR', DEF_PM()],
    ['RS','Serbia',          '+381','🇷🇸','Southern Europe',     null,  DEF_PM()],
    ['SK','Slovakia',        '+421','🇸🇰','Eastern Europe',      'EUR', DEF_PM()],
    ['SI','Slovenia',        '+386','🇸🇮','Southern Europe',     'EUR', DEF_PM()],
    ['ES','Spain',           '+34', '🇪🇸','Southern Europe',     'EUR', DEF_PM()],
    ['SE','Sweden',          '+46', '🇸🇪','Northern Europe',     null,  DEF_PM()],
    ['CH','Switzerland',     '+41', '🇨🇭','Western Europe',      null,  DEF_PM()],
    ['UA','Ukraine',         '+380','🇺🇦','Eastern Europe',      null,  DEF_PM()],
    ['GB','United Kingdom',  '+44', '🇬🇧','Northern Europe',     'GBP', [PM.bank(true),  PM.card()]],
    ['VA','Vatican City',    '+379','🇻🇦','Southern Europe',     'EUR', DEF_PM()],

    // ── Oceania ───────────────────────────────────────────────────────────────
    ['AU','Australia',       '+61', '🇦🇺','Australia and NZ',    null,  [PM.bank(true),  PM.card()]],
    ['FJ','Fiji',            '+679','🇫🇯','Melanesia',           null,  DEF_PM()],
    ['KI','Kiribati',        '+686','🇰🇮','Micronesia',          null,  DEF_PM()],
    ['MH','Marshall Islands','+692','🇲🇭','Micronesia',          null,  DEF_PM()],
    ['FM','Micronesia',      '+691','🇫🇲','Micronesia',          null,  DEF_PM()],
    ['NR','Nauru',           '+674','🇳🇷','Micronesia',          null,  DEF_PM()],
    ['NZ','New Zealand',     '+64', '🇳🇿','Australia and NZ',    null,  DEF_PM()],
    ['PW','Palau',           '+680','🇵🇼','Micronesia',          null,  DEF_PM()],
    ['PG','Papua New Guinea','+675','🇵🇬','Melanesia',           null,  DEF_PM()],
    ['WS','Samoa',           '+685','🇼🇸','Polynesia',           null,  DEF_PM()],
    ['SB','Solomon Islands', '+677','🇸🇧','Melanesia',           null,  DEF_PM()],
    ['TO','Tonga',           '+676','🇹🇴','Polynesia',           null,  DEF_PM()],
    ['TV','Tuvalu',          '+688','🇹🇻','Polynesia',           null,  DEF_PM()],
    ['VU','Vanuatu',         '+678','🇻🇺','Melanesia',           null,  DEF_PM()],
  ];

  return seeds
    .map(([id, name, dialCode, flagEmoji, region, primaryCurrId, paymentMethods]) => {
      const currencies: RefCurrency[] = [];

      if (primaryCurrId && CURRENCY_META[primaryCurrId]) {
        currencies.push(cur(primaryCurrId, true));
      }

      // Always add USD as secondary unless it's already the primary
      if (primaryCurrId !== 'USD') {
        currencies.push(USD());
      }

      // If no primary was set (null), USD becomes the default
      if (!primaryCurrId) {
        currencies[0].isDefault = true;
      }

      return { id, name, dialCode, flagEmoji, region, currencies, paymentMethods };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
})();

// ── GET /api/reference ────────────────────────────────────────────────────────
// ?type=full       → full country list (default)
// ?type=currencies → flat list of distinct schema-valid currencies
// ?countryId=ZW    → single country record
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const type      = searchParams.get('type')      ?? 'full';
    const countryId = searchParams.get('countryId') ?? null;

    if (countryId) {
      const country = COUNTRIES.find(c => c.id === countryId.toUpperCase());
      if (!country) return err(`Country '${countryId}' not found`, 404);
      return ok(country);
    }

    if (type === 'currencies') {
      const seen  = new Set<string>();
      const items: RefCurrency[] = [];
      for (const c of COUNTRIES) {
        for (const cu of c.currencies) {
          if (!seen.has(cu.id)) { seen.add(cu.id); items.push(cu); }
        }
      }
      return ok(items);
    }

    return ok(COUNTRIES);

  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? '';
    console.error('GET /api/reference error:', msg);
    return err(msg || 'Failed to load reference data', 500);
  }
}
