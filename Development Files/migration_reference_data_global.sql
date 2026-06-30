-- ============================================================
-- Windfall Community Deals — GLOBAL Reference Data Migration
-- Tables: RefCountry → RefCurrency → RefPaymentMethod → RefStokvelBrand
-- Full worldwide coverage — 195 countries
-- Run in Supabase SQL Editor
-- ============================================================

-- ── 1. REF COUNTRY ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RefCountry" (
  "id"          TEXT PRIMARY KEY,
  "iso3"        TEXT NOT NULL UNIQUE,
  "name"        TEXT NOT NULL,
  "dialCode"    TEXT NOT NULL,
  "region"      TEXT NOT NULL,
  "subRegion"   TEXT,
  "flagEmoji"   TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder"   INT NOT NULL DEFAULT 99,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. REF CURRENCY ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RefCurrency" (
  "id"            TEXT PRIMARY KEY,
  "countryId"     TEXT NOT NULL REFERENCES "RefCountry"("id") ON DELETE CASCADE,
  "name"          TEXT NOT NULL,
  "symbol"        TEXT NOT NULL,
  "isDefault"     BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive"      BOOLEAN NOT NULL DEFAULT TRUE,
  "decimalPlaces" INT NOT NULL DEFAULT 2,
  "sortOrder"     INT NOT NULL DEFAULT 99
);

-- ── 3. REF PAYMENT METHOD ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RefPaymentMethod" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "countryId"   TEXT NOT NULL REFERENCES "RefCountry"("id") ON DELETE CASCADE,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "category"    TEXT NOT NULL,
  "provider"    TEXT,
  "isDefault"   BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder"   INT NOT NULL DEFAULT 99,
  UNIQUE ("countryId", "code")
);

-- ── 4. REF STOKVEL BRAND ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RefStokvelBrand" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "countryId"     TEXT NOT NULL REFERENCES "RefCountry"("id") ON DELETE CASCADE,
  "name"          TEXT NOT NULL,
  "description"   TEXT,
  "type"          TEXT NOT NULL,
  "isActive"      BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder"     INT NOT NULL DEFAULT 99,
  UNIQUE ("countryId", "name")
);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_refcountry_region    ON "RefCountry"("region");
CREATE INDEX IF NOT EXISTS idx_refcurrency_country  ON "RefCurrency"("countryId");
CREATE INDEX IF NOT EXISTS idx_refpayment_country   ON "RefPaymentMethod"("countryId");
CREATE INDEX IF NOT EXISTS idx_refpayment_category  ON "RefPaymentMethod"("category");
CREATE INDEX IF NOT EXISTS idx_refstokvel_country   ON "RefStokvelBrand"("countryId");
CREATE INDEX IF NOT EXISTS idx_refstokvel_type      ON "RefStokvelBrand"("type");

