# ADR-001: Use Supabase Edge Functions as Primary Backend Runtime

## Status
Accepted

## Context
O backend está implementado majoritariamente em `supabase/functions/*`, com frontend usando `supabase.functions.invoke(...)`.
(fonte: src/lib/discoverDataApi.ts:61, supabase/functions/commerce/index.ts:1555)

## Decision
Padronizar APIs de domínio em Edge Functions Supabase (Discover/DPPI/TGIS/Commerce), usando Auth/DB Supabase e bridge para projeto de dados quando necessário.

## Consequences
- Prós: coesão de runtime e integração auth/db.
- Contras: contratos HTTP majoritariamente implícitos no código (necessidade de OpenAPI derivado).
