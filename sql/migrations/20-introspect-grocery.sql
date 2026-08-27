-- ============================================================
-- sql/20-introspect-grocery.sql
--
-- PURPOSE
--   The DDL migrations 14-19 that built the Grocery Club module are missing
--   from the working tree. This script does not guess at them: it reads the
--   LIVE database and prints the schema that is actually there, which is the
--   only authoritative source once the files are gone.
--
--   Output is ONE row, ONE column of text. Click the cell, copy the whole
--   thing, paste it back. Supabase's SQL Editor shows only the last
--   statement's result, which is why this is a single query rather than the
--   half-dozen it would naturally be.
--
-- SCOPE
--   Every table named Grocery*, plus "WindfallScheme" and "SchemeMember"
--   (raw-SQL tables that are not in schema.prisma either), plus every enum
--   type those tables actually use, plus constraints and indexes.
--
-- SAFETY
--   Pure SELECT against the catalogues. Reads no member data, writes
--   nothing, takes no locks. Safe to run against production.
--
-- HOW TO RUN
--   Supabase SQL Editor -> paste -> Run.
-- ============================================================

WITH target AS (
  -- The tables we care about, resolved to catalogue OIDs once.
  SELECT c.oid, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND (c.relname LIKE 'Grocery%'
          OR c.relname IN ('WindfallScheme', 'SchemeMember'))
),

-- ── Column lines, formatted as they would appear in a CREATE TABLE ────────
col_line AS (
  SELECT t.relname,
         a.attnum,
         '    ' || quote_ident(a.attname) || ' '
                || format_type(a.atttypid, a.atttypmod)
                || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
           AS line
    FROM target t
    JOIN pg_attribute a ON a.attrelid = t.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
   WHERE a.attnum > 0
     AND NOT a.attisdropped
),

-- ── Constraints: primary key, unique, foreign key, check ──────────────────
con_line AS (
  SELECT t.relname,
         '    ' || quote_ident(con.conname) || ': '
                || pg_get_constraintdef(con.oid) AS line,
         con.conname
    FROM target t
    JOIN pg_constraint con ON con.conrelid = t.oid
),

-- ── Indexes, excluding those a constraint already implies ─────────────────
idx_line AS (
  SELECT t.relname,
         '    ' || pg_get_indexdef(i.indexrelid) AS line,
         ic.relname AS idxname
    FROM target t
    JOIN pg_index i  ON i.indrelid = t.oid
    JOIN pg_class ic ON ic.oid = i.indexrelid
   WHERE NOT i.indisprimary
     AND NOT EXISTS (
           SELECT 1 FROM pg_constraint pc
            WHERE pc.conindid = i.indexrelid
       )
),

-- ── Enum types reachable from any column of a target table ────────────────
enum_block AS (
  SELECT tp.typname,
         'CREATE TYPE ' || quote_ident(tp.typname) || ' AS ENUM ('
           || string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)
           || ');' AS line
    FROM pg_type tp
    JOIN pg_enum e ON e.enumtypid = tp.oid
   WHERE tp.oid IN (
           SELECT DISTINCT
                  CASE WHEN bt.typtype = 'e' THEN bt.oid ELSE a.atttypid END
             FROM target t
             JOIN pg_attribute a ON a.attrelid = t.oid
             LEFT JOIN pg_type at ON at.oid = a.atttypid
             LEFT JOIN pg_type bt ON bt.oid = at.typelem
            WHERE a.attnum > 0
              AND NOT a.attisdropped
              AND (at.typtype = 'e' OR bt.typtype = 'e')
         )
   GROUP BY tp.typname
),

-- ── One text block per table, assembled from the parts above ──────────────
table_block AS (
  SELECT t.relname,
         'TABLE "' || t.relname || '"' || E'\n'
           || '  COLUMNS' || E'\n'
           || COALESCE(
                (SELECT string_agg(cl.line, E'\n' ORDER BY cl.attnum)
                   FROM col_line cl WHERE cl.relname = t.relname),
                '    (none)')
           || COALESCE(E'\n' || '  CONSTRAINTS' || E'\n'
                || (SELECT string_agg(cn.line, E'\n' ORDER BY cn.conname)
                      FROM con_line cn WHERE cn.relname = t.relname), '')
           || COALESCE(E'\n' || '  INDEXES' || E'\n'
                || (SELECT string_agg(ix.line, E'\n' ORDER BY ix.idxname)
                      FROM idx_line ix WHERE ix.relname = t.relname), '')
           AS line
    FROM target t
),

-- ── Section assembly. ord keeps enums ahead of tables. ────────────────────
section AS (
  SELECT 1 AS ord, 'ENUM TYPES' AS heading,
         COALESCE((SELECT string_agg(eb.line, E'\n' ORDER BY eb.typname)
                     FROM enum_block eb), '(none found)') AS body
  UNION ALL
  SELECT 2, 'TABLES',
         COALESCE((SELECT string_agg(tb.line, E'\n\n' ORDER BY tb.relname)
                     FROM table_block tb), '(none found)')
  UNION ALL
  SELECT 3, 'ROW COUNTS (live estimate)',
         COALESCE((SELECT string_agg(
                     '    ' || t.relname || ' = ' || GREATEST(c.reltuples, 0)::bigint,
                     E'\n' ORDER BY t.relname)
                     FROM target t JOIN pg_class c ON c.oid = t.oid), '(none)')
)

SELECT string_agg(
         '-- ============================================================' || E'\n'
         || '-- ' || s.heading || E'\n'
         || '-- ============================================================' || E'\n'
         || s.body,
         E'\n\n' ORDER BY s.ord) AS grocery_schema
  FROM section s;