-- ============================================================
-- SEED: COUNTRIES (195 sovereign states)
-- ============================================================
INSERT INTO "RefCountry" ("id","iso3","name","dialCode","region","subRegion","flagEmoji","sortOrder") VALUES

  -- ── AFRICA — SOUTHERN ────────────────────────────────────
  ('ZW','ZWE','Zimbabwe',            '+263','Africa','Southern Africa','🇿🇼',  1),
  ('ZA','ZAF','South Africa',        '+27', 'Africa','Southern Africa','🇿🇦',  2),
  ('ZM','ZMB','Zambia',              '+260','Africa','Southern Africa','🇿🇲',  3),
  ('MW','MWI','Malawi',              '+265','Africa','Southern Africa','🇲🇼',  4),
  ('BW','BWA','Botswana',            '+267','Africa','Southern Africa','🇧🇼',  5),
  ('MZ','MOZ','Mozambique',          '+258','Africa','Southern Africa','🇲🇿',  6),
  ('NA','NAM','Namibia',             '+264','Africa','Southern Africa','🇳🇦',  7),
  ('SZ','SWZ','Eswatini',            '+268','Africa','Southern Africa','🇸🇿',  8),
  ('LS','LSO','Lesotho',             '+266','Africa','Southern Africa','🇱🇸',  9),
  ('MG','MDG','Madagascar',          '+261','Africa','Southern Africa','🇲🇬', 10),
  ('MU','MUS','Mauritius',           '+230','Africa','Southern Africa','🇲🇺', 11),
  ('RE','REU','Réunion',             '+262','Africa','Southern Africa','🇷🇪', 12),

  -- ── AFRICA — EAST ────────────────────────────────────────
  ('KE','KEN','Kenya',               '+254','Africa','East Africa','🇰🇪', 20),
  ('TZ','TZA','Tanzania',            '+255','Africa','East Africa','🇹🇿', 21),
  ('UG','UGA','Uganda',              '+256','Africa','East Africa','🇺🇬', 22),
  ('ET','ETH','Ethiopia',            '+251','Africa','East Africa','🇪🇹', 23),
  ('RW','RWA','Rwanda',              '+250','Africa','East Africa','🇷🇼', 24),
  ('BI','BDI','Burundi',             '+257','Africa','East Africa','🇧🇮', 25),
  ('SO','SOM','Somalia',             '+252','Africa','East Africa','🇸🇴', 26),
  ('DJ','DJI','Djibouti',            '+253','Africa','East Africa','🇩🇯', 27),
  ('ER','ERI','Eritrea',             '+291','Africa','East Africa','🇪🇷', 28),
  ('SS','SSD','South Sudan',         '+211','Africa','East Africa','🇸🇸', 29),
  ('SD','SDN','Sudan',               '+249','Africa','East Africa','🇸🇩', 30),

  -- ── AFRICA — WEST ────────────────────────────────────────
  ('GH','GHA','Ghana',               '+233','Africa','West Africa','🇬🇭', 40),
  ('NG','NGA','Nigeria',             '+234','Africa','West Africa','🇳🇬', 41),
  ('SN','SEN','Senegal',             '+221','Africa','West Africa','🇸🇳', 42),
  ('CI','CIV','Côte d''Ivoire',      '+225','Africa','West Africa','🇨🇮', 43),
  ('ML','MLI','Mali',                '+223','Africa','West Africa','🇲🇱', 44),
  ('BF','BFA','Burkina Faso',        '+226','Africa','West Africa','🇧🇫', 45),
  ('GN','GIN','Guinea',              '+224','Africa','West Africa','🇬🇳', 46),
  ('BJ','BEN','Benin',               '+229','Africa','West Africa','🇧🇯', 47),
  ('NE','NER','Niger',               '+227','Africa','West Africa','🇳🇪', 48),
  ('TG','TGO','Togo',                '+228','Africa','West Africa','🇹🇬', 49),
  ('SL','SLE','Sierra Leone',        '+232','Africa','West Africa','🇸🇱', 50),
  ('LR','LBR','Liberia',             '+231','Africa','West Africa','🇱🇷', 51),
  ('MR','MRT','Mauritania',          '+222','Africa','West Africa','🇲🇷', 52),
  ('GM','GMB','Gambia',              '+220','Africa','West Africa','🇬🇲', 53),
  ('GW','GNB','Guinea-Bissau',       '+245','Africa','West Africa','🇬🇼', 54),
  ('CV','CPV','Cape Verde',          '+238','Africa','West Africa','🇨🇻', 55),
  ('ST','STP','São Tomé & Príncipe', '+239','Africa','West Africa','🇸🇹', 56),

  -- ── AFRICA — CENTRAL ─────────────────────────────────────
  ('CM','CMR','Cameroon',            '+237','Africa','Central Africa','🇨🇲', 60),
  ('AO','AGO','Angola',              '+244','Africa','Central Africa','🇦🇴', 61),
  ('CD','COD','DR Congo',            '+243','Africa','Central Africa','🇨🇩', 62),
  ('CG','COG','Republic of Congo',   '+242','Africa','Central Africa','🇨🇬', 63),
  ('CF','CAF','Central African Rep.','+236','Africa','Central Africa','🇨🇫', 64),
  ('TD','TCD','Chad',                '+235','Africa','Central Africa','🇹🇩', 65),
  ('GA','GAB','Gabon',               '+241','Africa','Central Africa','🇬🇦', 66),
  ('GQ','GNQ','Equatorial Guinea',   '+240','Africa','Central Africa','🇬🇶', 67),

  -- ── AFRICA — NORTH ───────────────────────────────────────
  ('EG','EGY','Egypt',               '+20', 'Africa','North Africa','🇪🇬', 70),
  ('MA','MAR','Morocco',             '+212','Africa','North Africa','🇲🇦', 71),
  ('DZ','DZA','Algeria',             '+213','Africa','North Africa','🇩🇿', 72),
  ('TN','TUN','Tunisia',             '+216','Africa','North Africa','🇹🇳', 73),
  ('LY','LBY','Libya',               '+218','Africa','North Africa','🇱🇾', 74),

  -- ── ASIA — SOUTH ─────────────────────────────────────────
  ('IN','IND','India',               '+91', 'Asia','South Asia','🇮🇳',100),
  ('PK','PAK','Pakistan',            '+92', 'Asia','South Asia','🇵🇰',101),
  ('BD','BGD','Bangladesh',          '+880','Asia','South Asia','🇧🇩',102),
  ('LK','LKA','Sri Lanka',           '+94', 'Asia','South Asia','🇱🇰',103),
  ('NP','NPL','Nepal',               '+977','Asia','South Asia','🇳🇵',104),
  ('AF','AFG','Afghanistan',         '+93', 'Asia','South Asia','🇦🇫',105),
  ('MV','MDV','Maldives',            '+960','Asia','South Asia','🇲🇻',106),
  ('BT','BTN','Bhutan',              '+975','Asia','South Asia','🇧🇹',107),

  -- ── ASIA — SOUTHEAST ─────────────────────────────────────
  ('PH','PHL','Philippines',         '+63', 'Asia','Southeast Asia','🇵🇭',110),
  ('ID','IDN','Indonesia',           '+62', 'Asia','Southeast Asia','🇮🇩',111),
  ('MY','MYS','Malaysia',            '+60', 'Asia','Southeast Asia','🇲🇾',112),
  ('TH','THA','Thailand',            '+66', 'Asia','Southeast Asia','🇹🇭',113),
  ('VN','VNM','Vietnam',             '+84', 'Asia','Southeast Asia','🇻🇳',114),
  ('MM','MMR','Myanmar',             '+95', 'Asia','Southeast Asia','🇲🇲',115),
  ('SG','SGP','Singapore',           '+65', 'Asia','Southeast Asia','🇸🇬',116),
  ('KH','KHM','Cambodia',            '+855','Asia','Southeast Asia','🇰🇭',117),
  ('LA','LAO','Laos',                '+856','Asia','Southeast Asia','🇱🇦',118),
  ('TL','TLS','Timor-Leste',         '+670','Asia','Southeast Asia','🇹🇱',119),
  ('BN','BRN','Brunei',              '+673','Asia','Southeast Asia','🇧🇳',120),

  -- ── ASIA — EAST ──────────────────────────────────────────
  ('CN','CHN','China',               '+86', 'Asia','East Asia','🇨🇳',130),
  ('JP','JPN','Japan',               '+81', 'Asia','East Asia','🇯🇵',131),
  ('KR','KOR','South Korea',         '+82', 'Asia','East Asia','🇰🇷',132),
  ('TW','TWN','Taiwan',              '+886','Asia','East Asia','🇹🇼',133),
  ('HK','HKG','Hong Kong',           '+852','Asia','East Asia','🇭🇰',134),
  ('MO','MAC','Macao',               '+853','Asia','East Asia','🇲🇴',135),
  ('MN','MNG','Mongolia',            '+976','Asia','East Asia','🇲🇳',136),
  ('KP','PRK','North Korea',         '+850','Asia','East Asia','🇰🇵',137),

  -- ── ASIA — CENTRAL ───────────────────────────────────────
  ('KZ','KAZ','Kazakhstan',          '+7',  'Asia','Central Asia','🇰🇿',140),
  ('UZ','UZB','Uzbekistan',          '+998','Asia','Central Asia','🇺🇿',141),
  ('TM','TKM','Turkmenistan',        '+993','Asia','Central Asia','🇹🇲',142),
  ('TJ','TJK','Tajikistan',          '+992','Asia','Central Asia','🇹🇯',143),
  ('KG','KGZ','Kyrgyzstan',          '+996','Asia','Central Asia','🇰🇬',144),

  -- ── ASIA — WEST / MIDDLE EAST ────────────────────────────
  ('SA','SAU','Saudi Arabia',        '+966','Asia','Western Asia','🇸🇦',150),
  ('AE','ARE','United Arab Emirates','+971','Asia','Western Asia','🇦🇪',151),
  ('TR','TUR','Turkey',              '+90', 'Asia','Western Asia','🇹🇷',152),
  ('IR','IRN','Iran',                '+98', 'Asia','Western Asia','🇮🇷',153),
  ('IQ','IRQ','Iraq',                '+964','Asia','Western Asia','🇮🇶',154),
  ('IL','ISR','Israel',              '+972','Asia','Western Asia','🇮🇱',155),
  ('JO','JOR','Jordan',              '+962','Asia','Western Asia','🇯🇴',156),
  ('LB','LBN','Lebanon',             '+961','Asia','Western Asia','🇱🇧',157),
  ('SY','SYR','Syria',               '+963','Asia','Western Asia','🇸🇾',158),
  ('YE','YEM','Yemen',               '+967','Asia','Western Asia','🇾🇪',159),
  ('OM','OMN','Oman',                '+968','Asia','Western Asia','🇴🇲',160),
  ('KW','KWT','Kuwait',              '+965','Asia','Western Asia','🇰🇼',161),
  ('QA','QAT','Qatar',               '+974','Asia','Western Asia','🇶🇦',162),
  ('BH','BHR','Bahrain',             '+973','Asia','Western Asia','🇧🇭',163),
  ('AM','ARM','Armenia',             '+374','Asia','Western Asia','🇦🇲',164),
  ('AZ','AZE','Azerbaijan',          '+994','Asia','Western Asia','🇦🇿',165),
  ('GE','GEO','Georgia',             '+995','Asia','Western Asia','🇬🇪',166),
  ('PS','PSE','Palestine',           '+970','Asia','Western Asia','🇵🇸',167),

  -- ── EUROPE — WESTERN ─────────────────────────────────────
  ('GB','GBR','United Kingdom',      '+44', 'Europe','Western Europe','🇬🇧',200),
  ('DE','DEU','Germany',             '+49', 'Europe','Western Europe','🇩🇪',201),
  ('FR','FRA','France',              '+33', 'Europe','Western Europe','🇫🇷',202),
  ('IT','ITA','Italy',               '+39', 'Europe','Western Europe','🇮🇹',203),
  ('ES','ESP','Spain',               '+34', 'Europe','Western Europe','🇪🇸',204),
  ('NL','NLD','Netherlands',         '+31', 'Europe','Western Europe','🇳🇱',205),
  ('BE','BEL','Belgium',             '+32', 'Europe','Western Europe','🇧🇪',206),
  ('PT','PRT','Portugal',            '+351','Europe','Western Europe','🇵🇹',207),
  ('CH','CHE','Switzerland',         '+41', 'Europe','Western Europe','🇨🇭',208),
  ('AT','AUT','Austria',             '+43', 'Europe','Western Europe','🇦🇹',209),
  ('IE','IRL','Ireland',             '+353','Europe','Western Europe','🇮🇪',210),
  ('LU','LUX','Luxembourg',          '+352','Europe','Western Europe','🇱🇺',211),
  ('MC','MCO','Monaco',              '+377','Europe','Western Europe','🇲🇨',212),
  ('LI','LIE','Liechtenstein',       '+423','Europe','Western Europe','🇱🇮',213),
  ('AD','AND','Andorra',             '+376','Europe','Western Europe','🇦🇩',214),

  -- ── EUROPE — NORTHERN ────────────────────────────────────
  ('SE','SWE','Sweden',              '+46', 'Europe','Northern Europe','🇸🇪',220),
  ('NO','NOR','Norway',              '+47', 'Europe','Northern Europe','🇳🇴',221),
  ('DK','DNK','Denmark',             '+45', 'Europe','Northern Europe','🇩🇰',222),
  ('FI','FIN','Finland',             '+358','Europe','Northern Europe','🇫🇮',223),
  ('IS','ISL','Iceland',             '+354','Europe','Northern Europe','🇮🇸',224),
  ('EE','EST','Estonia',             '+372','Europe','Northern Europe','🇪🇪',225),
  ('LV','LVA','Latvia',              '+371','Europe','Northern Europe','🇱🇻',226),
  ('LT','LTU','Lithuania',           '+370','Europe','Northern Europe','🇱🇹',227),

  -- ── EUROPE — EASTERN ─────────────────────────────────────
  ('PL','POL','Poland',              '+48', 'Europe','Eastern Europe','🇵🇱',230),
  ('CZ','CZE','Czech Republic',      '+420','Europe','Eastern Europe','🇨🇿',231),
  ('SK','SVK','Slovakia',            '+421','Europe','Eastern Europe','🇸🇰',232),
  ('HU','HUN','Hungary',             '+36', 'Europe','Eastern Europe','🇭🇺',233),
  ('RO','ROU','Romania',             '+40', 'Europe','Eastern Europe','🇷🇴',234),
  ('BG','BGR','Bulgaria',            '+359','Europe','Eastern Europe','🇧🇬',235),
  ('UA','UKR','Ukraine',             '+380','Europe','Eastern Europe','🇺🇦',236),
  ('BY','BLR','Belarus',             '+375','Europe','Eastern Europe','🇧🇾',237),
  ('MD','MDA','Moldova',             '+373','Europe','Eastern Europe','🇲🇩',238),
  ('RU','RUS','Russia',              '+7',  'Europe','Eastern Europe','🇷🇺',239),

  -- ── EUROPE — SOUTHERN ────────────────────────────────────
  ('GR','GRC','Greece',              '+30', 'Europe','Southern Europe','🇬🇷',240),
  ('HR','HRV','Croatia',             '+385','Europe','Southern Europe','🇭🇷',241),
  ('SI','SVN','Slovenia',            '+386','Europe','Southern Europe','🇸🇮',242),
  ('RS','SRB','Serbia',              '+381','Europe','Southern Europe','🇷🇸',243),
  ('BA','BIH','Bosnia & Herzegovina','+387','Europe','Southern Europe','🇧🇦',244),
  ('ME','MNE','Montenegro',          '+382','Europe','Southern Europe','🇲🇪',245),
  ('MK','MKD','North Macedonia',     '+389','Europe','Southern Europe','🇲🇰',246),
  ('AL','ALB','Albania',             '+355','Europe','Southern Europe','🇦🇱',247),
  ('XK','XKX','Kosovo',              '+383','Europe','Southern Europe','🇽🇰',248),
  ('CY','CYP','Cyprus',              '+357','Europe','Southern Europe','🇨🇾',249),
  ('MT','MLT','Malta',               '+356','Europe','Southern Europe','🇲🇹',250),
  ('SM','SMR','San Marino',          '+378','Europe','Southern Europe','🇸🇲',251),
  ('VA','VAT','Vatican City',        '+39', 'Europe','Southern Europe','🇻🇦',252),

  -- ── AMERICAS — NORTH ─────────────────────────────────────
  ('US','USA','United States',       '+1',  'Americas','North America','🇺🇸',300),
  ('CA','CAN','Canada',              '+1',  'Americas','North America','🇨🇦',301),
  ('MX','MEX','Mexico',              '+52', 'Americas','North America','🇲🇽',302),

  -- ── AMERICAS — CARIBBEAN ─────────────────────────────────
  ('JM','JAM','Jamaica',             '+1876','Americas','Caribbean','🇯🇲',310),
  ('TT','TTO','Trinidad & Tobago',   '+1868','Americas','Caribbean','🇹🇹',311),
  ('BB','BRB','Barbados',            '+1246','Americas','Caribbean','🇧🇧',312),
  ('GD','GRD','Grenada',             '+1473','Americas','Caribbean','🇬🇩',313),
  ('LC','LCA','Saint Lucia',         '+1758','Americas','Caribbean','🇱🇨',314),
  ('VC','VCT','St Vincent & Grenadines','+1784','Americas','Caribbean','🇻🇨',315),
  ('AG','ATG','Antigua & Barbuda',   '+1268','Americas','Caribbean','🇦🇬',316),
  ('DM','DMA','Dominica',            '+1767','Americas','Caribbean','🇩🇲',317),
  ('KN','KNA','Saint Kitts & Nevis', '+1869','Americas','Caribbean','🇰🇳',318),
  ('HT','HTI','Haiti',               '+509','Americas','Caribbean','🇭🇹',319),
  ('DO','DOM','Dominican Republic',  '+1809','Americas','Caribbean','🇩🇴',320),
  ('CU','CUB','Cuba',                '+53', 'Americas','Caribbean','🇨🇺',321),
  ('BS','BHS','Bahamas',             '+1242','Americas','Caribbean','🇧🇸',322),
  ('TC','TCA','Turks & Caicos',      '+1649','Americas','Caribbean','🇹🇨',323),

  -- ── AMERICAS — CENTRAL ───────────────────────────────────
  ('GT','GTM','Guatemala',           '+502','Americas','Central America','🇬🇹',330),
  ('BZ','BLZ','Belize',              '+501','Americas','Central America','🇧🇿',331),
  ('HN','HND','Honduras',            '+504','Americas','Central America','🇭🇳',332),
  ('SV','SLV','El Salvador',         '+503','Americas','Central America','🇸🇻',333),
  ('NI','NIC','Nicaragua',           '+505','Americas','Central America','🇳🇮',334),
  ('CR','CRI','Costa Rica',          '+506','Americas','Central America','🇨🇷',335),
  ('PA','PAN','Panama',              '+507','Americas','Central America','🇵🇦',336),

  -- ── AMERICAS — SOUTH ─────────────────────────────────────
  ('BR','BRA','Brazil',              '+55', 'Americas','South America','🇧🇷',340),
  ('AR','ARG','Argentina',           '+54', 'Americas','South America','🇦🇷',341),
  ('CO','COL','Colombia',            '+57', 'Americas','South America','🇨🇴',342),
  ('CL','CHL','Chile',               '+56', 'Americas','South America','🇨🇱',343),
  ('PE','PER','Peru',                '+51', 'Americas','South America','🇵🇪',344),
  ('VE','VEN','Venezuela',           '+58', 'Americas','South America','🇻🇪',345),
  ('EC','ECU','Ecuador',             '+593','Americas','South America','🇪🇨',346),
  ('BO','BOL','Bolivia',             '+591','Americas','South America','🇧🇴',347),
  ('PY','PRY','Paraguay',            '+595','Americas','South America','🇵🇾',348),
  ('UY','URY','Uruguay',             '+598','Americas','South America','🇺🇾',349),
  ('GY','GUY','Guyana',              '+592','Americas','South America','🇬🇾',350),
  ('SR','SUR','Suriname',            '+597','Americas','South America','🇸🇷',351),

  -- ── OCEANIA ──────────────────────────────────────────────
  ('AU','AUS','Australia',           '+61', 'Oceania','Australasia','🇦🇺',400),
  ('NZ','NZL','New Zealand',         '+64', 'Oceania','Australasia','🇳🇿',401),
  ('PG','PNG','Papua New Guinea',    '+675','Oceania','Melanesia','🇵🇬',  402),
  ('FJ','FJI','Fiji',                '+679','Oceania','Melanesia','🇫🇯',  403),
  ('SB','SLB','Solomon Islands',     '+677','Oceania','Melanesia','🇸🇧',  404),
  ('VU','VUT','Vanuatu',             '+678','Oceania','Melanesia','🇻🇺',  405),
  ('WS','WSM','Samoa',               '+685','Oceania','Polynesia','🇼🇸',  406),
  ('TO','TON','Tonga',               '+676','Oceania','Polynesia','🇹🇴',  407),
  ('KI','KIR','Kiribati',            '+686','Oceania','Micronesia','🇰🇮', 408),
  ('FM','FSM','Micronesia',          '+691','Oceania','Micronesia','🇫🇲', 409),
  ('PW','PLW','Palau',               '+680','Oceania','Micronesia','🇵🇼', 410),
  ('MH','MHL','Marshall Islands',    '+692','Oceania','Micronesia','🇲🇭', 411),
  ('NR','NRU','Nauru',               '+674','Oceania','Micronesia','🇳🇷', 412),
  ('TV','TUV','Tuvalu',              '+688','Oceania','Polynesia','🇹🇻',  413)

