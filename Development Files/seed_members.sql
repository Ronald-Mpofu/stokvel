-- ============================================================
-- SEED: Fill each group to its maxMembers limit
-- Reads maxMembers dynamically from each Group record
-- Run in Supabase SQL Editor
-- ============================================================

DO $$
DECLARE
  grp         RECORD;
  g_count     INT := 0;
  needed      INT;
  existing    INT;
  pos         INT;
  uid         TEXT;
  first_names TEXT[] := ARRAY[
    -- Zimbabwean / Shona / Ndebele
    'Tendai','Chiedza','Farai','Rudo','Tinotenda','Tatenda','Nyasha','Takudzwa',
    'Simbarashe','Tsitsi','Rumbidzai','Munashe','Tapiwa','Chipo','Kudzai',
    'Tafadzwa','Mazvita','Fungai','Anesu','Tinashe','Vimbai','Thandeka',
    'Sibusiso','Zanele','Nompumelelo',
    -- South African
    'Sipho','Naledi','Thabo','Lindiwe','Bongani','Nomsa','Lerato','Tebogo',
    'Katlego','Ntombi','Lungelo','Zanele','Nkosi','Phumzile','Sfiso',
    -- East African / Kenyan
    'Amina','Kamau','Zawadi','Njeri','Otieno','Wanjiku','Mwangi','Akinyi',
    'Kipchoge','Wambua','Ouma','Adhiambo','Kimani','Muthoni','Onyango',
    -- Nigerian / West African
    'Chukwuemeka','Adaeze','Emeka','Ngozi','Chidi','Amaka','Eze','Ifunanya',
    'Obinna','Chioma','Uche','Adaora','Nnamdi','Blessing','Seun'
  ];
  last_names  TEXT[] := ARRAY[
    -- Zimbabwean surnames
    'Moyo','Nkosi','Dube','Mutasa','Banda','Chikwanda','Mhuru','Zvidzai',
    'Mapfumo','Chirwa','Mpofu','Ncube','Sibanda','Ndlovu','Mwale',
    -- South African surnames
    'Khumalo','Sithole','Zulu','Dlamini','Mthembu','Zwane','Mahlangu',
    'Nkosi','Shabalala','Buthelezi','Mkhize','Ntuli','Cele','Gumede',
    -- East African surnames
    'Wanjiru','Njoroge','Odhiambo','Muthoni','Onyango','Kamau','Mwangi',
    'Kiprotich','Ochieng','Wambua','Auma','Mutua','Gitau','Kariuki',
    -- Nigerian surnames
    'Okonkwo','Chukwu','Eze','Nwosu','Obi','Adeyemi','Okafor','Nzeh',
    'Okeke','Agu','Aneke','Obiora','Onuoha','Nwachukwu','Obiajulu'
  ];
  countries   TEXT[]   := ARRAY['Zimbabwe','South Africa','Kenya','Nigeria','Ghana','Zambia','Botswana'];
  currencies  TEXT[]   := ARRAY['USD','ZAR','KES','ZMW','BWP','ZWG','MWK','GBP','EUR'];
  cities      TEXT[]   := ARRAY[
    'Harare','Bulawayo','Mutare','Gweru','Kwekwe',
    'Johannesburg','Cape Town','Durban','Pretoria','Soweto',
    'Nairobi','Mombasa','Kisumu','Eldoret','Nakuru',
    'Lagos','Abuja','Kano','Port Harcourt','Ibadan',
    'Accra','Kumasi','Lusaka','Kitwe','Gaborone'
  ];
  tiers       TEXT[]   := ARRAY['BRONZE','BRONZE','SILVER','SILVER','GOLD','PLATINUM'];
  kyc_opts    TEXT[]   := ARRAY['VERIFIED','VERIFIED','VERIFIED','PENDING'];
  fn          TEXT;
  ln          TEXT;
  email_addr  TEXT;
  phone_num   TEXT;
  ctr         TEXT;
  cty         TEXT;
  cur         TEXT;
  tier_val    TEXT;
  kyc_val     TEXT;
  rep_score   DECIMAL;
  i           INT;

