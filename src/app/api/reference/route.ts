// src/app/api/reference/route.ts
// Fully self-contained — no external HTTP calls, zero network dependency.
// All ~250 countries bundled; currencies mapped to schema CurrencyCode enum.
// Payment methods mapped to schema PaymentMethod enum.

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma/client';

const ok  = (data: unknown) => NextResponse.json({ success: true, data });
const err = (error: string, s = 400) => NextResponse.json({ success: false, error }, { status: s });

// ── Types ─────────────────────────────────────────────────────────────────────
interface RefCurrency { id: string; name: string; symbol: string; isDefault: boolean; }
interface RefPayment  { code: string; name: string; category: string; isDefault: boolean; }
interface RefCountry  {
  id: string; name: string; dialCode: string; flagEmoji: string;
  region: string; currencies: RefCurrency[]; paymentMethods: RefPayment[];
}

// ── All currencies used in reference data (must exist in CurrencyCode enum) ────
// First 11 = original enum values; the rest added via expand-currency-enum.sql
const CURRENCY_META: Record<string, RefCurrency> = {
  USD: { id: 'USD', name: 'US Dollar', symbol: '$', isDefault: false },
  ZAR: { id: 'ZAR', name: 'South African Rand', symbol: 'R', isDefault: false },
  ZWG: { id: 'ZWG', name: 'Zimbabwe Gold (ZiG)', symbol: 'ZiG', isDefault: false },
  KES: { id: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', isDefault: false },
  TZS: { id: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', isDefault: false },
  UGX: { id: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', isDefault: false },
  ZMW: { id: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK', isDefault: false },
  BWP: { id: 'BWP', name: 'Botswana Pula', symbol: 'P', isDefault: false },
  MWK: { id: 'MWK', name: 'Malawian Kwacha', symbol: 'MK', isDefault: false },
  EUR: { id: 'EUR', name: 'Euro', symbol: '€', isDefault: false },
  GBP: { id: 'GBP', name: 'British Pound', symbol: '£', isDefault: false },
  AED: { id: 'AED', name: 'UAE Dirham', symbol: 'AED', isDefault: false },
  AFN: { id: 'AFN', name: 'Afghan Afghani', symbol: 'Af', isDefault: false },
  ALL: { id: 'ALL', name: 'Albanian Lek', symbol: 'L', isDefault: false },
  AMD: { id: 'AMD', name: 'Armenian Dram', symbol: '֏', isDefault: false },
  AOA: { id: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz', isDefault: false },
  ARS: { id: 'ARS', name: 'Argentine Peso', symbol: '$', isDefault: false },
  AUD: { id: 'AUD', name: 'Australian Dollar', symbol: 'A$', isDefault: false },
  AZN: { id: 'AZN', name: 'Azerbaijani Manat', symbol: '₼', isDefault: false },
  BAM: { id: 'BAM', name: 'Bosnian Convertible Mark', symbol: 'KM', isDefault: false },
  BBD: { id: 'BBD', name: 'Barbadian Dollar', symbol: 'Bds$', isDefault: false },
  BDT: { id: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', isDefault: false },
  BHD: { id: 'BHD', name: 'Bahraini Dinar', symbol: 'BD', isDefault: false },
  BIF: { id: 'BIF', name: 'Burundian Franc', symbol: 'FBu', isDefault: false },
  BND: { id: 'BND', name: 'Brunei Dollar', symbol: 'B$', isDefault: false },
  BOB: { id: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs', isDefault: false },
  BRL: { id: 'BRL', name: 'Brazilian Real', symbol: 'R$', isDefault: false },
  BSD: { id: 'BSD', name: 'Bahamian Dollar', symbol: 'B$', isDefault: false },
  BTN: { id: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'Nu', isDefault: false },
  BYN: { id: 'BYN', name: 'Belarusian Ruble', symbol: 'Br', isDefault: false },
  BZD: { id: 'BZD', name: 'Belize Dollar', symbol: 'BZ$', isDefault: false },
  CAD: { id: 'CAD', name: 'Canadian Dollar', symbol: 'C$', isDefault: false },
  CDF: { id: 'CDF', name: 'Congolese Franc', symbol: 'FC', isDefault: false },
  CHF: { id: 'CHF', name: 'Swiss Franc', symbol: 'Fr', isDefault: false },
  CLP: { id: 'CLP', name: 'Chilean Peso', symbol: '$', isDefault: false },
  CNY: { id: 'CNY', name: 'Chinese Yuan', symbol: '¥', isDefault: false },
  COP: { id: 'COP', name: 'Colombian Peso', symbol: '$', isDefault: false },
  CRC: { id: 'CRC', name: 'Costa Rican Colón', symbol: '₡', isDefault: false },
  CUP: { id: 'CUP', name: 'Cuban Peso', symbol: '$', isDefault: false },
  CVE: { id: 'CVE', name: 'Cape Verdean Escudo', symbol: 'CV$', isDefault: false },
  CZK: { id: 'CZK', name: 'Czech Koruna', symbol: 'Kč', isDefault: false },
  DJF: { id: 'DJF', name: 'Djiboutian Franc', symbol: 'Fdj', isDefault: false },
  DKK: { id: 'DKK', name: 'Danish Krone', symbol: 'kr', isDefault: false },
  DOP: { id: 'DOP', name: 'Dominican Peso', symbol: 'RD$', isDefault: false },
  DZD: { id: 'DZD', name: 'Algerian Dinar', symbol: 'DA', isDefault: false },
  EGP: { id: 'EGP', name: 'Egyptian Pound', symbol: 'E£', isDefault: false },
  ERN: { id: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk', isDefault: false },
  ETB: { id: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', isDefault: false },
  FJD: { id: 'FJD', name: 'Fijian Dollar', symbol: 'FJ$', isDefault: false },
  GEL: { id: 'GEL', name: 'Georgian Lari', symbol: '₾', isDefault: false },
  GHS: { id: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', isDefault: false },
  GMD: { id: 'GMD', name: 'Gambian Dalasi', symbol: 'D', isDefault: false },
  GNF: { id: 'GNF', name: 'Guinean Franc', symbol: 'FG', isDefault: false },
  GTQ: { id: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q', isDefault: false },
  GYD: { id: 'GYD', name: 'Guyanese Dollar', symbol: 'G$', isDefault: false },
  HNL: { id: 'HNL', name: 'Honduran Lempira', symbol: 'L', isDefault: false },
  HTG: { id: 'HTG', name: 'Haitian Gourde', symbol: 'G', isDefault: false },
  HUF: { id: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', isDefault: false },
  IDR: { id: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', isDefault: false },
  ILS: { id: 'ILS', name: 'Israeli New Shekel', symbol: '₪', isDefault: false },
  INR: { id: 'INR', name: 'Indian Rupee', symbol: '₹', isDefault: false },
  IQD: { id: 'IQD', name: 'Iraqi Dinar', symbol: 'IQD', isDefault: false },
  IRR: { id: 'IRR', name: 'Iranian Rial', symbol: 'IRR', isDefault: false },
  ISK: { id: 'ISK', name: 'Icelandic Króna', symbol: 'kr', isDefault: false },
  JMD: { id: 'JMD', name: 'Jamaican Dollar', symbol: 'J$', isDefault: false },
  JOD: { id: 'JOD', name: 'Jordanian Dinar', symbol: 'JD', isDefault: false },
  JPY: { id: 'JPY', name: 'Japanese Yen', symbol: '¥', isDefault: false },
  KGS: { id: 'KGS', name: 'Kyrgyzstani Som', symbol: 'с', isDefault: false },
  KHR: { id: 'KHR', name: 'Cambodian Riel', symbol: '៛', isDefault: false },
  KMF: { id: 'KMF', name: 'Comorian Franc', symbol: 'CF', isDefault: false },
  KPW: { id: 'KPW', name: 'North Korean Won', symbol: '₩', isDefault: false },
  KRW: { id: 'KRW', name: 'South Korean Won', symbol: '₩', isDefault: false },
  KWD: { id: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD', isDefault: false },
  KZT: { id: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸', isDefault: false },
  LAK: { id: 'LAK', name: 'Lao Kip', symbol: '₭', isDefault: false },
  LBP: { id: 'LBP', name: 'Lebanese Pound', symbol: 'LL', isDefault: false },
  LKR: { id: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', isDefault: false },
  LRD: { id: 'LRD', name: 'Liberian Dollar', symbol: 'L$', isDefault: false },
  LSL: { id: 'LSL', name: 'Lesotho Loti', symbol: 'M', isDefault: false },
  LYD: { id: 'LYD', name: 'Libyan Dinar', symbol: 'LD', isDefault: false },
  MAD: { id: 'MAD', name: 'Moroccan Dirham', symbol: 'DH', isDefault: false },
  MDL: { id: 'MDL', name: 'Moldovan Leu', symbol: 'L', isDefault: false },
  MGA: { id: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar', isDefault: false },
  MKD: { id: 'MKD', name: 'Macedonian Denar', symbol: 'ден', isDefault: false },
  MMK: { id: 'MMK', name: 'Myanmar Kyat', symbol: 'K', isDefault: false },
  MNT: { id: 'MNT', name: 'Mongolian Togrog', symbol: '₮', isDefault: false },
  MRU: { id: 'MRU', name: 'Mauritanian Ouguiya', symbol: 'UM', isDefault: false },
  MUR: { id: 'MUR', name: 'Mauritian Rupee', symbol: '₨', isDefault: false },
  MVR: { id: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'Rf', isDefault: false },
  MXN: { id: 'MXN', name: 'Mexican Peso', symbol: '$', isDefault: false },
  MYR: { id: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', isDefault: false },
  MZN: { id: 'MZN', name: 'Mozambican Metical', symbol: 'MT', isDefault: false },
  NAD: { id: 'NAD', name: 'Namibian Dollar', symbol: 'N$', isDefault: false },
  NGN: { id: 'NGN', name: 'Nigerian Naira', symbol: '₦', isDefault: false },
  NIO: { id: 'NIO', name: 'Nicaraguan Córdoba', symbol: 'C$', isDefault: false },
  NOK: { id: 'NOK', name: 'Norwegian Krone', symbol: 'kr', isDefault: false },
  NPR: { id: 'NPR', name: 'Nepalese Rupee', symbol: 'Rs', isDefault: false },
  NZD: { id: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', isDefault: false },
  OMR: { id: 'OMR', name: 'Omani Rial', symbol: 'RO', isDefault: false },
  PAB: { id: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.', isDefault: false },
  PEN: { id: 'PEN', name: 'Peruvian Sol', symbol: 'S/', isDefault: false },
  PGK: { id: 'PGK', name: 'Papua New Guinean Kina', symbol: 'K', isDefault: false },
  PHP: { id: 'PHP', name: 'Philippine Peso', symbol: '₱', isDefault: false },
  PKR: { id: 'PKR', name: 'Pakistani Rupee', symbol: '₨', isDefault: false },
  PLN: { id: 'PLN', name: 'Polish Zloty', symbol: 'zł', isDefault: false },
  PYG: { id: 'PYG', name: 'Paraguayan Guaraní', symbol: '₲', isDefault: false },
  QAR: { id: 'QAR', name: 'Qatari Riyal', symbol: 'QR', isDefault: false },
  RON: { id: 'RON', name: 'Romanian Leu', symbol: 'lei', isDefault: false },
  RSD: { id: 'RSD', name: 'Serbian Dinar', symbol: 'din', isDefault: false },
  RUB: { id: 'RUB', name: 'Russian Ruble', symbol: '₽', isDefault: false },
  RWF: { id: 'RWF', name: 'Rwandan Franc', symbol: 'RF', isDefault: false },
  SAR: { id: 'SAR', name: 'Saudi Riyal', symbol: 'SR', isDefault: false },
  SBD: { id: 'SBD', name: 'Solomon Islands Dollar', symbol: 'SI$', isDefault: false },
  SCR: { id: 'SCR', name: 'Seychellois Rupee', symbol: 'SRe', isDefault: false },
  SDG: { id: 'SDG', name: 'Sudanese Pound', symbol: 'SDG', isDefault: false },
  SEK: { id: 'SEK', name: 'Swedish Krona', symbol: 'kr', isDefault: false },
  SGD: { id: 'SGD', name: 'Singapore Dollar', symbol: 'S$', isDefault: false },
  SLE: { id: 'SLE', name: 'Sierra Leonean Leone', symbol: 'Le', isDefault: false },
  SOS: { id: 'SOS', name: 'Somali Shilling', symbol: 'Sh', isDefault: false },
  SRD: { id: 'SRD', name: 'Surinamese Dollar', symbol: 'Sr$', isDefault: false },
  SSP: { id: 'SSP', name: 'South Sudanese Pound', symbol: 'SS£', isDefault: false },
  STN: { id: 'STN', name: 'São Tomé Dobra', symbol: 'Db', isDefault: false },
  SYP: { id: 'SYP', name: 'Syrian Pound', symbol: 'S£', isDefault: false },
  SZL: { id: 'SZL', name: 'Swazi Lilangeni', symbol: 'E', isDefault: false },
  THB: { id: 'THB', name: 'Thai Baht', symbol: '฿', isDefault: false },
  TJS: { id: 'TJS', name: 'Tajikistani Somoni', symbol: 'SM', isDefault: false },
  TMT: { id: 'TMT', name: 'Turkmenistani Manat', symbol: 'm', isDefault: false },
  TND: { id: 'TND', name: 'Tunisian Dinar', symbol: 'DT', isDefault: false },
  TOP: { id: 'TOP', name: 'Tongan Pa\'anga', symbol: 'T$', isDefault: false },
  TRY: { id: 'TRY', name: 'Turkish Lira', symbol: '₺', isDefault: false },
  TTD: { id: 'TTD', name: 'Trinidad & Tobago Dollar', symbol: 'TT$', isDefault: false },
  TWD: { id: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$', isDefault: false },
  UAH: { id: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', isDefault: false },
  UYU: { id: 'UYU', name: 'Uruguayan Peso', symbol: '$U', isDefault: false },
  UZS: { id: 'UZS', name: 'Uzbekistani So\'m', symbol: 'so\'m', isDefault: false },
  VES: { id: 'VES', name: 'Venezuelan Bolívar', symbol: 'Bs', isDefault: false },
  VND: { id: 'VND', name: 'Vietnamese Dong', symbol: '₫', isDefault: false },
  VUV: { id: 'VUV', name: 'Vanuatu Vatu', symbol: 'VT', isDefault: false },
  WST: { id: 'WST', name: 'Samoan Tala', symbol: 'T', isDefault: false },
  XAF: { id: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', isDefault: false },
  XCD: { id: 'XCD', name: 'East Caribbean Dollar', symbol: 'EC$', isDefault: false },
  XOF: { id: 'XOF', name: 'West African CFA Franc', symbol: 'CFA', isDefault: false },
  YER: { id: 'YER', name: 'Yemeni Rial', symbol: 'YR', isDefault: false },
};

// ── Secondary currencies in common circulation (non-default) ─────────────────────
// Rand is legal tender / pegged 1:1 in LS, NA, SZ; widely used in ZW.
const EXTRA_CURRENCIES: Record<string, string[]> = {
  LS: ['ZAR'], NA: ['ZAR'], SZ: ['ZAR'], ZW: ['ZAR'],
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
  // EVERY country now lists its correct primary currency (default).
  // USD is appended as a secondary option; EXTRA_CURRENCIES adds regional extras.
  type Seed = [string, string, string, string, string, string | null, RefPayment[]];

  const seeds: Seed[] = [
    // ── Africa ───────────────────────────────────────────────────────────────
    ['DZ','Algeria',         '+213','🇩🇿','North Africa',        'DZD',  DEF_PM()],
    ['AO','Angola',          '+244','🇦🇴','Central Africa',      'AOA',  DEF_PM()],
    ['BJ','Benin',           '+229','🇧🇯','West Africa',         'XOF',  [PM.mtn(true),   PM.bank()]],
    ['BW','Botswana',        '+267','🇧🇼','Southern Africa',     'BWP', DEF_PM()],
    ['BF','Burkina Faso',    '+226','🇧🇫','West Africa',         'XOF',  [PM.mtn(true),   PM.bank()]],
    ['BI','Burundi',         '+257','🇧🇮','East Africa',         'BIF',  [PM.bank(true),  PM.ussd()]],
    ['CM','Cameroon',        '+237','🇨🇲','Central Africa',      'XAF',  [PM.mtn(true),   PM.bank()]],
    ['CV','Cape Verde',      '+238','🇨🇻','West Africa',         'CVE',  DEF_PM()],
    ['CF','Central African Republic','+236','🇨🇫','Central Africa','XAF',[PM.bank(true)]],
    ['TD','Chad',            '+235','🇹🇩','Central Africa',      'XAF',  [PM.bank(true)]],
    ['KM','Comoros',         '+269','🇰🇲','East Africa',         'KMF',  DEF_PM()],
    ['CD','DR Congo',        '+243','🇨🇩','Central Africa',      'CDF',  [PM.mtn(true),   PM.bank()]],
    ['CG','Republic of Congo','+242','🇨🇬','Central Africa',     'XAF',  [PM.mtn(true),   PM.bank()]],
    ['CI','Côte d\'Ivoire',  '+225','🇨🇮','West Africa',         'XOF',  [PM.mtn(true),   PM.bank()]],
    ['DJ','Djibouti',        '+253','🇩🇯','East Africa',         'DJF',  DEF_PM()],
    ['EG','Egypt',           '+20', '🇪🇬','North Africa',        'EGP',  [PM.bank(true),  PM.card()]],
    ['GQ','Equatorial Guinea','+240','🇬🇶','Central Africa',     'XAF',  DEF_PM()],
    ['ER','Eritrea',         '+291','🇪🇷','East Africa',         'ERN',  DEF_PM()],
    ['SZ','Eswatini',        '+268','🇸🇿','Southern Africa',     'SZL', DEF_PM()],
    ['ET','Ethiopia',        '+251','🇪🇹','East Africa',         'ETB',  [PM.bank(true),  PM.ussd()]],
    ['GA','Gabon',           '+241','🇬🇦','Central Africa',      'XAF',  DEF_PM()],
    ['GM','Gambia',          '+220','🇬🇲','West Africa',         'GMD',  DEF_PM()],
    ['GH','Ghana',           '+233','🇬🇭','West Africa',         'GHS',  [PM.mtn(true),   PM.mpesa(), PM.bank()]],
    ['GN','Guinea',          '+224','🇬🇳','West Africa',         'GNF',  [PM.mtn(true),   PM.bank()]],
    ['GW','Guinea-Bissau',   '+245','🇬🇼','West Africa',         'XOF',  DEF_PM()],
    ['KE','Kenya',           '+254','🇰🇪','East Africa',         'KES', [PM.mpesa(true), PM.bank(),  PM.card()]],
    ['LS','Lesotho',         '+266','🇱🇸','Southern Africa',     'LSL', DEF_PM()],
    ['LR','Liberia',         '+231','🇱🇷','West Africa',         'LRD',  DEF_PM()],
    ['LY','Libya',           '+218','🇱🇾','North Africa',        'LYD',  DEF_PM()],
    ['MG','Madagascar',      '+261','🇲🇬','East Africa',         'MGA',  DEF_PM()],
    ['MW','Malawi',          '+265','🇲🇼','East Africa',         'MWK', [PM.mtn(true),   PM.bank()]],
    ['ML','Mali',            '+223','🇲🇱','West Africa',         'XOF',  [PM.mtn(true),   PM.bank()]],
    ['MR','Mauritania',      '+222','🇲🇷','West Africa',         'MRU',  DEF_PM()],
    ['MU','Mauritius',       '+230','🇲🇺','East Africa',         'MUR',  DEF_PM()],
    ['MA','Morocco',         '+212','🇲🇦','North Africa',        'MAD',  [PM.bank(true),  PM.card()]],
    ['MZ','Mozambique',      '+258','🇲🇿','East Africa',         'MZN',  [PM.mpesa(true), PM.bank()]],
    ['NA','Namibia',         '+264','🇳🇦','Southern Africa',     'NAD', DEF_PM()],
    ['NE','Niger',           '+227','🇳🇪','West Africa',         'XOF',  [PM.mtn(true),   PM.bank()]],
    ['NG','Nigeria',         '+234','🇳🇬','West Africa',         'NGN',  [PM.bank(true),  PM.card(),  PM.ussd()]],
    ['RW','Rwanda',          '+250','🇷🇼','East Africa',         'RWF',  [PM.mtn(true),   PM.mpesa(), PM.bank()]],
    ['ST','São Tomé and Príncipe','+239','🇸🇹','Central Africa', 'STN',  DEF_PM()],
    ['SN','Senegal',         '+221','🇸🇳','West Africa',         'XOF',  [PM.mtn(true),   PM.bank()]],
    ['SC','Seychelles',      '+248','🇸🇨','East Africa',         'SCR',  DEF_PM()],
    ['SL','Sierra Leone',    '+232','🇸🇱','West Africa',         'SLE',  DEF_PM()],
    ['SO','Somalia',         '+252','🇸🇴','East Africa',         'SOS',  [PM.mpesa(true), PM.bank()]],
    ['ZA','South Africa',    '+27', '🇿🇦','Southern Africa',     'ZAR', [PM.bank(true),  PM.card(),  PM.mtn()]],
    ['SS','South Sudan',     '+211','🇸🇸','East Africa',         'SSP',  DEF_PM()],
    ['SD','Sudan',           '+249','🇸🇩','North Africa',        'SDG',  DEF_PM()],
    ['TZ','Tanzania',        '+255','🇹🇿','East Africa',         'TZS', [PM.mpesa(true), PM.mtn(),   PM.bank()]],
    ['TG','Togo',            '+228','🇹🇬','West Africa',         'XOF',  [PM.mtn(true),   PM.bank()]],
    ['TN','Tunisia',         '+216','🇹🇳','North Africa',        'TND',  [PM.bank(true),  PM.card()]],
    ['UG','Uganda',          '+256','🇺🇬','East Africa',         'UGX', [PM.mtn(true),   PM.bank(),  PM.ussd()]],
    ['ZM','Zambia',          '+260','🇿🇲','Southern Africa',     'ZMW', [PM.mtn(true),   PM.bank()]],
    ['ZW','Zimbabwe',        '+263','🇿🇼','Southern Africa',     'ZWG', [PM.eco(true),   PM.bank(),  PM.card(), PM.ussd()]],

    // ── Americas ──────────────────────────────────────────────────────────────
    ['AG','Antigua and Barbuda','+1','🇦🇬','Caribbean',          'XCD',  DEF_PM()],
    ['AR','Argentina',       '+54', '🇦🇷','South America',       'ARS',  DEF_PM()],
    ['BS','Bahamas',         '+1',  '🇧🇸','Caribbean',           'BSD',  DEF_PM()],
    ['BB','Barbados',        '+1',  '🇧🇧','Caribbean',           'BBD',  DEF_PM()],
    ['BZ','Belize',          '+501','🇧🇿','Central America',     'BZD',  DEF_PM()],
    ['BO','Bolivia',         '+591','🇧🇴','South America',       'BOB',  DEF_PM()],
    ['BR','Brazil',          '+55', '🇧🇷','South America',       'BRL',  [PM.bank(true),  PM.card()]],
    ['CA','Canada',          '+1',  '🇨🇦','North America',       'CAD',  [PM.bank(true),  PM.card()]],
    ['CL','Chile',           '+56', '🇨🇱','South America',       'CLP',  DEF_PM()],
    ['CO','Colombia',        '+57', '🇨🇴','South America',       'COP',  DEF_PM()],
    ['CR','Costa Rica',      '+506','🇨🇷','Central America',     'CRC',  DEF_PM()],
    ['CU','Cuba',            '+53', '🇨🇺','Caribbean',           'CUP',  DEF_PM()],
    ['DM','Dominica',        '+1',  '🇩🇲','Caribbean',           'XCD',  DEF_PM()],
    ['DO','Dominican Republic','+1','🇩🇴','Caribbean',           'DOP',  DEF_PM()],
    ['EC','Ecuador',         '+593','🇪🇨','South America',       'USD',  DEF_PM()],
    ['SV','El Salvador',     '+503','🇸🇻','Central America',     'USD',  DEF_PM()],
    ['GD','Grenada',         '+1',  '🇬🇩','Caribbean',           'XCD',  DEF_PM()],
    ['GT','Guatemala',       '+502','🇬🇹','Central America',     'GTQ',  DEF_PM()],
    ['GY','Guyana',          '+592','🇬🇾','South America',       'GYD',  DEF_PM()],
    ['HT','Haiti',           '+509','🇭🇹','Caribbean',           'HTG',  DEF_PM()],
    ['HN','Honduras',        '+504','🇭🇳','Central America',     'HNL',  DEF_PM()],
    ['JM','Jamaica',         '+1',  '🇯🇲','Caribbean',           'JMD',  DEF_PM()],
    ['MX','Mexico',          '+52', '🇲🇽','North America',       'MXN',  [PM.bank(true),  PM.card()]],
    ['NI','Nicaragua',       '+505','🇳🇮','Central America',     'NIO',  DEF_PM()],
    ['PA','Panama',          '+507','🇵🇦','Central America',     'PAB',  DEF_PM()],
    ['PY','Paraguay',        '+595','🇵🇾','South America',       'PYG',  DEF_PM()],
    ['PE','Peru',            '+51', '🇵🇪','South America',       'PEN',  DEF_PM()],
    ['KN','Saint Kitts and Nevis','+1','🇰🇳','Caribbean',        'XCD',  DEF_PM()],
    ['LC','Saint Lucia',     '+1',  '🇱🇨','Caribbean',           'XCD',  DEF_PM()],
    ['VC','Saint Vincent and the Grenadines','+1','🇻🇨','Caribbean','XCD',DEF_PM()],
    ['SR','Suriname',        '+597','🇸🇷','South America',       'SRD',  DEF_PM()],
    ['TT','Trinidad and Tobago','+1','🇹🇹','Caribbean',          'TTD',  DEF_PM()],
    ['US','United States',   '+1',  '🇺🇸','North America',       'USD',  [PM.bank(true),  PM.card()]],
    ['UY','Uruguay',         '+598','🇺🇾','South America',       'UYU',  DEF_PM()],
    ['VE','Venezuela',       '+58', '🇻🇪','South America',       'VES',  DEF_PM()],

    // ── Asia ─────────────────────────────────────────────────────────────────
    ['AF','Afghanistan',     '+93', '🇦🇫','Southern Asia',       'AFN',  DEF_PM()],
    ['AM','Armenia',         '+374','🇦🇲','Western Asia',        'AMD',  DEF_PM()],
    ['AZ','Azerbaijan',      '+994','🇦🇿','Western Asia',        'AZN',  DEF_PM()],
    ['BH','Bahrain',         '+973','🇧🇭','Western Asia',        'BHD',  DEF_PM()],
    ['BD','Bangladesh',      '+880','🇧🇩','Southern Asia',       'BDT',  [PM.bank(true),  PM.ussd()]],
    ['BT','Bhutan',          '+975','🇧🇹','Southern Asia',       'BTN',  DEF_PM()],
    ['BN','Brunei',          '+673','🇧🇳','South-Eastern Asia',  'BND',  DEF_PM()],
    ['KH','Cambodia',        '+855','🇰🇭','South-Eastern Asia',  'KHR',  DEF_PM()],
    ['CN','China',           '+86', '🇨🇳','Eastern Asia',        'CNY',  [PM.bank(true),  PM.card()]],
    ['CY','Cyprus',          '+357','🇨🇾','Western Asia',        'EUR', DEF_PM()],
    ['GE','Georgia',         '+995','🇬🇪','Western Asia',        'GEL',  DEF_PM()],
    ['IN','India',           '+91', '🇮🇳','Southern Asia',       'INR',  [PM.bank(true),  PM.card(),  PM.ussd()]],
    ['ID','Indonesia',       '+62', '🇮🇩','South-Eastern Asia',  'IDR',  [PM.bank(true),  PM.card()]],
    ['IR','Iran',            '+98', '🇮🇷','Southern Asia',       'IRR',  DEF_PM()],
    ['IQ','Iraq',            '+964','🇮🇶','Western Asia',        'IQD',  DEF_PM()],
    ['IL','Israel',          '+972','🇮🇱','Western Asia',        'ILS',  DEF_PM()],
    ['JP','Japan',           '+81', '🇯🇵','Eastern Asia',        'JPY',  [PM.bank(true),  PM.card()]],
    ['JO','Jordan',          '+962','🇯🇴','Western Asia',        'JOD',  DEF_PM()],
    ['KZ','Kazakhstan',      '+7',  '🇰🇿','Central Asia',        'KZT',  DEF_PM()],
    ['KW','Kuwait',          '+965','🇰🇼','Western Asia',        'KWD',  DEF_PM()],
    ['KG','Kyrgyzstan',      '+996','🇰🇬','Central Asia',        'KGS',  DEF_PM()],
    ['LA','Laos',            '+856','🇱🇦','South-Eastern Asia',  'LAK',  DEF_PM()],
    ['LB','Lebanon',         '+961','🇱🇧','Western Asia',        'LBP',  DEF_PM()],
    ['MY','Malaysia',        '+60', '🇲🇾','South-Eastern Asia',  'MYR',  [PM.bank(true),  PM.card()]],
    ['MV','Maldives',        '+960','🇲🇻','Southern Asia',       'MVR',  DEF_PM()],
    ['MN','Mongolia',        '+976','🇲🇳','Eastern Asia',        'MNT',  DEF_PM()],
    ['MM','Myanmar',         '+95', '🇲🇲','South-Eastern Asia',  'MMK',  DEF_PM()],
    ['NP','Nepal',           '+977','🇳🇵','Southern Asia',       'NPR',  DEF_PM()],
    ['KP','North Korea',     '+850','🇰🇵','Eastern Asia',        'KPW',  DEF_PM()],
    ['OM','Oman',            '+968','🇴🇲','Western Asia',        'OMR',  DEF_PM()],
    ['PK','Pakistan',        '+92', '🇵🇰','Southern Asia',       'PKR',  [PM.bank(true),  PM.ussd()]],
    ['PS','Palestine',       '+970','🇵🇸','Western Asia',        'ILS',  DEF_PM()],
    ['PH','Philippines',     '+63', '🇵🇭','South-Eastern Asia',  'PHP',  [PM.bank(true),  PM.card()]],
    ['QA','Qatar',           '+974','🇶🇦','Western Asia',        'QAR',  DEF_PM()],
    ['SA','Saudi Arabia',    '+966','🇸🇦','Western Asia',        'SAR',  [PM.bank(true),  PM.card()]],
    ['SG','Singapore',       '+65', '🇸🇬','South-Eastern Asia',  'SGD',  [PM.bank(true),  PM.card()]],
    ['KR','South Korea',     '+82', '🇰🇷','Eastern Asia',        'KRW',  [PM.bank(true),  PM.card()]],
    ['LK','Sri Lanka',       '+94', '🇱🇰','Southern Asia',       'LKR',  DEF_PM()],
    ['SY','Syria',           '+963','🇸🇾','Western Asia',        'SYP',  DEF_PM()],
    ['TW','Taiwan',          '+886','🇹🇼','Eastern Asia',        'TWD',  DEF_PM()],
    ['TJ','Tajikistan',      '+992','🇹🇯','Central Asia',        'TJS',  DEF_PM()],
    ['TH','Thailand',        '+66', '🇹🇭','South-Eastern Asia',  'THB',  [PM.bank(true),  PM.card()]],
    ['TL','Timor-Leste',     '+670','🇹🇱','South-Eastern Asia',  'USD',  DEF_PM()],
    ['TR','Turkey',          '+90', '🇹🇷','Western Asia',        'TRY',  [PM.bank(true),  PM.card()]],
    ['TM','Turkmenistan',    '+993','🇹🇲','Central Asia',        'TMT',  DEF_PM()],
    ['AE','United Arab Emirates','+971','🇦🇪','Western Asia',    'AED',  [PM.bank(true),  PM.card()]],
    ['UZ','Uzbekistan',      '+998','🇺🇿','Central Asia',        'UZS',  DEF_PM()],
    ['VN','Vietnam',         '+84', '🇻🇳','South-Eastern Asia',  'VND',  [PM.bank(true),  PM.card()]],
    ['YE','Yemen',           '+967','🇾🇪','Western Asia',        'YER',  DEF_PM()],

    // ── Europe ────────────────────────────────────────────────────────────────
    ['AL','Albania',         '+355','🇦🇱','Southern Europe',     'ALL', DEF_PM()],
    ['AD','Andorra',         '+376','🇦🇩','Southern Europe',     'EUR', DEF_PM()],
    ['AT','Austria',         '+43', '🇦🇹','Western Europe',      'EUR', DEF_PM()],
    ['BY','Belarus',         '+375','🇧🇾','Eastern Europe',      'BYN',  DEF_PM()],
    ['BE','Belgium',         '+32', '🇧🇪','Western Europe',      'EUR', DEF_PM()],
    ['BA','Bosnia and Herzegovina','+387','🇧🇦','Southern Europe','BAM', DEF_PM()],
    ['BG','Bulgaria',        '+359','🇧🇬','Eastern Europe',      'EUR', DEF_PM()],
    ['HR','Croatia',         '+385','🇭🇷','Southern Europe',     'EUR', DEF_PM()],
    ['CZ','Czech Republic',  '+420','🇨🇿','Eastern Europe',      'CZK',  DEF_PM()],
    ['DK','Denmark',         '+45', '🇩🇰','Northern Europe',     'DKK',  DEF_PM()],
    ['EE','Estonia',         '+372','🇪🇪','Northern Europe',     'EUR', DEF_PM()],
    ['FI','Finland',         '+358','🇫🇮','Northern Europe',     'EUR', DEF_PM()],
    ['FR','France',          '+33', '🇫🇷','Western Europe',      'EUR', DEF_PM()],
    ['DE','Germany',         '+49', '🇩🇪','Western Europe',      'EUR', DEF_PM()],
    ['GR','Greece',          '+30', '🇬🇷','Southern Europe',     'EUR', DEF_PM()],
    ['HU','Hungary',         '+36', '🇭🇺','Eastern Europe',      'HUF', DEF_PM()],
    ['IS','Iceland',         '+354','🇮🇸','Northern Europe',     'ISK',  DEF_PM()],
    ['IE','Ireland',         '+353','🇮🇪','Northern Europe',     'EUR', DEF_PM()],
    ['IT','Italy',           '+39', '🇮🇹','Southern Europe',     'EUR', DEF_PM()],
    ['XK','Kosovo',          '+383','🇽🇰','Southern Europe',     'EUR', DEF_PM()],
    ['LV','Latvia',          '+371','🇱🇻','Northern Europe',     'EUR', DEF_PM()],
    ['LI','Liechtenstein',   '+423','🇱🇮','Western Europe',      'CHF',  DEF_PM()],
    ['LT','Lithuania',       '+370','🇱🇹','Northern Europe',     'EUR', DEF_PM()],
    ['LU','Luxembourg',      '+352','🇱🇺','Western Europe',      'EUR', DEF_PM()],
    ['MT','Malta',           '+356','🇲🇹','Southern Europe',     'EUR', DEF_PM()],
    ['MD','Moldova',         '+373','🇲🇩','Eastern Europe',      'MDL',  DEF_PM()],
    ['MC','Monaco',          '+377','🇲🇨','Western Europe',      'EUR', DEF_PM()],
    ['ME','Montenegro',      '+382','🇲🇪','Southern Europe',     'EUR', DEF_PM()],
    ['NL','Netherlands',     '+31', '🇳🇱','Western Europe',      'EUR', DEF_PM()],
    ['MK','North Macedonia', '+389','🇲🇰','Southern Europe',     'MKD',  DEF_PM()],
    ['NO','Norway',          '+47', '🇳🇴','Northern Europe',     'NOK',  DEF_PM()],
    ['PL','Poland',          '+48', '🇵🇱','Eastern Europe',      'PLN',  DEF_PM()],
    ['PT','Portugal',        '+351','🇵🇹','Southern Europe',     'EUR', DEF_PM()],
    ['RO','Romania',         '+40', '🇷🇴','Eastern Europe',      'RON',  DEF_PM()],
    ['RU','Russia',          '+7',  '🇷🇺','Eastern Europe',      'RUB',  DEF_PM()],
    ['SM','San Marino',      '+378','🇸🇲','Southern Europe',     'EUR', DEF_PM()],
    ['RS','Serbia',          '+381','🇷🇸','Southern Europe',     'RSD',  DEF_PM()],
    ['SK','Slovakia',        '+421','🇸🇰','Eastern Europe',      'EUR', DEF_PM()],
    ['SI','Slovenia',        '+386','🇸🇮','Southern Europe',     'EUR', DEF_PM()],
    ['ES','Spain',           '+34', '🇪🇸','Southern Europe',     'EUR', DEF_PM()],
    ['SE','Sweden',          '+46', '🇸🇪','Northern Europe',     'SEK',  DEF_PM()],
    ['CH','Switzerland',     '+41', '🇨🇭','Western Europe',      'CHF',  DEF_PM()],
    ['UA','Ukraine',         '+380','🇺🇦','Eastern Europe',      'UAH',  DEF_PM()],
    ['GB','United Kingdom',  '+44', '🇬🇧','Northern Europe',     'GBP', [PM.bank(true),  PM.card()]],
    ['VA','Vatican City',    '+379','🇻🇦','Southern Europe',     'EUR', DEF_PM()],

    // ── Oceania ───────────────────────────────────────────────────────────────
    ['AU','Australia',       '+61', '🇦🇺','Australia and NZ',    'AUD',  [PM.bank(true),  PM.card()]],
    ['FJ','Fiji',            '+679','🇫🇯','Melanesia',           'FJD',  DEF_PM()],
    ['KI','Kiribati',        '+686','🇰🇮','Micronesia',          'AUD',  DEF_PM()],
    ['MH','Marshall Islands','+692','🇲🇭','Micronesia',          'USD',  DEF_PM()],
    ['FM','Micronesia',      '+691','🇫🇲','Micronesia',          'USD',  DEF_PM()],
    ['NR','Nauru',           '+674','🇳🇷','Micronesia',          'AUD',  DEF_PM()],
    ['NZ','New Zealand',     '+64', '🇳🇿','Australia and NZ',    'NZD',  DEF_PM()],
    ['PW','Palau',           '+680','🇵🇼','Micronesia',          'USD',  DEF_PM()],
    ['PG','Papua New Guinea','+675','🇵🇬','Melanesia',           'PGK',  DEF_PM()],
    ['WS','Samoa',           '+685','🇼🇸','Polynesia',           'WST',  DEF_PM()],
    ['SB','Solomon Islands', '+677','🇸🇧','Melanesia',           'SBD',  DEF_PM()],
    ['TO','Tonga',           '+676','🇹🇴','Polynesia',           'TOP',  DEF_PM()],
    ['TV','Tuvalu',          '+688','🇹🇻','Polynesia',           'AUD',  DEF_PM()],
    ['VU','Vanuatu',         '+678','🇻🇺','Melanesia',           'VUV',  DEF_PM()],
  ];

  return seeds
    .map(([id, name, dialCode, flagEmoji, region, primaryCurrId, paymentMethods]) => {
      const currencies: RefCurrency[] = [];

      if (primaryCurrId && CURRENCY_META[primaryCurrId]) {
        currencies.push(cur(primaryCurrId, true));
      }

      // Secondary currencies in common circulation (e.g. ZAR in the rand zone)
      for (const x of EXTRA_CURRENCIES[id] ?? []) {
        if (x !== primaryCurrId && CURRENCY_META[x]) currencies.push(cur(x));
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
// ?type=full                           → full country list (default)
// ?type=currencies                     → flat list of distinct schema-valid currencies
// ?type=stokvel-brands                 → all active brands from RefStokvelBrand
// ?type=stokvel-brands&countryId=ZW   → brands filtered by country
// ?countryId=ZW                        → single country record
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const type      = searchParams.get('type')      ?? 'full';
    const countryId = searchParams.get('countryId') ?? null;

    // ── Stokvel brands from DB ──────────────────────────────────
    // ?type=stokvel-brands              → all active brands
    // ?type=stokvel-brands&countryId=ZW → filtered by country
    if (type === 'stokvel-brands') {
      const where = countryId
        ? `WHERE "countryId" = $1 AND "isActive" = true ORDER BY "sortOrder" ASC`
        : `WHERE "isActive" = true ORDER BY "countryId", "sortOrder" ASC`;
      const brands = countryId
        ? await prisma.$queryRawUnsafe<any[]>(
            `SELECT id, "countryId", name, description, type, "sortOrder" FROM "RefStokvelBrand" ${where}`,
            countryId.toUpperCase()
          )
        : await prisma.$queryRawUnsafe<any[]>(
            `SELECT id, "countryId", name, description, type, "sortOrder" FROM "RefStokvelBrand" ${where}`
          );
      return ok(brands);
    }

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