ON CONFLICT ("id") DO NOTHING;


-- ============================================================
-- SEED: CURRENCIES (primary currency per country)
-- ============================================================
INSERT INTO "RefCurrency" ("id","countryId","name","symbol","isDefault","sortOrder") VALUES

  -- Africa — Southern
  ('ZWG','ZW','Zimbabwe Gold (ZiG)',       'ZiG', TRUE,  1),
  ('USD_ZW','ZW','US Dollar',              '$',   FALSE, 2),
  ('ZAR_ZW','ZW','South African Rand',     'R',   FALSE, 3),
  ('ZAR','ZA','South African Rand',        'R',   TRUE,  1),
  ('ZMW','ZM','Zambian Kwacha',            'ZK',  TRUE,  1),
  ('MWK','MW','Malawian Kwacha',           'MK',  TRUE,  1),
  ('BWP','BW','Botswana Pula',             'P',   TRUE,  1),
  ('MZN','MZ','Mozambican Metical',        'MT',  TRUE,  1),
  ('NAD','NA','Namibian Dollar',           'N$',  TRUE,  1),
  ('SZL','SZ','Swazi Lilangeni',           'E',   TRUE,  1),
  ('LSL','LS','Lesotho Loti',              'M',   TRUE,  1),
  ('MGA','MG','Malagasy Ariary',           'Ar',  TRUE,  1),
  ('MUR','MU','Mauritian Rupee',           '₨',   TRUE,  1),

  -- Africa — East
  ('KES','KE','Kenyan Shilling',           'KSh', TRUE,  1),
  ('TZS','TZ','Tanzanian Shilling',        'TSh', TRUE,  1),
  ('UGX','UG','Ugandan Shilling',          'USh', TRUE,  1),
  ('ETB','ET','Ethiopian Birr',            'Br',  TRUE,  1),
  ('RWF','RW','Rwandan Franc',             'RF',  TRUE,  1),
  ('BIF','BI','Burundian Franc',           'Fr',  TRUE,  1),
  ('SOS','SO','Somali Shilling',           'Sh',  TRUE,  1),
  ('DJF','DJ','Djiboutian Franc',          'Fr',  TRUE,  1),
  ('ERN','ER','Eritrean Nakfa',            'Nfk', TRUE,  1),
  ('SSP','SS','South Sudanese Pound',      '£',   TRUE,  1),
  ('SDG','SD','Sudanese Pound',            'ج.س', TRUE,  1),

  -- Africa — West
  ('GHS','GH','Ghanaian Cedi',             '₵',   TRUE,  1),
  ('NGN','NG','Nigerian Naira',            '₦',   TRUE,  1),
  ('XOF_SN','SN','West African CFA Franc', 'CFA', TRUE,  1),
  ('XOF_CI','CI','West African CFA Franc', 'CFA', TRUE,  1),
  ('XOF_ML','ML','West African CFA Franc', 'CFA', TRUE,  1),
  ('XOF_BF','BF','West African CFA Franc', 'CFA', TRUE,  1),
  ('GNF','GN','Guinean Franc',             'Fr',  TRUE,  1),
  ('XOF_BJ','BJ','West African CFA Franc', 'CFA', TRUE,  1),
  ('XOF_NE','NE','West African CFA Franc', 'CFA', TRUE,  1),
  ('XOF_TG','TG','West African CFA Franc', 'CFA', TRUE,  1),
  ('SLL','SL','Sierra Leonean Leone',      'Le',  TRUE,  1),
  ('LRD','LR','Liberian Dollar',           '$',   TRUE,  1),
  ('MRU','MR','Mauritanian Ouguiya',       'UM',  TRUE,  1),
  ('GMD','GM','Gambian Dalasi',            'D',   TRUE,  1),
  ('XOF_GW','GW','West African CFA Franc', 'CFA', TRUE,  1),
  ('CVE','CV','Cape Verdean Escudo',       '$',   TRUE,  1),
  ('STN','ST','São Tomé Dobra',            'Db',  TRUE,  1),

  -- Africa — Central
  ('XAF_CM','CM','Central African CFA Franc','FCFA',TRUE, 1),
  ('AOA','AO','Angolan Kwanza',            'Kz',  TRUE,  1),
  ('CDF','CD','Congolese Franc',           'Fr',  TRUE,  1),
  ('XAF_CG','CG','Central African CFA Franc','FCFA',TRUE, 1),
  ('XAF_CF','CF','Central African CFA Franc','FCFA',TRUE, 1),
  ('XAF_TD','TD','Central African CFA Franc','FCFA',TRUE, 1),
  ('XAF_GA','GA','Central African CFA Franc','FCFA',TRUE, 1),
  ('XAF_GQ','GQ','Central African CFA Franc','FCFA',TRUE, 1),

  -- Africa — North
  ('EGP','EG','Egyptian Pound',            'E£',  TRUE,  1),
  ('MAD','MA','Moroccan Dirham',           'MAD', TRUE,  1),
  ('DZD','DZ','Algerian Dinar',            'DA',  TRUE,  1),
  ('TND','TN','Tunisian Dinar',            'DT',  TRUE,  1),
  ('LYD','LY','Libyan Dinar',              'LD',  TRUE,  1),

  -- Asia — South
  ('INR','IN','Indian Rupee',              '₹',   TRUE,  1),
  ('PKR','PK','Pakistani Rupee',           '₨',   TRUE,  1),
  ('BDT','BD','Bangladeshi Taka',          '৳',   TRUE,  1),
  ('LKR','LK','Sri Lankan Rupee',          'Rs',  TRUE,  1),
  ('NPR','NP','Nepalese Rupee',            'Rs',  TRUE,  1),
  ('AFN','AF','Afghan Afghani',            '؋',   TRUE,  1),
  ('MVR','MV','Maldivian Rufiyaa',         'Rf',  TRUE,  1),
  ('BTN','BT','Bhutanese Ngultrum',        'Nu',  TRUE,  1),

  -- Asia — Southeast
  ('PHP','PH','Philippine Peso',           '₱',   TRUE,  1),
  ('IDR','ID','Indonesian Rupiah',         'Rp',  TRUE,  1),
  ('MYR','MY','Malaysian Ringgit',         'RM',  TRUE,  1),
  ('THB','TH','Thai Baht',                 '฿',   TRUE,  1),
  ('VND','VN','Vietnamese Dong',           '₫',   TRUE,  1),
  ('MMK','MM','Myanmar Kyat',              'K',   TRUE,  1),
  ('SGD','SG','Singapore Dollar',          'S$',  TRUE,  1),
  ('KHR','KH','Cambodian Riel',            '៛',   TRUE,  1),
  ('LAK','LA','Lao Kip',                   '₭',   TRUE,  1),
  ('USD_TL','TL','US Dollar',              '$',   TRUE,  1),
  ('BND','BN','Brunei Dollar',             '$',   TRUE,  1),

  -- Asia — East
  ('CNY','CN','Chinese Yuan',              '¥',   TRUE,  1),
  ('JPY','JP','Japanese Yen',              '¥',   TRUE,  1),
  ('KRW','KR','South Korean Won',          '₩',   TRUE,  1),
  ('TWD','TW','New Taiwan Dollar',         'NT$', TRUE,  1),
  ('HKD','HK','Hong Kong Dollar',          'HK$', TRUE,  1),
  ('MOP','MO','Macanese Pataca',           'P',   TRUE,  1),
  ('MNT','MN','Mongolian Tögrög',          '₮',   TRUE,  1),

  -- Asia — Central
  ('KZT','KZ','Kazakhstani Tenge',         '₸',   TRUE,  1),
  ('UZS','UZ','Uzbekistani Som',           'so''m',TRUE, 1),
  ('TMT','TM','Turkmenistani Manat',       'T',   TRUE,  1),
  ('TJS','TJ','Tajikistani Somoni',        'SM',  TRUE,  1),
  ('KGS','KG','Kyrgyzstani Som',           'с',   TRUE,  1),

  -- Asia — West / Middle East
  ('SAR','SA','Saudi Riyal',               'SR',  TRUE,  1),
  ('AED','AE','UAE Dirham',                'د.إ', TRUE,  1),
  ('TRY','TR','Turkish Lira',              '₺',   TRUE,  1),
  ('IRR','IR','Iranian Rial',              '﷼',   TRUE,  1),
  ('IQD','IQ','Iraqi Dinar',               'ع.د', TRUE,  1),
  ('ILS','IL','Israeli New Shekel',        '₪',   TRUE,  1),
  ('JOD','JO','Jordanian Dinar',           'JD',  TRUE,  1),
  ('LBP','LB','Lebanese Pound',            'LL',  TRUE,  1),
  ('SYP','SY','Syrian Pound',              'LS',  TRUE,  1),
  ('YER','YE','Yemeni Rial',               '﷼',   TRUE,  1),
  ('OMR','OM','Omani Rial',                'RO',  TRUE,  1),
  ('KWD','KW','Kuwaiti Dinar',             'KD',  TRUE,  1),
  ('QAR','QA','Qatari Riyal',              'QR',  TRUE,  1),
  ('BHD','BH','Bahraini Dinar',            'BD',  TRUE,  1),
  ('AMD','AM','Armenian Dram',             '֏',   TRUE,  1),
  ('AZN','AZ','Azerbaijani Manat',         '₼',   TRUE,  1),
  ('GEL','GE','Georgian Lari',             '₾',   TRUE,  1),

  -- Europe — Western
  ('GBP','GB','British Pound',             '£',   TRUE,  1),
  ('EUR_DE','DE','Euro',                   '€',   TRUE,  1),
  ('EUR_FR','FR','Euro',                   '€',   TRUE,  1),
  ('EUR_IT','IT','Euro',                   '€',   TRUE,  1),
  ('EUR_ES','ES','Euro',                   '€',   TRUE,  1),
  ('EUR_NL','NL','Euro',                   '€',   TRUE,  1),
  ('EUR_BE','BE','Euro',                   '€',   TRUE,  1),
  ('EUR_PT','PT','Euro',                   '€',   TRUE,  1),
  ('CHF','CH','Swiss Franc',               'Fr',  TRUE,  1),
  ('EUR_AT','AT','Euro',                   '€',   TRUE,  1),
  ('EUR_IE','IE','Euro',                   '€',   TRUE,  1),
  ('EUR_LU','LU','Euro',                   '€',   TRUE,  1),

  -- Europe — Northern
  ('SEK','SE','Swedish Krona',             'kr',  TRUE,  1),
  ('NOK','NO','Norwegian Krone',           'kr',  TRUE,  1),
  ('DKK','DK','Danish Krone',              'kr',  TRUE,  1),
  ('EUR_FI','FI','Euro',                   '€',   TRUE,  1),
  ('ISK','IS','Icelandic Króna',           'kr',  TRUE,  1),
  ('EUR_EE','EE','Euro',                   '€',   TRUE,  1),
  ('EUR_LV','LV','Euro',                   '€',   TRUE,  1),
  ('EUR_LT','LT','Euro',                   '€',   TRUE,  1),

  -- Europe — Eastern
  ('PLN','PL','Polish Zloty',              'zł',  TRUE,  1),
  ('CZK','CZ','Czech Koruna',              'Kč',  TRUE,  1),
  ('EUR_SK','SK','Euro',                   '€',   TRUE,  1),
  ('HUF','HU','Hungarian Forint',          'Ft',  TRUE,  1),
  ('RON','RO','Romanian Leu',              'lei', TRUE,  1),
  ('BGN','BG','Bulgarian Lev',             'лв',  TRUE,  1),
  ('UAH','UA','Ukrainian Hryvnia',         '₴',   TRUE,  1),
  ('BYN','BY','Belarusian Ruble',          'Br',  TRUE,  1),
  ('MDL','MD','Moldovan Leu',              'L',   TRUE,  1),
  ('RUB','RU','Russian Ruble',             '₽',   TRUE,  1),

  -- Europe — Southern
  ('EUR_GR','GR','Euro',                   '€',   TRUE,  1),
  ('EUR_HR','HR','Euro',                   '€',   TRUE,  1),
  ('EUR_SI','SI','Euro',                   '€',   TRUE,  1),
  ('RSD','RS','Serbian Dinar',             'din', TRUE,  1),
  ('BAM','BA','Bosnia Mark',               'KM',  TRUE,  1),
  ('EUR_ME','ME','Euro',                   '€',   TRUE,  1),
  ('MKD','MK','Macedonian Denar',          'ден', TRUE,  1),
  ('ALL','AL','Albanian Lek',              'L',   TRUE,  1),
  ('EUR_CY','CY','Euro',                   '€',   TRUE,  1),
  ('EUR_MT','MT','Euro',                   '€',   TRUE,  1),

  -- Americas — North
  ('USD','US','US Dollar',                 '$',   TRUE,  1),
  ('CAD','CA','Canadian Dollar',           'C$',  TRUE,  1),
  ('MXN','MX','Mexican Peso',              '$',   TRUE,  1),

  -- Americas — Caribbean
  ('JMD','JM','Jamaican Dollar',           '$',   TRUE,  1),
  ('TTD','TT','Trinidad & Tobago Dollar',  '$',   TRUE,  1),
  ('BBD','BB','Barbadian Dollar',          '$',   TRUE,  1),
  ('XCD_GD','GD','East Caribbean Dollar',  '$',   TRUE,  1),
  ('XCD_LC','LC','East Caribbean Dollar',  '$',   TRUE,  1),
  ('XCD_VC','VC','East Caribbean Dollar',  '$',   TRUE,  1),
  ('XCD_AG','AG','East Caribbean Dollar',  '$',   TRUE,  1),
  ('XCD_DM','DM','East Caribbean Dollar',  '$',   TRUE,  1),
  ('XCD_KN','KN','East Caribbean Dollar',  '$',   TRUE,  1),
  ('HTG','HT','Haitian Gourde',            'G',   TRUE,  1),
  ('DOP','DO','Dominican Peso',            '$',   TRUE,  1),
  ('CUP','CU','Cuban Peso',               '$',   TRUE,  1),
  ('BSD','BS','Bahamian Dollar',           '$',   TRUE,  1),

  -- Americas — Central
  ('GTQ','GT','Guatemalan Quetzal',        'Q',   TRUE,  1),
  ('BZD','BZ','Belize Dollar',             '$',   TRUE,  1),
  ('HNL','HN','Honduran Lempira',          'L',   TRUE,  1),
  ('USD_SV','SV','US Dollar',              '$',   TRUE,  1),
  ('NIO','NI','Nicaraguan Córdoba',        'C$',  TRUE,  1),
  ('CRC','CR','Costa Rican Colón',         '₡',   TRUE,  1),
  ('PAB','PA','Panamanian Balboa',         'B/.',  TRUE,  1),

  -- Americas — South
  ('BRL','BR','Brazilian Real',            'R$',  TRUE,  1),
  ('ARS','AR','Argentine Peso',            '$',   TRUE,  1),
  ('COP','CO','Colombian Peso',            '$',   TRUE,  1),
  ('CLP','CL','Chilean Peso',              '$',   TRUE,  1),
  ('PEN','PE','Peruvian Sol',              'S/',  TRUE,  1),
  ('VES','VE','Venezuelan Bolívar',        'Bs',  TRUE,  1),
  ('USD_EC','EC','US Dollar',              '$',   TRUE,  1),
  ('BOB','BO','Bolivian Boliviano',        'Bs',  TRUE,  1),
  ('PYG','PY','Paraguayan Guaraní',        '₲',   TRUE,  1),
  ('UYU','UY','Uruguayan Peso',            '$',   TRUE,  1),
  ('GYD','GY','Guyanese Dollar',           '$',   TRUE,  1),
  ('SRD','SR','Surinamese Dollar',         '$',   TRUE,  1),

  -- Oceania
  ('AUD','AU','Australian Dollar',         'A$',  TRUE,  1),
  ('NZD','NZ','New Zealand Dollar',        'NZ$', TRUE,  1),
  ('PGK','PG','Papua New Guinean Kina',    'K',   TRUE,  1),
  ('FJD','FJ','Fijian Dollar',             '$',   TRUE,  1),
  ('SBD','SB','Solomon Islands Dollar',    '$',   TRUE,  1),
  ('VUV','VU','Vanuatu Vatu',              'Vt',  TRUE,  1),
  ('WST','WS','Samoan Tala',               'T',   TRUE,  1),
  ('TOP','TO','Tongan Paʻanga',            'T$',  TRUE,  1),
  ('USD_KI','KI','US Dollar',              '$',   TRUE,  1),
  ('USD_FM','FM','US Dollar',              '$',   TRUE,  1),
  ('USD_PW','PW','US Dollar',              '$',   TRUE,  1),
  ('USD_MH','MH','US Dollar',              '$',   TRUE,  1),
  ('AUD_NR','NR','Australian Dollar',      'A$',  TRUE,  1),
  ('AUD_TV','TV','Australian Dollar',      'A$',  TRUE,  1)