BEGIN

  -- Loop through all groups that have no members yet
  FOR grp IN
    SELECT g.id, g.name, g."maxMembers",
      (SELECT COUNT(*) FROM "GroupMember" gm WHERE gm."groupId" = g.id AND gm.status = 'ACTIVE') AS current_count
    FROM "Group" g
    WHERE g."deletedAt" IS NULL
    ORDER BY g."createdAt" ASC
  LOOP
    g_count  := g_count + 1;
    existing := grp.current_count;
    needed   := grp."maxMembers" - existing;

    RAISE NOTICE 'Group %: "%" — maxMembers=%, existing=%, adding=%',
      g_count, grp.name, grp."maxMembers", existing, needed;

    IF needed <= 0 THEN
      RAISE NOTICE '  → Already full, skipping';
      CONTINUE;
    END IF;

    pos := existing + 1;
    i   := 0;

    WHILE i < needed LOOP
      -- Pick random name components
      fn      := first_names[1 + floor(random() * array_length(first_names, 1))::int];
      ln      := last_names [1 + floor(random() * array_length(last_names,  1))::int];
      ctr     := countries  [1 + floor(random() * array_length(countries,   1))::int];
      cty     := cities     [1 + floor(random() * array_length(cities,      1))::int];
      cur     := currencies [1 + floor(random() * array_length(currencies,  1))::int];
      tier_val:= tiers      [1 + floor(random() * array_length(tiers,       1))::int];
      kyc_val := kyc_opts   [1 + floor(random() * array_length(kyc_opts,    1))::int];
      rep_score := 40 + floor(random() * 60)::int;

      -- Build unique email using group number + position
      email_addr := lower(fn) || '.' || lower(ln) || '.g' || g_count || 'p' || pos || '@windfall.dev';
      phone_num  := '+2637' || (70000000 + g_count * 10000 + pos)::text;

      uid := gen_random_uuid()::text;

      -- Insert User (skip if email clash)
      INSERT INTO "User" (
        id, email, phone, "passwordHash", "fullName",
        role, tier, "kycStatus", status, "reputationScore",
        "preferredCurrency", country, city,
        "referralCode", "createdAt", "updatedAt"
      ) VALUES (
        uid, email_addr, phone_num,
        '$2b$10$seededmemberhashplaceholderXXX',
        fn || ' ' || ln,
        'MEMBER', tier_val::"MemberTier", kyc_val::"KycStatus",
        'ACTIVE', rep_score,
        cur::"CurrencyCode", ctr, cty,
        gen_random_uuid()::text, NOW(), NOW()
      )
      ON CONFLICT (email) DO UPDATE SET id = "User".id
      RETURNING id INTO uid;

      -- Enrol into group
      INSERT INTO "GroupMember" (
        id, "groupId", "userId", role, status,
        "payoutPosition", "joinedAt", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, grp.id, uid,
        'MEMBER', 'ACTIVE', pos, NOW(), NOW(), NOW()
      )
      ON CONFLICT ("groupId", "userId") DO NOTHING;

      pos := pos + 1;
      i   := i + 1;
    END LOOP;

    RAISE NOTICE '  → Done. Group now has % members', pos - 1;
  END LOOP;

END $$;

-- ── Result summary ────────────────────────────────────────────
SELECT
  g.name                                                      AS "Group",
  g."maxMembers"                                              AS "Max",
  COUNT(gm.id)                                                AS "Members",
  g."maxMembers" - COUNT(gm.id)::int                         AS "Vacancies",
  CASE WHEN COUNT(gm.id) >= g."maxMembers" THEN '✅ Full' ELSE '⚠️ Not full' END AS "Status"
FROM "Group" g
LEFT JOIN "GroupMember" gm ON gm."groupId" = g.id AND gm.status = 'ACTIVE'
WHERE g."deletedAt" IS NULL
GROUP BY g.id, g.name, g."maxMembers"
ORDER BY g."createdAt";