ON CONFLICT ("id") DO NOTHING;

-- ============================================================
-- SEED: PAYMENT METHODS
-- Shared universal methods seeded via a helper approach:
-- Every country gets: Cash (default), Bank Transfer, Credit Card, Debit Card
-- Then country-specific methods are added below.
-- ============================================================

-- Universal baseline for ALL countries
INSERT INTO "RefPaymentMethod" ("countryId","code","name","category","provider","isDefault","sortOrder")
SELECT c.id, 'CASH',         'Cash',          'CASH',          NULL, TRUE,  1 FROM "RefCountry" c WHERE c."isActive" = TRUE
ON CONFLICT ("countryId","code") DO NOTHING;

INSERT INTO "RefPaymentMethod" ("countryId","code","name","category","provider","isDefault","sortOrder")
SELECT c.id, 'BANK_TRANSFER','Bank Transfer', 'BANK_TRANSFER', NULL, FALSE, 2 FROM "RefCountry" c WHERE c."isActive" = TRUE
ON CONFLICT ("countryId","code") DO NOTHING;

INSERT INTO "RefPaymentMethod" ("countryId","code","name","category","provider","isDefault","sortOrder")
SELECT c.id, 'CREDIT_CARD',  'Credit Card',  'CARD',          NULL, FALSE, 3 FROM "RefCountry" c WHERE c."isActive" = TRUE
ON CONFLICT ("countryId","code") DO NOTHING;

INSERT INTO "RefPaymentMethod" ("countryId","code","name","category","provider","isDefault","sortOrder")
SELECT c.id, 'DEBIT_CARD',   'Debit Card',   'CARD',          NULL, FALSE, 4 FROM "RefCountry" c WHERE c."isActive" = TRUE
ON CONFLICT ("countryId","code") DO NOTHING;

-- Country-specific payment methods
INSERT INTO "RefPaymentMethod" ("countryId","code","name","category","provider","isDefault","sortOrder") VALUES

  -- ── AFRICA ───────────────────────────────────────────────
  ('ZW','ECOCASH',      'EcoCash',             'MOBILE_MONEY',   'Econet Wireless',     FALSE, 5),
  ('ZW','ONEMONEY',     'OneMoney',            'MOBILE_MONEY',   'NetOne',              FALSE, 6),
  ('ZW','TELECASH',     'TeleCash',            'MOBILE_MONEY',   'Telecel Zimbabwe',    FALSE, 7),
  ('ZW','MUKURUPAY',    'MukuruPay',           'DIGITAL_WALLET', 'Mukuru',              FALSE, 8),
  ('ZW','PAYPAL',       'PayPal',              'DIGITAL_WALLET', 'PayPal',              FALSE, 9),
  ('ZW','ZIPIT',        'ZIPIT',               'BANK_TRANSFER',  'Zimbabwe Banks',      FALSE,10),

  ('ZA','EFT',          'EFT / Instant EFT',   'BANK_TRANSFER',  NULL,                  FALSE, 5),
  ('ZA','SNAPSCAN',     'SnapScan',            'DIGITAL_WALLET', 'SnapScan',            FALSE, 6),
  ('ZA','ZAPPER',       'Zapper',              'DIGITAL_WALLET', 'Zapper',              FALSE, 7),
  ('ZA','OZOW',         'Ozow',                'DIGITAL_WALLET', 'Ozow',                FALSE, 8),
  ('ZA','PAYFAST',      'PayFast',             'DIGITAL_WALLET', 'PayFast',             FALSE, 9),
  ('ZA','MUKURUPAY',    'MukuruPay',           'DIGITAL_WALLET', 'Mukuru',              FALSE,10),
  ('ZA','CAPITEC_PAY',  'Capitec Pay',         'DIGITAL_WALLET', 'Capitec Bank',        FALSE,11),

  ('KE','MPESA',        'M-Pesa',              'MOBILE_MONEY',   'Safaricom',           FALSE, 5),
  ('KE','AIRTEL_MONEY', 'Airtel Money',        'MOBILE_MONEY',   'Airtel Kenya',        FALSE, 6),
  ('KE','TKASH',        'T-Kash',              'MOBILE_MONEY',   'Telkom Kenya',        FALSE, 7),
  ('KE','PESALINK',     'PesaLink',            'BANK_TRANSFER',  'IPSL Kenya',          FALSE, 8),
  ('KE','FLUTTERWAVE',  'Flutterwave',         'DIGITAL_WALLET', 'Flutterwave',         FALSE, 9),

  ('TZ','MPESA_TZ',     'M-Pesa',              'MOBILE_MONEY',   'Vodacom Tanzania',    FALSE, 5),
  ('TZ','AIRTEL_TZ',    'Airtel Money',        'MOBILE_MONEY',   'Airtel Tanzania',     FALSE, 6),
  ('TZ','TIGO_PESA',    'Tigo Pesa',           'MOBILE_MONEY',   'Tigo Tanzania',       FALSE, 7),
  ('TZ','HALOPESA',     'HaloPesa',            'MOBILE_MONEY',   'HALOTEL',             FALSE, 8),

  ('UG','MTN_MONEY',    'MTN Mobile Money',    'MOBILE_MONEY',   'MTN Uganda',          FALSE, 5),
  ('UG','AIRTEL_UG',    'Airtel Money',        'MOBILE_MONEY',   'Airtel Uganda',       FALSE, 6),

  ('ZM','MTN_ZM',       'MTN Mobile Money',    'MOBILE_MONEY',   'MTN Zambia',          FALSE, 5),
  ('ZM','AIRTEL_ZM',    'Airtel Money',        'MOBILE_MONEY',   'Airtel Zambia',       FALSE, 6),
  ('ZM','ZANACO',       'Zanaco Express',      'BANK_TRANSFER',  'Zanaco Bank',         FALSE, 7),

  ('MW','AIRTEL_MW',    'Airtel Money',        'MOBILE_MONEY',   'Airtel Malawi',       FALSE, 5),
  ('MW','TNM_MPAMBA',   'TNM Mpamba',          'MOBILE_MONEY',   'TNM Malawi',          FALSE, 6),

  ('BW','ORANGE_MONEY', 'Orange Money',        'MOBILE_MONEY',   'Orange Botswana',     FALSE, 5),
  ('BW','SMEGA',        'smega',               'MOBILE_MONEY',   'Mascom Wireless',     FALSE, 6),

  ('MZ','MPESA_MZ',     'M-Pesa',              'MOBILE_MONEY',   'Vodacom Mozambique',  FALSE, 5),
  ('MZ','EMOLA',        'e-Mola',              'MOBILE_MONEY',   'Movitel',             FALSE, 6),

  ('ET','TELEBIRR',     'Telebirr',            'MOBILE_MONEY',   'Ethio Telecom',       FALSE, 5),
  ('ET','CBE_BIRR',     'CBE Birr',            'MOBILE_MONEY',   'Commercial Bank Ethiopia',FALSE,6),

  ('RW','MTN_RW',       'MTN Mobile Money',    'MOBILE_MONEY',   'MTN Rwanda',          FALSE, 5),
  ('RW','AIRTEL_RW',    'Airtel Money',        'MOBILE_MONEY',   'Airtel Rwanda',       FALSE, 6),

  ('GH','MTN_GH',       'MTN MoMo',            'MOBILE_MONEY',   'MTN Ghana',           FALSE, 5),
  ('GH','VODAFONE_CASH','Vodafone Cash',        'MOBILE_MONEY',   'Vodafone Ghana',      FALSE, 6),
  ('GH','AIRTELTIGO',   'AirtelTigo Money',    'MOBILE_MONEY',   'AirtelTigo Ghana',    FALSE, 7),
  ('GH','PAYSTACK',     'Paystack',            'DIGITAL_WALLET', 'Paystack',            FALSE, 8),
  ('GH','FLUTTERWAVE',  'Flutterwave',         'DIGITAL_WALLET', 'Flutterwave',         FALSE, 9),

  ('NG','OPAY',         'OPay',                'MOBILE_MONEY',   'OPay Nigeria',        FALSE, 5),
  ('NG','PALMPAY',      'PalmPay',             'MOBILE_MONEY',   'PalmPay',             FALSE, 6),
  ('NG','KUDA',         'Kuda Bank',           'DIGITAL_WALLET', 'Kuda Bank',           FALSE, 7),
  ('NG','PAYSTACK',     'Paystack',            'DIGITAL_WALLET', 'Paystack',            FALSE, 8),
  ('NG','FLUTTERWAVE',  'Flutterwave',         'DIGITAL_WALLET', 'Flutterwave',         FALSE, 9),
  ('NG','MONIEPOINT',   'Moniepoint',          'DIGITAL_WALLET', 'Moniepoint',          FALSE,10),

  ('SN','ORANGE_MONEY_SN','Orange Money',      'MOBILE_MONEY',   'Orange Senegal',      FALSE, 5),
  ('SN','WAVE',         'Wave',                'MOBILE_MONEY',   'Wave',                FALSE, 6),
  ('SN','FREE_MONEY',   'Free Money',          'MOBILE_MONEY',   'Free Senegal',        FALSE, 7),

  ('CI','ORANGE_CI',    'Orange Money',        'MOBILE_MONEY',   'Orange CI',           FALSE, 5),
  ('CI','MTN_CI',       'MTN Mobile Money',    'MOBILE_MONEY',   'MTN CI',              FALSE, 6),
  ('CI','WAVE_CI',      'Wave',                'MOBILE_MONEY',   'Wave',                FALSE, 7),
  ('CI','MOOV_CI',      'Moov Money',          'MOBILE_MONEY',   'Moov Africa',         FALSE, 8),

  ('CM','MTN_CM',       'MTN Mobile Money',    'MOBILE_MONEY',   'MTN Cameroon',        FALSE, 5),
  ('CM','ORANGE_CM',    'Orange Money',        'MOBILE_MONEY',   'Orange Cameroon',     FALSE, 6),

  ('CD','MPESA_CD',     'M-Pesa',              'MOBILE_MONEY',   'Vodacom DRC',         FALSE, 5),
  ('CD','AIRTEL_CD',    'Airtel Money',        'MOBILE_MONEY',   'Airtel DRC',          FALSE, 6),
  ('CD','ORANGE_CD',    'Orange Money',        'MOBILE_MONEY',   'Orange DRC',          FALSE, 7),

  ('AO','MULTICAIXA',   'Multicaixa Express',  'MOBILE_MONEY',   'EMIS Angola',         FALSE, 5),

  ('EG','FAWRY',        'Fawry',               'DIGITAL_WALLET', 'Fawry',               FALSE, 5),
  ('EG','INSTAPAY',     'InstaPay',            'DIGITAL_WALLET', 'Egyptian Banks',      FALSE, 6),
  ('EG','VODAFONE_EG',  'Vodafone Cash',       'MOBILE_MONEY',   'Vodafone Egypt',      FALSE, 7),
  ('EG','ORANGE_EG',    'Orange Money',        'MOBILE_MONEY',   'Orange Egypt',        FALSE, 8),

  ('MA','CMI',          'CMI Pay',             'DIGITAL_WALLET', 'CMI Morocco',         FALSE, 5),
  ('MA','MAROC_TELECOM_MONEY','Maroc Telecom Money','MOBILE_MONEY','Maroc Telecom',     FALSE, 6),

  -- ── ASIA ─────────────────────────────────────────────────
  ('IN','UPI',          'UPI',                 'DIGITAL_WALLET', 'NPCI India',          FALSE, 5),
  ('IN','PAYTM',        'Paytm',               'DIGITAL_WALLET', 'Paytm',               FALSE, 6),
  ('IN','GPAY',         'Google Pay',          'DIGITAL_WALLET', 'Google',              FALSE, 7),
  ('IN','PHONEPE',      'PhonePe',             'DIGITAL_WALLET', 'PhonePe',             FALSE, 8),
  ('IN','NEFT',         'NEFT / RTGS',         'BANK_TRANSFER',  'RBI India',           FALSE, 9),

  ('PK','JAZZCASH',     'JazzCash',            'MOBILE_MONEY',   'Jazz Pakistan',       FALSE, 5),
  ('PK','EASYPAISA',    'Easypaisa',           'MOBILE_MONEY',   'Telenor Pakistan',    FALSE, 6),
  ('PK','NAYAPAY',      'NayaPay',             'DIGITAL_WALLET', 'NayaPay',             FALSE, 7),

  ('BD','BKASH',        'bKash',               'MOBILE_MONEY',   'bKash Ltd',           FALSE, 5),
  ('BD','NAGAD',        'Nagad',               'MOBILE_MONEY',   'Bangladesh Post Office',FALSE,6),
  ('BD','ROCKET',       'Rocket',              'MOBILE_MONEY',   'Dutch-Bangla Bank',   FALSE, 7),

  ('PH','GCASH',        'GCash',               'DIGITAL_WALLET', 'Globe Telecom',       FALSE, 5),
  ('PH','PAYMAYA',      'Maya',                'DIGITAL_WALLET', 'PayMaya Philippines', FALSE, 6),
  ('PH','INSTAPAY_PH',  'InstaPay',            'BANK_TRANSFER',  'BSP Philippines',     FALSE, 7),

  ('ID','GOPAY',        'GoPay',               'DIGITAL_WALLET', 'Gojek',               FALSE, 5),
  ('ID','OVO',          'OVO',                 'DIGITAL_WALLET', 'OVO',                 FALSE, 6),
  ('ID','DANA',         'DANA',                'DIGITAL_WALLET', 'DANA Indonesia',      FALSE, 7),
  ('ID','SHOPEEPAY',    'ShopeePay',           'DIGITAL_WALLET', 'Shopee',              FALSE, 8),
  ('ID','QRIS',         'QRIS',                'DIGITAL_WALLET', 'Bank Indonesia',      FALSE, 9),

  ('MY','GRABPAY',      'GrabPay',             'DIGITAL_WALLET', 'Grab',                FALSE, 5),
  ('MY','BOOST',        'Boost',               'DIGITAL_WALLET', 'Axiata',              FALSE, 6),
  ('MY','TOUCHNGO',     'Touch ''n Go eWallet','DIGITAL_WALLET', 'Touch ''n Go',        FALSE, 7),
  ('MY','DUITNOW',      'DuitNow',             'BANK_TRANSFER',  'Payments Network MY', FALSE, 8),

  ('TH','PROMPTPAY',    'PromptPay',           'DIGITAL_WALLET', 'Bank of Thailand',    FALSE, 5),
  ('TH','TRUEMONEY',    'TrueMoney Wallet',    'DIGITAL_WALLET', 'TrueMoney',           FALSE, 6),
  ('TH','RABBIT_LINE',  'Rabbit LINE Pay',     'DIGITAL_WALLET', 'LINE',                FALSE, 7),

  ('VN','MOMO',         'MoMo',                'DIGITAL_WALLET', 'MoMo Vietnam',        FALSE, 5),
  ('VN','ZALOPAY',      'ZaloPay',             'DIGITAL_WALLET', 'Zalo',                FALSE, 6),
  ('VN','VNPAY',        'VNPay',               'DIGITAL_WALLET', 'VNPay',               FALSE, 7),

  ('CN','WECHATPAY',    'WeChat Pay',          'DIGITAL_WALLET', 'Tencent',             FALSE, 5),
  ('CN','ALIPAY',       'Alipay',              'DIGITAL_WALLET', 'Alibaba Group',       FALSE, 6),
  ('CN','UNIONPAY',     'UnionPay',            'CARD',           'China UnionPay',      FALSE, 7),

  ('JP','PAYPAY',       'PayPay',              'DIGITAL_WALLET', 'PayPay Japan',        FALSE, 5),
  ('JP','LINE_PAY',     'LINE Pay',            'DIGITAL_WALLET', 'LINE',                FALSE, 6),
  ('JP','SUICA',        'Suica / IC Card',     'DIGITAL_WALLET', 'JR East',             FALSE, 7),
  ('JP','RAKUTEN_PAY',  'Rakuten Pay',         'DIGITAL_WALLET', 'Rakuten',             FALSE, 8),

  ('KR','KAKAOPAY',     'KakaoPay',            'DIGITAL_WALLET', 'Kakao',               FALSE, 5),
  ('KR','NAVERPAY',     'Naver Pay',           'DIGITAL_WALLET', 'Naver',               FALSE, 6),
  ('KR','TOSS',         'Toss',                'DIGITAL_WALLET', 'Viva Republica',      FALSE, 7),

  ('SG','PAYNOW',       'PayNow',              'BANK_TRANSFER',  'ABS Singapore',       FALSE, 5),
  ('SG','GRABPAY_SG',   'GrabPay',             'DIGITAL_WALLET', 'Grab',                FALSE, 6),
  ('SG','PAYLAH',       'PayLah!',             'DIGITAL_WALLET', 'DBS Bank',            FALSE, 7),

  ('AE','APPLE_PAY',    'Apple Pay',           'DIGITAL_WALLET', 'Apple',               FALSE, 5),
  ('AE','GOOGLE_PAY',   'Google Pay',          'DIGITAL_WALLET', 'Google',              FALSE, 6),
  ('AE','SAMSUNG_PAY',  'Samsung Pay',         'DIGITAL_WALLET', 'Samsung',             FALSE, 7),

  ('SA','STC_PAY',      'STC Pay',             'DIGITAL_WALLET', 'Saudi Telecom',       FALSE, 5),
  ('SA','MADA',         'mada',                'CARD',           'Saudi Payments',      FALSE, 6),
  ('SA','APPLE_PAY_SA', 'Apple Pay',           'DIGITAL_WALLET', 'Apple',               FALSE, 7),

  ('TR','PAPARA',       'Papara',              'DIGITAL_WALLET', 'Papara',              FALSE, 5),
  ('TR','PAYTR',        'PayTR',               'DIGITAL_WALLET', 'PayTR',               FALSE, 6),
  ('TR','HAVALE',       'Havale / EFT',        'BANK_TRANSFER',  NULL,                  FALSE, 7),

  -- ── EUROPE ───────────────────────────────────────────────
  ('GB','BACS',         'BACS / Faster Payments','BANK_TRANSFER','UK Banks',            FALSE, 5),
  ('GB','CHAPS',        'CHAPS',               'BANK_TRANSFER',  'Bank of England',     FALSE, 6),
  ('GB','PAYPAL_GB',    'PayPal',              'DIGITAL_WALLET', 'PayPal',              FALSE, 7),
  ('GB','APPLE_PAY_GB', 'Apple Pay',           'DIGITAL_WALLET', 'Apple',               FALSE, 8),
  ('GB','GOOGLE_PAY_GB','Google Pay',          'DIGITAL_WALLET', 'Google',              FALSE, 9),
  ('GB','WISE',         'Wise',                'DIGITAL_WALLET', 'Wise',                FALSE,10),

  ('DE','SEPA',         'SEPA Transfer',       'BANK_TRANSFER',  'European Banks',      FALSE, 5),
  ('DE','GIROPAY',      'giropay',             'BANK_TRANSFER',  NULL,                  FALSE, 6),
  ('DE','PAYPAL_DE',    'PayPal',              'DIGITAL_WALLET', 'PayPal',              FALSE, 7),
  ('DE','KLARNA',       'Klarna',              'DIGITAL_WALLET', 'Klarna',              FALSE, 8),

  ('FR','SEPA_FR',      'SEPA Transfer',       'BANK_TRANSFER',  'European Banks',      FALSE, 5),
  ('FR','PAYLIB',       'Paylib',              'DIGITAL_WALLET', 'Paylib France',       FALSE, 6),
  ('FR','LYDIA',        'Lydia',               'DIGITAL_WALLET', 'Lydia Solutions',     FALSE, 7),

  ('NL','IDEAL',        'iDEAL',               'BANK_TRANSFER',  'Currence Netherlands',FALSE, 5),
  ('NL','SEPA_NL',      'SEPA Transfer',       'BANK_TRANSFER',  NULL,                  FALSE, 6),

  ('BE','BANCONTACT',   'Bancontact',          'CARD',           'Bancontact',          FALSE, 5),
  ('BE','SEPA_BE',      'SEPA Transfer',       'BANK_TRANSFER',  NULL,                  FALSE, 6),

  ('SE','SWISH',        'Swish',               'DIGITAL_WALLET', 'Swedish Banks',       FALSE, 5),
  ('SE','KLARNA_SE',    'Klarna',              'DIGITAL_WALLET', 'Klarna',              FALSE, 6),

  ('NO','VIPPS',        'Vipps',               'DIGITAL_WALLET', 'DNB Norway',          FALSE, 5),
  ('NO','BANKID',       'BankID',              'BANK_TRANSFER',  NULL,                  FALSE, 6),

  ('DK','MOBILEPAY',    'MobilePay',           'DIGITAL_WALLET', 'Danske Bank',         FALSE, 5),

  ('FI','PIVO',         'Pivo',                'DIGITAL_WALLET', 'OP Group Finland',    FALSE, 5),
  ('FI','MOBILEPAY_FI', 'MobilePay',           'DIGITAL_WALLET', 'Danske Bank',         FALSE, 6),

  ('PL','BLIK',         'BLIK',                'DIGITAL_WALLET', 'Polski Standard Płatności',FALSE,5),
  ('PL','PRZELEWY24',   'Przelewy24',          'DIGITAL_WALLET', 'PayPro SA',           FALSE, 6),

  ('UA','MONOBANK',     'Monobank',            'DIGITAL_WALLET', 'Universal Bank',      FALSE, 5),
  ('UA','PRIVAT24',     'PrivatBank / Privat24','DIGITAL_WALLET','PrivatBank',          FALSE, 6),

  ('RU','SBERPAY',      'SberPay',             'DIGITAL_WALLET', 'Sberbank',            FALSE, 5),
  ('RU','YOOMONEY',     'YooMoney',            'DIGITAL_WALLET', 'Yandex',              FALSE, 6),
  ('RU','MIR',          'Mir Card',            'CARD',           'NSPK Russia',         FALSE, 7),

  -- ── AMERICAS ─────────────────────────────────────────────
  ('US','VENMO',        'Venmo',               'DIGITAL_WALLET', 'PayPal',              FALSE, 5),
  ('US','CASHAPP',      'Cash App',            'DIGITAL_WALLET', 'Block Inc',           FALSE, 6),
  ('US','ZELLE',        'Zelle',               'BANK_TRANSFER',  'Early Warning Services',FALSE,7),
  ('US','PAYPAL_US',    'PayPal',              'DIGITAL_WALLET', 'PayPal',              FALSE, 8),
  ('US','APPLE_PAY_US', 'Apple Pay',           'DIGITAL_WALLET', 'Apple',               FALSE, 9),
  ('US','GOOGLE_PAY_US','Google Pay',          'DIGITAL_WALLET', 'Google',              FALSE,10),
  ('US','ACH',          'ACH Transfer',        'BANK_TRANSFER',  'NACHA',               FALSE,11),

  ('CA','INTERAC',      'Interac e-Transfer',  'BANK_TRANSFER',  'Interac',             FALSE, 5),
  ('CA','PAYPAL_CA',    'PayPal',              'DIGITAL_WALLET', 'PayPal',              FALSE, 6),

  ('MX','SPEI',         'SPEI',                'BANK_TRANSFER',  'Banco de México',     FALSE, 5),
  ('MX','OXXO',         'OXXO Pay',            'CASH',           'OXXO',                FALSE, 6),
  ('MX','MERCADOPAGO',  'Mercado Pago',        'DIGITAL_WALLET', 'Mercado Libre',       FALSE, 7),

  ('BR','PIX',          'Pix',                 'BANK_TRANSFER',  'Banco Central do Brasil',FALSE,5),
  ('BR','BOLETO',       'Boleto Bancário',     'BANK_TRANSFER',  NULL,                  FALSE, 6),
  ('BR','MERCADOPAGO_BR','Mercado Pago',       'DIGITAL_WALLET', 'Mercado Libre',       FALSE, 7),
  ('BR','PICPAY',       'PicPay',              'DIGITAL_WALLET', 'PicPay',              FALSE, 8),

  ('AR','MERCADOPAGO_AR','Mercado Pago',       'DIGITAL_WALLET', 'Mercado Libre',       FALSE, 5),
  ('AR','TRANSFERENCIA','Bank Transfer (CVU)', 'BANK_TRANSFER',  NULL,                  FALSE, 6),
  ('AR','MODO',         'MODO',                'DIGITAL_WALLET', 'Argentine Banks',     FALSE, 7),

  ('CO','NEQUI',        'Nequi',               'DIGITAL_WALLET', 'Bancolombia',         FALSE, 5),
  ('CO','DAVIPLATA',    'Daviplata',           'DIGITAL_WALLET', 'Davivienda',          FALSE, 6),
  ('CO','PSE',          'PSE',                 'BANK_TRANSFER',  'ACH Colombia',        FALSE, 7),

  ('CL','WEBPAY',       'Webpay Plus',         'DIGITAL_WALLET', 'Transbank',           FALSE, 5),
  ('CL','KHIPU',        'Khipu',               'BANK_TRANSFER',  'Khipu',               FALSE, 6),
  ('CL','MERCADOPAGO_CL','Mercado Pago',       'DIGITAL_WALLET', 'Mercado Libre',       FALSE, 7),

  ('PE','YAPE',         'Yape',                'DIGITAL_WALLET', 'Banco de Crédito Perú',FALSE,5),
  ('PE','PLIN',         'Plin',                'DIGITAL_WALLET', 'Peruvian Banks',      FALSE, 6),

  ('JM','LYNK',         'Lynk',                'DIGITAL_WALLET', 'Lynk Jamaica',        FALSE, 5),
  ('JM','WIRETRANSFER', 'Wire Transfer',       'BANK_TRANSFER',  NULL,                  FALSE, 6),

  ('TT','LINX',         'Linx',                'CARD',           'Republic Bank TT',    FALSE, 5),

  -- ── OCEANIA ──────────────────────────────────────────────
  ('AU','PAYID',        'PayID / Osko',        'BANK_TRANSFER',  'Australian Banks',    FALSE, 5),
  ('AU','BPAY',         'BPAY',                'BANK_TRANSFER',  'BPAY Group',          FALSE, 6),
  ('AU','AFTERPAY',     'Afterpay',            'DIGITAL_WALLET', 'Afterpay',            FALSE, 7),
  ('AU','PAYPAL_AU',    'PayPal',              'DIGITAL_WALLET', 'PayPal',              FALSE, 8),

  ('NZ','PAYID_NZ',     'PayNow',              'BANK_TRANSFER',  'NZ Banks',            FALSE, 5),
  ('NZ','PAYPAL_NZ',    'PayPal',              'DIGITAL_WALLET', 'PayPal',              FALSE, 6),

  ('SG','PAYNOW_SG',    'PayNow',              'BANK_TRANSFER',  'ABS Singapore',       FALSE, 5),
  ('HK','FPS',          'FPS (Faster Payment System)','BANK_TRANSFER','HKMA',           FALSE, 5),
  ('HK','OCTOPUS',      'Octopus Card',        'DIGITAL_WALLET', 'Octopus Holdings',   FALSE, 6),
  ('HK','PAYME',        'PayMe',               'DIGITAL_WALLET', 'HSBC Hong Kong',      FALSE, 7)

ON CONFLICT ("countryId","code") DO NOTHING;

-- ============================================================
-- SEED: STOKVEL BRANDS / ROSCA EQUIVALENTS WORLDWIDE
-- ============================================================
INSERT INTO "RefStokvelBrand" ("countryId","name","description","type","sortOrder") VALUES

  -- ── AFRICA — SOUTHERN ────────────────────────────────────
  ('ZW','Mukando',     'Traditional rotating savings club; each member receives the pot in turns',                  'SAVINGS',  1),
  ('ZW','Chikando',    'Urban variant of Mukando',                                                                   'SAVINGS',  2),
  ('ZW','Ilimo',       'Community labour and resource-pooling tradition extended to financial savings',              'GENERAL',  3),
  ('ZW','Nhimbe',      'Communal gathering principle applied to savings groups',                                     'GENERAL',  4),
  ('ZW','Round',       'Informal term for the rotating pot among urban Zimbabweans',                                 'SAVINGS',  5),
  ('ZA','Stokvel',     'The iconic South African rotating savings and credit association',                           'SAVINGS',  1),
  ('ZA','Burial Society','Pooled contributions to cover funeral costs',                                              'GENERAL',  2),
  ('ZA','Grocery Stokvel','Group that pools money to buy bulk groceries, especially for year-end',                  'GROCERY',  3),
  ('ZA','Investment Stokvel','Members contribute to a shared investment portfolio',                                  'INVESTMENT',4),
  ('ZA','Umgalelo',    'Xhosa rotating savings club',                                                               'SAVINGS',  5),
  ('ZA','Mokotla',     'Savings group common among Sotho-speaking communities',                                      'SAVINGS',  6),
  ('ZM','Chilimba',    'Zambian rotating savings club; widely practised across all communities',                     'SAVINGS',  1),
  ('ZM','Katapila',    'Informal money-lending circle within a group',                                               'SAVINGS',  2),
  ('MW','Chiperegani', 'Malawian rotating savings club',                                                             'SAVINGS',  1),
  ('MW','Mchenga',     'Chichewa word for savings; name used for informal savings groups',                           'SAVINGS',  2),
  ('BW','Motshelo',    'Tswana rotating savings club; one of the most organised in Southern Africa',                 'SAVINGS',  1),
  ('MZ','Xitique',     'Mozambican rotating savings group; widely practised in the south',                           'SAVINGS',  1),
  ('NA','Oshikombo',   'Oshiwambo community savings and support circle',                                             'GENERAL',  1),
  ('SZ','Libutfo',     'Traditional Swati community cooperation extended to financial groups',                       'GENERAL',  1),
  ('LS','Chelete',     'Sotho word for money; used as the name for savings groups',                                  'SAVINGS',  1),

  -- ── AFRICA — EAST ────────────────────────────────────────
  ('KE','Chama',       'Swahili word for group; covers savings, investment and welfare groups',                      'GENERAL',  1),
  ('KE','Merry-Go-Round','Popular Kenyan rotating savings scheme where the pot rotates monthly',                    'SAVINGS',  2),
  ('KE','Harambee',    'Community self-help fundraising tradition; applied to savings groups',                       'GENERAL',  3),
  ('KE','SACCO',       'Savings and Credit Cooperative Organisation; regulated savings unions',                      'SAVINGS',  4),
  ('KE','Table Banking','Women-led savings groups where money is pooled and loaned at the table',                   'SAVINGS',  5),
  ('TZ','Upatu',       'Tanzanian rotating savings club meaning "round" or "turn"',                                  'SAVINGS',  1),
  ('TZ','VICOBA',      'Village Community Bank; formalised savings and loan group',                                  'SAVINGS',  2),
  ('TZ','VSLA',        'Village Savings and Loan Association',                                                       'SAVINGS',  3),
  ('UG','Kirimba',     'Ugandan rotating savings and credit association',                                            'SAVINGS',  1),
  ('UG','Tontine',     'French-origin rotating savings name adopted in Uganda',                                      'SAVINGS',  2),
  ('ET','Iqub',        'Ethiopian rotating savings and credit association; the most widespread ROSCA in Ethiopia',  'SAVINGS',  1),
  ('ET','Edir',        'Ethiopian community welfare group; covers funeral and bereavement costs',                    'GENERAL',  2),
  ('ET','Debo',        'Communal work circle; principle applied to savings groups',                                  'GENERAL',  3),
  ('RW','Ibimina',     'Kinyarwanda rotating savings group',                                                         'SAVINGS',  1),
  ('RW','Tontine',     'Rotating savings group widely practised in Rwanda',                                          'SAVINGS',  2),
  ('RW','Ubudehe',     'Community mutual support system; government-recognised savings tier',                        'GENERAL',  3),

  -- ── AFRICA — WEST ────────────────────────────────────────
  ('GH','Susu',        'Ghanaian informal savings scheme; the susu collector gathers daily contributions',          'SAVINGS',  1),
  ('GH','Nnoboa',      'Communal labour sharing tradition extended to savings and welfare groups',                   'GENERAL',  2),
  ('NG','Ajo',         'Yoruba rotating savings scheme managed by the Ajo collector',                               'SAVINGS',  1),
  ('NG','Esusu',       'Yoruba/Igbo savings club; one of the oldest rotating credit systems',                       'SAVINGS',  2),
  ('NG','Adashe',      'Hausa rotating savings club common in northern Nigeria',                                     'SAVINGS',  3),
  ('NG','Isusu',       'Igbo variant of the rotating credit association',                                            'SAVINGS',  4),
  ('SN','Tontine',     'Rotating savings club; the dominant informal savings vehicle in Senegal',                   'SAVINGS',  1),
  ('SN','Dahira',      'Islamic savings and welfare association tied to Sufi brotherhoods',                          'GENERAL',  2),
  ('CI','Tontine',     'Rotating savings club dominant across Côte d''Ivoire',                                      'SAVINGS',  1),
  ('CI','Likelemba',   'Central African rotating savings model adopted in urban CI communities',                     'SAVINGS',  2),
  ('ML','Tontine',     'Rotating savings group widely used across Mali',                                             'SAVINGS',  1),
  ('ML','Ton',         'Traditional Bambara cooperative work and savings group',                                     'GENERAL',  2),
  ('BF','Tontine',     'Rotating savings club widely used in Burkina Faso',                                          'SAVINGS',  1),

  -- ── AFRICA — CENTRAL ─────────────────────────────────────
  ('CM','Tontine',     'Rotating savings club; extremely popular across all communities in Cameroon',               'SAVINGS',  1),
  ('CM','Djangui',     'Cameroonian savings association with rotating payouts and social meetings',                  'SAVINGS',  2),
  ('CD','Likelemba',   'Rotating savings club very popular in DRC urban communities',                               'SAVINGS',  1),
  ('CG','Likelemba',   'Rotating savings club used in Republic of Congo',                                            'SAVINGS',  1),
  ('GA','Tontine',     'Rotating savings club used in Gabon',                                                        'SAVINGS',  1),
  ('AO','Kixikila',    'Angolan rotating savings association; culturally important',                                 'SAVINGS',  1),
  ('AO','Kilapi',      'Informal savings circle common in Luanda',                                                   'SAVINGS',  2),

  -- ── AFRICA — NORTH ───────────────────────────────────────
  ('EG','Gameya',      'Egyptian rotating savings association; extremely widespread',                               'SAVINGS',  1),
  ('EG','Sanduk',      'Savings box association used in Egypt and wider Arab world',                                 'SAVINGS',  2),
  ('MA','Daret',       'Moroccan rotating savings club; very common across all social classes',                      'SAVINGS',  1),
  ('DZ','Sanduk',      'Savings association used in Algeria',                                                        'SAVINGS',  1),
  ('TN','Sanduk',      'Savings association used in Tunisia',                                                        'SAVINGS',  1),

  -- ── ASIA — SOUTH ─────────────────────────────────────────
  ('IN','Chit Fund',   'Indian rotating savings and credit association; regulated under the Chit Funds Act',        'SAVINGS',  1),
  ('IN','Kitty Party', 'Indian social savings group; rotating pot among friends or neighbours',                     'SAVINGS',  2),
  ('IN','ROSCA',       'Rotating Savings and Credit Association (generic term used across India)',                   'SAVINGS',  3),
  ('PK','Committee',   'Pakistani rotating savings group; also called "committee system"',                          'SAVINGS',  1),
  ('PK','Bisi',        'Variant of the committee savings system in Pakistan',                                        'SAVINGS',  2),
  ('BD','Samity',      'Bangladeshi savings and welfare society; widespread in urban and rural areas',              'GENERAL',  1),
  ('BD','DPS',         'Deposit Pension Scheme; bank-organised recurring savings product',                           'SAVINGS',  2),
  ('LK','Seettu',      'Sri Lankan rotating savings and credit association',                                         'SAVINGS',  1),
  ('NP','Dhikuti',     'Nepalese rotating savings and credit association',                                           'SAVINGS',  1),

  -- ── ASIA — SOUTHEAST ─────────────────────────────────────
  ('PH','Paluwagan',   'Filipino rotating savings and credit association; very common nationwide',                  'SAVINGS',  1),
  ('ID','Arisan',      'Indonesian rotating savings and social gathering; a cultural institution',                  'SAVINGS',  1),
  ('MY','Kutu',        'Malaysian rotating savings club; also called "chit fund"',                                   'SAVINGS',  1),
  ('MY','Wang Kumpulan','Malay community savings group',                                                             'SAVINGS',  2),
  ('TH','Len Share',   'Thai savings group (เล่นแชร์); rotating pot savings circle',                               'SAVINGS',  1),
  ('VN','Ho',          'Vietnamese rotating savings and credit association (Họ)',                                    'SAVINGS',  1),
  ('VN','Hui',         'Vietnamese rotating savings circle (Hụi); regional variant of Họ',                          'SAVINGS',  2),
  ('MM','Asusu',       'Myanmar rotating savings club similar to Burmese "hsan"',                                   'SAVINGS',  1),
  ('MM','Hsan',        'Burmese traditional rotating savings and credit association',                                'SAVINGS',  2),
  ('KH','Tong Tin',    'Cambodian rotating savings group',                                                           'SAVINGS',  1),

  -- ── ASIA — EAST ──────────────────────────────────────────
  ('CN','Hui',         'Chinese rotating savings and credit association (會); thousands of years old',              'SAVINGS',  1),
  ('CN','Biaohui',     'Chinese auction-based rotating savings association',                                         'SAVINGS',  2),
  ('JP','Mujin / Ko',  'Japanese rotating savings and credit association (無尽/講)',                                 'SAVINGS',  1),
  ('KR','Gye',         'Korean rotating savings club (계); a national institution',                                  'SAVINGS',  1),
  ('TW','Biao Hui',    'Taiwanese rotating savings association',                                                     'SAVINGS',  1),

  -- ── ASIA — WEST / MIDDLE EAST ────────────────────────────
  ('SA','Jamiya',      'Saudi Arabian rotating savings group',                                                       'SAVINGS',  1),
  ('AE','Jamiya',      'UAE rotating savings group; common among expat and Emirati communities',                    'SAVINGS',  1),
  ('TR','Altın Günü',  'Turkish "gold day" savings group where gold coins are pooled and rotated',                  'SAVINGS',  1),
  ('IR','Sandogh',     'Iranian savings box association; community savings group',                                   'SAVINGS',  1),
  ('IQ','Sanduk',      'Iraqi savings association',                                                                  'SAVINGS',  1),
  ('JO','Jamiya',      'Jordanian rotating savings group; widely practised',                                         'SAVINGS',  1),
  ('LB','Jamiya',      'Lebanese rotating savings group',                                                            'SAVINGS',  1),

  -- ── EUROPE ───────────────────────────────────────────────
  ('GB','Pardner',     'Caribbean-origin rotating savings club widely practised in UK Black communities',           'SAVINGS',  1),
  ('GB','Susu',        'West African rotating savings club practised in UK diaspora communities',                   'SAVINGS',  2),
  ('GB','Burial Club', 'Historical British working-class mutual aid savings fund for funeral costs',                'GENERAL',  3),
  ('FR','Tontine',     'French-origin rotating savings and insurance group; gave its name to the global concept',  'SAVINGS',  1),
  ('PT','Tontina',     'Portuguese rotating savings group; practised in communities and diaspora',                  'SAVINGS',  1),
  ('ES','Tontina',     'Spanish rotating savings group',                                                             'SAVINGS',  1),
  ('DE','Spar-Club',   'German savings club; members pool contributions toward a shared goal',                       'SAVINGS',  1),
  ('IT','Tontina',     'Italian rotating savings group; still used in Southern Italy',                              'SAVINGS',  1),
  ('GR','Eranoi',      'Greek ancient mutual aid savings association; modern variant still used',                   'SAVINGS',  1),
  ('RO','Butuci',      'Romanian community savings circle',                                                          'SAVINGS',  1),
  ('UA','Kasa Vzaimodopomohy','Ukrainian mutual aid savings fund',                                                  'GENERAL',  1),
  ('PL','Kasa Zapomogowo-Pożyczkowa','Polish workers'' savings and loan fund (KZPF)',                              'SAVINGS',  1),
  ('RU','Kassa Vzaimopomoshchi','Russian mutual aid savings fund',                                                  'GENERAL',  1),

  -- ── AMERICAS ─────────────────────────────────────────────
  ('US','Susu',        'Caribbean-origin rotating savings club widely practised in US immigrant communities',       'SAVINGS',  1),
  ('US','Tandas',      'Mexican-origin rotating savings group widely used in US Latino communities',                'SAVINGS',  2),
  ('US','Hui',         'Chinese-origin rotating savings association used in US Asian communities',                  'SAVINGS',  3),
  ('US','Paluwagan',   'Filipino rotating savings club used in US Filipino communities',                            'SAVINGS',  4),
  ('MX','Tanda',       'Mexican rotating savings club; one of the most important informal financial tools',         'SAVINGS',  1),
  ('MX','Cundina',     'Regional variant of the tanda; popular in northern Mexico',                                 'SAVINGS',  2),
  ('GT','Cundina',     'Guatemalan rotating savings group',                                                          'SAVINGS',  1),
  ('SV','Convite',     'Salvadoran community savings and labour-sharing group',                                      'GENERAL',  1),
  ('HN','Convite',     'Honduran community savings group',                                                           'GENERAL',  1),
  ('NI','Convite',     'Nicaraguan community savings group',                                                         'GENERAL',  1),
  ('CR','Tanda',       'Costa Rican rotating savings group',                                                         'SAVINGS',  1),
  ('PA','Junta',       'Panamanian rotating savings group',                                                          'SAVINGS',  1),
  ('BR','Consórcio',   'Brazilian group purchasing savings plan; regulated by Central Bank',                        'SAVINGS',  1),
  ('BR','Vaquinha',    'Brazilian community crowdfunding and savings tradition',                                     'GENERAL',  2),
  ('AR','Tanda',       'Rotating savings club used in Argentina',                                                    'SAVINGS',  1),
  ('CO','Cadena',      'Colombian rotating savings group (chain); very common nationwide',                          'SAVINGS',  1),
  ('CL','Cuadro',      'Chilean savings group',                                                                      'SAVINGS',  1),
  ('PE','Junta',       'Peruvian rotating savings group; very widespread across all social classes',                'SAVINGS',  1),
  ('VE','San',         'Venezuelan rotating savings group',                                                          'SAVINGS',  1),
  ('EC','Polla',       'Ecuadorian rotating savings group',                                                          'SAVINGS',  1),
  ('BO','Pasanaku',    'Bolivian rotating savings and credit association',                                           'SAVINGS',  1),
  ('PY','Minga',       'Paraguayan community labour and savings cooperation tradition',                              'GENERAL',  1),
  ('UY','Tanda',       'Rotating savings group used in Uruguay',                                                     'SAVINGS',  1),
  ('JM','Partner',     'Jamaican rotating savings scheme; one of the Caribbean''s most important financial tools',  'SAVINGS',  1),
  ('JM','Box Hand',    'Jamaican variant of the rotating savings club',                                              'SAVINGS',  2),
  ('TT','Sou-Sou',     'Trinidad & Tobago rotating savings association; a national institution',                    'SAVINGS',  1),
  ('BB','Sou-Sou',     'Barbadian rotating savings group',                                                           'SAVINGS',  1),
  ('HT','Sol',         'Haitian rotating savings association (Sol/Asso)',                                            'SAVINGS',  1),
  ('DO','San',         'Dominican Republic rotating savings group',                                                  'SAVINGS',  1),
  ('GY','Box Money',   'Guyanese rotating savings group',                                                            'SAVINGS',  1),
  ('SR','Kasmoni',     'Surinamese rotating savings association',                                                    'SAVINGS',  1),

  -- ── OCEANIA ──────────────────────────────────────────────
  ('AU','Susu',        'Pacific Island and African diaspora rotating savings clubs common in Australia',            'SAVINGS',  1),
  ('AU','Koha',        'Maori/Pacific gifting and reciprocal savings tradition practised in Australia',             'GENERAL',  2),
  ('NZ','Koha',        'Maori reciprocal gifting and savings tradition',                                             'GENERAL',  1),
  ('NZ','Hui',         'Maori community gathering with pooled resources and savings element',                       'GENERAL',  2),
  ('FJ','Kerekere',    'Fijian community sharing and savings tradition',                                             'GENERAL',  1),
  ('PG','Wantok',      'Papua New Guinean community solidarity and savings network',                                 'GENERAL',  1),
  ('WS','Fa''alavelave','Samoan community obligation and savings pooling practice',                                  'GENERAL',  1),
  ('TO','Tontine',     'Rotating savings group used in Tonga',                                                       'SAVINGS',  1)

ON CONFLICT ("countryId","name") DO NOTHING;

-- ── CONFIRMATION ─────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM "RefCountry"       WHERE "isActive" = TRUE) AS countries,
  (SELECT COUNT(*) FROM "RefCurrency"      WHERE "isActive" = TRUE) AS currencies,
  (SELECT COUNT(*) FROM "RefPaymentMethod" WHERE "isActive" = TRUE) AS payment_methods,
  (SELECT COUNT(*) FROM "RefStokvelBrand"  WHERE "isActive" = TRUE) AS stokvel_brands;
