# Database App & Data Documentation

## Schema Completo (App DB)
- Fonte autoritativa: migrations em `supabase/migrations/*.sql`.
- Escopo Data DB remoto: Não determinado a partir do código local (somente bridge/env foi encontrado).

## Tabelas, Campos e Tipos

### public.chat_messages
Fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- report_id: UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE
- user_id: UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- role: TEXT NOT NULL CHECK (role IN ('user', 'assistant'))
- content: TEXT NOT NULL
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.commerce_abuse_signals
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- id: bigserial PRIMARY KEY
- user_id: uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- signal_type: text NOT NULL
- signal_value: text NULL
- risk_score: numeric(6,4) NULL
- state: text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'reviewed', 'ignored', 'confirmed'))
- note: text NULL
- reviewed_by: uuid NULL
- reviewed_at: timestamptz NULL
- created_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_accounts
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- user_id: uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
- plan_type: text NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free', 'pro'))
- access_state: text NOT NULL DEFAULT 'free_active' CHECK (
- access_state: IN (
- free_eligible: boolean NOT NULL DEFAULT true
- anti_abuse_review_required: boolean NOT NULL DEFAULT false
- anti_abuse_reason: text NULL
- device_fingerprint_hash: text NULL
- last_computed_at: timestamptz NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_billing_cycles
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- user_id: uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- subscription_id: uuid NULL REFERENCES public.commerce_subscriptions(id) ON DELETE SET NULL
- cycle_start: timestamptz NOT NULL
- cycle_end: timestamptz NOT NULL
- plan_type: text NOT NULL CHECK (plan_type IN ('free', 'pro'))
- base_credits: int NOT NULL DEFAULT 0 CHECK (base_credits >= 0)
- rollover_credits: int NOT NULL DEFAULT 0 CHECK (rollover_credits >= 0)
- monthly_plan_credits: int NOT NULL DEFAULT 0 CHECK (monthly_plan_credits >= 0)
- weekly_target: int NOT NULL DEFAULT 0 CHECK (weekly_target >= 0)
- rollover_cap: int NOT NULL DEFAULT 0 CHECK (rollover_cap >= 0)
- free_monthly_grant: int NOT NULL DEFAULT 0 CHECK (free_monthly_grant >= 0)
- consumed_plan_credits: int NOT NULL DEFAULT 0 CHECK (consumed_plan_credits >= 0)
- status: text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
- metadata_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_config
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- config_key: text PRIMARY KEY
- value_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- updated_by: uuid NULL
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_events
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- id: bigserial PRIMARY KEY
- user_id: uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
- event_name: text NOT NULL
- operation_id: uuid NULL
- reference_id: text NULL
- payload_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_ledger
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- id: bigserial PRIMARY KEY
- user_id: uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- cycle_id: uuid NULL REFERENCES public.commerce_billing_cycles(id) ON DELETE SET NULL
- wallet_type: text NOT NULL CHECK (
- wallet_type: IN ('weekly_wallet', 'monthly_plan', 'extra_wallet', 'free_monthly')
- entry_type: text NOT NULL CHECK (
- entry_type: IN (
- tool_code: text NULL CHECK (
- tool_code: IS NULL OR tool_code IN (
- delta: int NOT NULL
- operation_id: uuid NOT NULL DEFAULT gen_random_uuid()
- reference_id: text NULL
- idempotency_key: text NULL
- reason: text NULL
- metadata_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- actor_user_id: uuid NULL
- actor_role: text NULL
- created_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_pack_purchases
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- user_id: uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- pack_code: text NOT NULL
- credits: int NOT NULL CHECK (credits > 0)
- provider: text NOT NULL DEFAULT 'stripe'
- provider_checkout_session_id: text NULL UNIQUE
- provider_payment_intent_id: text NULL UNIQUE
- status: text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded'))
- granted_operation_id: uuid NULL
- expires_at: timestamptz NULL
- metadata_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_request_rate_limits
Fonte: supabase/migrations/20260312152000_commerce_security_hardening.sql
- scope: text NOT NULL
- subject_key: text NOT NULL
- window_start: timestamptz NOT NULL
- window_seconds: int NOT NULL CHECK (window_seconds > 0)
- request_count: int NOT NULL DEFAULT 0 CHECK (request_count >= 0)
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_subscriptions
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- user_id: uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
- provider: text NOT NULL DEFAULT 'stripe'
- provider_customer_id: text NULL
- provider_subscription_id: text NULL UNIQUE
- status: text NOT NULL DEFAULT 'inactive' CHECK (
- status: IN ('inactive', 'active', 'past_due', 'cancel_at_period_end', 'expired', 'canceled')
- current_period_start: timestamptz NULL
- current_period_end: timestamptz NULL
- cancel_at_period_end: boolean NOT NULL DEFAULT false
- canceled_at: timestamptz NULL
- metadata_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_tool_usage_attempts
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- user_id: uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- request_id: text NOT NULL
- idempotency_key: text NOT NULL
- tool_code: text NOT NULL CHECK (
- tool_code: IN (
- status: text NOT NULL CHECK (status IN ('blocked', 'debited', 'dispatched', 'success', 'failed', 'reversed'))
- credits_required: int NOT NULL DEFAULT 0 CHECK (credits_required >= 0)
- debit_source: text NULL CHECK (debit_source IN ('weekly_wallet', 'free_monthly', 'extra_wallet', 'mixed'))
- operation_id: uuid NULL
- upstream_function: text NULL
- upstream_status: int NULL
- error_code: text NULL
- error_message: text NULL
- payload_hash: text NULL
- metadata_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_wallets
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- user_id: uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
- current_cycle_id: uuid NULL REFERENCES public.commerce_billing_cycles(id) ON DELETE SET NULL
- weekly_wallet: int NOT NULL DEFAULT 0 CHECK (weekly_wallet >= 0)
- monthly_plan_remaining: int NOT NULL DEFAULT 0 CHECK (monthly_plan_remaining >= 0)
- extra_wallet: int NOT NULL DEFAULT 0 CHECK (extra_wallet >= 0)
- free_monthly_remaining: int NOT NULL DEFAULT 0 CHECK (free_monthly_remaining >= 0)
- wallet_version: bigint NOT NULL DEFAULT 0
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.commerce_webhook_events
Fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql
- id: bigserial PRIMARY KEY
- provider: text NOT NULL
- provider_event_id: text NOT NULL
- event_type: text NOT NULL
- payload_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- status: text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed', 'ignored'))
- error_text: text NULL
- processed_at: timestamptz NULL
- created_at: timestamptz NOT NULL DEFAULT now()

### public.discover_admin_overview_snapshot
Fonte: supabase/migrations/20260311170000_latency_optimization_wave1.sql
- id: smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1)
- as_of: timestamptz NOT NULL DEFAULT now()
- payload_json: jsonb NOT NULL
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.discover_island_page_cache
Fonte: supabase/migrations/20260225124500_discover_island_page_cache.sql
- island_code: text NOT NULL
- region: text NOT NULL
- surface_name: text NOT NULL
- payload_json: jsonb NOT NULL
- as_of: timestamptz NOT NULL
- expires_at: timestamptz NOT NULL
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.discover_islands
Fonte: supabase/migrations/20260212152100_b767017c-1a08-4105-8d59-d95ebc482c32.sql
- id: UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY
- island_code: TEXT NOT NULL UNIQUE
- title: TEXT
- creator_code: TEXT
- category: TEXT
- tags: JSONB DEFAULT '[]'::jsonb
- created_in: TEXT
- last_metrics: JSONB DEFAULT '{}'::jsonb
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discover_islands_cache
Fonte: supabase/migrations/20260214134338_fb699d5c-9d8a-4606-a317-b50089aee905.sql
- island_code: TEXT PRIMARY KEY
- title: TEXT
- creator_code: TEXT
- category: TEXT
- created_in: TEXT
- tags: JSONB DEFAULT '[]'
- first_seen_at: TIMESTAMPTZ DEFAULT now()
- last_seen_at: TIMESTAMPTZ DEFAULT now()
- last_status: TEXT
- suppressed_streak: INT DEFAULT 0
- reported_streak: INT DEFAULT 0
- last_report_id: UUID NULL
- last_reported_at: TIMESTAMPTZ NULL
- last_suppressed_at: TIMESTAMPTZ NULL
- last_probe_unique: INT NULL
- last_probe_plays: INT NULL
- last_week_unique: INT NULL
- last_week_plays: INT NULL
- last_week_minutes: INT NULL
- last_week_peak_ccu: INT NULL
- last_week_favorites: INT NULL
- last_week_recommends: INT NULL
- last_week_d1_avg: DOUBLE PRECISION NULL
- last_week_d7_avg: DOUBLE PRECISION NULL
- last_week_minutes_per_player_avg: DOUBLE PRECISION NULL
- updated_at: TIMESTAMPTZ DEFAULT now()

### public.discover_link_edges
Fonte: supabase/migrations/20260216032000_discover_link_edges.sql
- parent_link_code: TEXT NOT NULL
- child_link_code: TEXT NOT NULL
- edge_type: TEXT NOT NULL
- sort_order: INT NULL
- source: TEXT NOT NULL DEFAULT 'links_related'
- metadata: JSONB NULL
- last_seen_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- parent_link_code: TEXT NOT NULL
- child_link_code: TEXT NOT NULL
- edge_type: TEXT NOT NULL DEFAULT 'related_link'
- sort_order: INTEGER
- first_seen_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- last_seen_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discover_link_metadata
Fonte: supabase/migrations/20260215195000_discover_link_metadata.sql
- link_code: TEXT PRIMARY KEY
- link_code_type: TEXT NOT NULL CHECK (link_code_type IN ('island','collection'))
- namespace: TEXT NULL
- link_type: TEXT NULL
- account_id: TEXT NULL
- creator_name: TEXT NULL
- support_code: TEXT NULL
- title: TEXT NULL
- tagline: TEXT NULL
- introduction: TEXT NULL
- locale: TEXT NULL
- image_url: TEXT NULL
- image_urls: JSONB NULL
- extra_image_urls: JSONB NULL
- video_vuid: TEXT NULL
- max_players: INT NULL
- min_players: INT NULL
- max_social_party_size: INT NULL
- ratings: JSONB NULL
- version: INT NULL
- created_at_epic: TIMESTAMPTZ NULL
- published_at_epic: TIMESTAMPTZ NULL
- updated_at_epic: TIMESTAMPTZ NULL
- last_activated_at_epic: TIMESTAMPTZ NULL
- moderation_status: TEXT NULL
- link_state: TEXT NULL
- discovery_intent: TEXT NULL
- active: BOOLEAN NULL
- disabled: BOOLEAN NULL
- last_fetched_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- next_due_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- last_error: TEXT NULL
- locked_at: TIMESTAMPTZ NULL
- lock_id: UUID NULL
- raw: JSONB NOT NULL DEFAULT '{}'::jsonb
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discover_link_metadata_events
Fonte: supabase/migrations/20260215195000_discover_link_metadata.sql
- id: BIGSERIAL PRIMARY KEY
- ts: TIMESTAMPTZ NOT NULL DEFAULT now()
- link_code: TEXT NOT NULL
- event_type: TEXT NOT NULL CHECK (event_type IN ('thumb_changed','title_changed','epic_updated','moderation_changed'))
- old_value: JSONB NULL
- new_value: JSONB NULL

### public.discover_lookup_ai_cache
Fonte: supabase/migrations/20260224190000_lookup_ai_cache.sql
- id: bigserial PRIMARY KEY
- primary_code: text NOT NULL
- compare_code: text NOT NULL DEFAULT ''
- locale: text NOT NULL DEFAULT 'pt-BR'
- window_days: integer NOT NULL DEFAULT 7 CHECK (window_days >= 1 AND window_days <= 90)
- payload_fingerprint: text NOT NULL
- response_json: jsonb NOT NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- expires_at: timestamptz NOT NULL
- hit_count: integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0)

### public.discover_lookup_ai_recent
Fonte: supabase/migrations/20260224233000_lookup_ai_recent.sql
- id: bigserial PRIMARY KEY
- user_id: uuid NOT NULL
- primary_code: text NOT NULL
- compare_code: text NOT NULL DEFAULT ''
- primary_title: text
- compare_title: text
- locale: text NOT NULL DEFAULT 'pt-BR'
- window_days: integer NOT NULL DEFAULT 7 CHECK (window_days >= 1 AND window_days <= 90)
- payload_fingerprint: text NOT NULL
- response_json: jsonb NOT NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- last_accessed_at: timestamptz NOT NULL DEFAULT now()
- hit_count: integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0)

### public.discover_lookup_pipeline_runs
Fonte: supabase/migrations/20260216101500_lookup_pipeline_command_center.sql
- id: bigserial PRIMARY KEY
- ts: timestamptz NOT NULL DEFAULT now()
- user_id: uuid NULL
- island_code: text NOT NULL
- status: text NOT NULL CHECK (status IN ('ok', 'error'))
- duration_ms: integer NOT NULL DEFAULT 0
- error_type: text NULL
- error_message: text NULL
- has_internal_card: boolean NOT NULL DEFAULT false
- has_discovery_signals: boolean NOT NULL DEFAULT false
- has_weekly_performance: boolean NOT NULL DEFAULT false
- category_leaders_count: integer NOT NULL DEFAULT 0

### public.discover_lookup_recent
Fonte: supabase/migrations/20260224234500_lookup_recent_payload_cache.sql
- id: bigserial PRIMARY KEY
- user_id: uuid NOT NULL
- primary_code: text NOT NULL
- compare_code: text NOT NULL DEFAULT ''
- primary_title: text
- compare_title: text
- payload_json: jsonb NOT NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- last_accessed_at: timestamptz NOT NULL DEFAULT now()
- hit_count: integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0)

### public.discover_report_islands
Fonte: supabase/migrations/20260214124538_ca5dc773-9a82-4f23-b518-6e7f956dfa43.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- report_id: UUID NOT NULL REFERENCES public.discover_reports(id) ON DELETE CASCADE
- island_code: TEXT NOT NULL
- title: TEXT
- creator_code: TEXT
- category: TEXT
- created_in: TEXT
- tags: JSONB DEFAULT '[]'
- status: TEXT
- probe_unique: INT NULL
- probe_plays: INT NULL
- probe_minutes: INT NULL
- probe_peak_ccu: INT NULL
- probe_date: DATE NULL
- week_unique: INT NULL
- week_plays: INT NULL
- week_minutes: INT NULL
- week_minutes_per_player_avg: FLOAT NULL
- week_peak_ccu_max: INT NULL
- week_favorites: INT NULL
- week_recommends: INT NULL
- week_d1_avg: FLOAT NULL
- week_d7_avg: FLOAT NULL
- updated_at: TIMESTAMPTZ DEFAULT now()

### public.discover_report_queue
Fonte: supabase/migrations/20260214124538_ca5dc773-9a82-4f23-b518-6e7f956dfa43.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- report_id: UUID NOT NULL REFERENCES public.discover_reports(id) ON DELETE CASCADE
- island_code: TEXT NOT NULL
- status: TEXT DEFAULT 'pending'
- locked_at: TIMESTAMPTZ NULL
- attempts: INT DEFAULT 0
- last_error: TEXT NULL
- created_at: TIMESTAMPTZ DEFAULT now()
- updated_at: TIMESTAMPTZ DEFAULT now()

### public.discover_report_rebuild_runs
Fonte: supabase/migrations/20260215235000_v1_close_schema.sql
- id: BIGSERIAL PRIMARY KEY
- weekly_report_id: UUID NOT NULL REFERENCES public.weekly_reports(id) ON DELETE CASCADE
- report_id: UUID NULL REFERENCES public.discover_reports(id) ON DELETE SET NULL
- user_id: UUID NULL
- ts_start: TIMESTAMPTZ NOT NULL DEFAULT now()
- ts_end: TIMESTAMPTZ NULL
- ok: BOOLEAN NOT NULL DEFAULT false
- summary_json: JSONB NOT NULL DEFAULT '{}'::jsonb
- id: BIGSERIAL PRIMARY KEY
- weekly_report_id: UUID NOT NULL REFERENCES public.weekly_reports(id) ON DELETE CASCADE
- report_id: UUID NULL REFERENCES public.discover_reports(id) ON DELETE SET NULL
- user_id: UUID NULL
- ts_start: TIMESTAMPTZ NOT NULL DEFAULT now()
- ts_end: TIMESTAMPTZ NULL
- ok: BOOLEAN NOT NULL DEFAULT false
- summary_json: JSONB NOT NULL DEFAULT '{}'::jsonb

### public.discover_reports
Fonte: supabase/migrations/20260212152100_b767017c-1a08-4105-8d59-d95ebc482c32.sql
- id: UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY
- week_start: DATE NOT NULL
- week_end: DATE NOT NULL
- week_number: INTEGER NOT NULL
- year: INTEGER NOT NULL
- status: TEXT NOT NULL DEFAULT 'collecting'
- raw_metrics: JSONB DEFAULT '{}'::jsonb
- computed_rankings: JSONB DEFAULT '{}'::jsonb
- platform_kpis: JSONB DEFAULT '{}'::jsonb
- ai_narratives: JSONB DEFAULT '{}'::jsonb
- island_count: INTEGER DEFAULT 0
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discovery_exposure_entries_raw
Fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql
- id: BIGSERIAL PRIMARY KEY
- tick_id: UUID NOT NULL REFERENCES public.discovery_exposure_ticks(id) ON DELETE CASCADE
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- ts: TIMESTAMPTZ NOT NULL DEFAULT now()
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- panel_display_name: TEXT NULL
- panel_type: TEXT NULL
- feature_tags: TEXT[] NULL
- page_index: INT NOT NULL DEFAULT 0
- rank: INT NOT NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- global_ccu: INT NULL
- is_visible: BOOLEAN NULL
- lock_status: TEXT NULL
- lock_status_reason: TEXT NULL
- id: BIGSERIAL PRIMARY KEY
- tick_id: UUID NOT NULL REFERENCES public.discovery_exposure_ticks(id) ON DELETE CASCADE
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- ts: TIMESTAMPTZ NOT NULL DEFAULT now()
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- panel_display_name: TEXT NULL
- panel_type: TEXT NULL
- feature_tags: TEXT[] NULL
- page_index: INT NOT NULL DEFAULT 0
- rank: INT NOT NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- global_ccu: INT NULL
- is_visible: BOOLEAN NULL
- lock_status: TEXT NULL
- lock_status_reason: TEXT NULL

### public.discovery_exposure_link_state
Fonte: supabase/migrations/20260215023224_dab690e7-2def-4e91-9a87-a85859a4a187.sql
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- first_seen_at: TIMESTAMPTZ NOT NULL
- last_seen_at: TIMESTAMPTZ NOT NULL
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- first_seen_at: TIMESTAMPTZ NOT NULL
- last_seen_at: TIMESTAMPTZ NOT NULL

### public.discovery_exposure_presence_events
Fonte: supabase/migrations/20260215023224_dab690e7-2def-4e91-9a87-a85859a4a187.sql
- id: BIGSERIAL PRIMARY KEY
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- tick_id: UUID NOT NULL REFERENCES public.discovery_exposure_ticks(id) ON DELETE CASCADE
- ts: TIMESTAMPTZ NOT NULL
- event_type: TEXT NOT NULL CHECK (event_type IN ('enter', 'exit'))
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- panel_display_name: TEXT NULL
- panel_type: TEXT NULL
- feature_tags: TEXT[] NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- rank: INT NULL
- global_ccu: INT NULL
- closed_reason: TEXT NULL
- id: BIGSERIAL PRIMARY KEY
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- tick_id: UUID NOT NULL REFERENCES public.discovery_exposure_ticks(id) ON DELETE CASCADE
- ts: TIMESTAMPTZ NOT NULL
- event_type: TEXT NOT NULL CHECK (event_type IN ('enter', 'exit'))
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- panel_display_name: TEXT NULL
- panel_type: TEXT NULL
- feature_tags: TEXT[] NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- rank: INT NULL
- global_ccu: INT NULL
- closed_reason: TEXT NULL

### public.discovery_exposure_presence_segments
Fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- panel_display_name: TEXT NULL
- panel_type: TEXT NULL
- feature_tags: TEXT[] NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- start_ts: TIMESTAMPTZ NOT NULL
- last_seen_ts: TIMESTAMPTZ NOT NULL
- end_ts: TIMESTAMPTZ NULL
- best_rank: INT NULL
- rank_sum: INT NOT NULL DEFAULT 0
- rank_samples: INT NOT NULL DEFAULT 0
- end_rank: INT NULL
- ccu_start: INT NULL
- ccu_max: INT NULL
- ccu_end: INT NULL
- closed_reason: TEXT NULL
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- panel_display_name: TEXT NULL
- panel_type: TEXT NULL
- feature_tags: TEXT[] NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- start_ts: TIMESTAMPTZ NOT NULL
- last_seen_ts: TIMESTAMPTZ NOT NULL
- end_ts: TIMESTAMPTZ NULL
- best_rank: INT NULL
- rank_sum: INT NOT NULL DEFAULT 0
- rank_samples: INT NOT NULL DEFAULT 0
- end_rank: INT NULL
- ccu_start: INT NULL
- ccu_max: INT NULL
- ccu_end: INT NULL
- closed_reason: TEXT NULL
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discovery_exposure_rank_segments
Fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- panel_display_name: TEXT NULL
- panel_type: TEXT NULL
- feature_tags: TEXT[] NULL
- rank: INT NOT NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- start_ts: TIMESTAMPTZ NOT NULL
- last_seen_ts: TIMESTAMPTZ NOT NULL
- end_ts: TIMESTAMPTZ NULL
- ccu_start: INT NULL
- ccu_max: INT NULL
- ccu_end: INT NULL
- closed_reason: TEXT NULL
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- panel_display_name: TEXT NULL
- panel_type: TEXT NULL
- feature_tags: TEXT[] NULL
- rank: INT NOT NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- start_ts: TIMESTAMPTZ NOT NULL
- last_seen_ts: TIMESTAMPTZ NOT NULL
- end_ts: TIMESTAMPTZ NULL
- ccu_start: INT NULL
- ccu_max: INT NULL
- ccu_end: INT NULL
- closed_reason: TEXT NULL
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discovery_exposure_rollup_daily
Fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql
- date: DATE NOT NULL
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- minutes_exposed: INT NOT NULL DEFAULT 0
- appearances: INT NOT NULL DEFAULT 0
- best_rank: INT NULL
- avg_rank: DOUBLE PRECISION NULL
- ccu_max_seen: INT NULL
- distinct_creators: INT NULL
- date: DATE NOT NULL
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- minutes_exposed: INT NOT NULL DEFAULT 0
- appearances: INT NOT NULL DEFAULT 0
- best_rank: INT NULL
- avg_rank: DOUBLE PRECISION NULL
- ccu_max_seen: INT NULL
- distinct_creators: INT NULL

### public.discovery_exposure_targets
Fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- region: TEXT NOT NULL
- surface_name: TEXT NOT NULL
- platform: TEXT NOT NULL DEFAULT 'Windows'
- locale: TEXT NOT NULL DEFAULT 'en'
- interval_minutes: INT NOT NULL DEFAULT 10
- next_due_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- locked_at: TIMESTAMPTZ NULL
- lock_id: UUID NULL
- last_ok_tick_at: TIMESTAMPTZ NULL
- last_failed_tick_at: TIMESTAMPTZ NULL
- last_status: TEXT NOT NULL DEFAULT 'idle'
- last_error: TEXT NULL
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- region: TEXT NOT NULL
- surface_name: TEXT NOT NULL
- platform: TEXT NOT NULL DEFAULT 'Windows'
- locale: TEXT NOT NULL DEFAULT 'en'
- interval_minutes: INT NOT NULL DEFAULT 10
- next_due_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- locked_at: TIMESTAMPTZ NULL
- lock_id: UUID NULL
- last_ok_tick_at: TIMESTAMPTZ NULL
- last_failed_tick_at: TIMESTAMPTZ NULL
- last_status: TEXT NOT NULL DEFAULT 'idle'
- last_error: TEXT NULL
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discovery_exposure_ticks
Fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- ts_start: TIMESTAMPTZ NOT NULL DEFAULT now()
- ts_end: TIMESTAMPTZ NULL
- status: TEXT NOT NULL DEFAULT 'running'
- branch: TEXT NULL
- test_variant_name: TEXT NULL
- test_name: TEXT NULL
- test_analytics_id: TEXT NULL
- panels_count: INT NOT NULL DEFAULT 0
- entries_count: INT NOT NULL DEFAULT 0
- duration_ms: INT NULL
- error_code: TEXT NULL
- error_message: TEXT NULL
- correlation_id: TEXT NULL
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- target_id: UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- ts_start: TIMESTAMPTZ NOT NULL DEFAULT now()
- ts_end: TIMESTAMPTZ NULL
- status: TEXT NOT NULL DEFAULT 'running'
- branch: TEXT NULL
- test_variant_name: TEXT NULL
- test_name: TEXT NULL
- test_analytics_id: TEXT NULL
- panels_count: INT NOT NULL DEFAULT 0
- entries_count: INT NOT NULL DEFAULT 0
- duration_ms: INT NULL
- error_code: TEXT NULL
- error_message: TEXT NULL
- correlation_id: TEXT NULL
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discovery_live_panel_alias
Fonte: supabase/migrations/20260225101000_discovery_live_panel_config.sql
- alias_token: TEXT PRIMARY KEY
- target_panel_name: TEXT NOT NULL
- resolver_hint: TEXT NULL
- priority: INT NOT NULL DEFAULT 100
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discovery_live_panel_config
Fonte: supabase/migrations/20260225101000_discovery_live_panel_config.sql
- panel_key: TEXT PRIMARY KEY
- label: TEXT NOT NULL
- description: TEXT NULL
- display_order: INT NOT NULL
- enabled: BOOLEAN NOT NULL DEFAULT true
- row_kind: TEXT NOT NULL DEFAULT 'island' CHECK (row_kind IN ('island','collection','mixed'))
- is_premium: BOOLEAN NOT NULL DEFAULT false
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discovery_panel_intel_snapshot
Fonte: supabase/migrations/20260226120000_discovery_panel_intel_snapshot.sql
- target_id: uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- region: text NOT NULL
- surface_name: text NOT NULL
- panel_name: text NOT NULL
- window_days: int NOT NULL DEFAULT 14
- as_of: timestamptz NOT NULL
- payload_json: jsonb NOT NULL
- sample_stints: int NOT NULL DEFAULT 0
- sample_closed_stints: int NOT NULL DEFAULT 0
- active_maps_now: int NOT NULL DEFAULT 0
- confidence: text NOT NULL DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high'))
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.discovery_panel_tiers
Fonte: supabase/migrations/20260215102000_discovery_public_intel.sql
- panel_name: TEXT PRIMARY KEY
- tier: INT NOT NULL CHECK (tier >= 1 AND tier <= 3)
- label: TEXT NULL
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.discovery_public_emerging_now
Fonte: supabase/migrations/20260215102000_discovery_public_intel.sql
- as_of: TIMESTAMPTZ NOT NULL
- region: TEXT NOT NULL
- surface_name: TEXT NOT NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- first_seen_at: TIMESTAMPTZ NOT NULL
- minutes_6h: INT NOT NULL
- minutes_24h: INT NOT NULL
- best_rank_24h: INT NULL
- panels_24h: INT NOT NULL
- premium_panels_24h: INT NOT NULL
- reentries_24h: INT NOT NULL
- score: DOUBLE PRECISION NOT NULL
- title: TEXT NULL
- creator_code: TEXT NULL

### public.discovery_public_pollution_creators_now
Fonte: supabase/migrations/20260215102000_discovery_public_intel.sql
- as_of: TIMESTAMPTZ NOT NULL
- creator_code: TEXT NOT NULL
- duplicate_clusters_7d: INT NOT NULL
- duplicate_islands_7d: INT NOT NULL
- duplicates_over_min: INT NOT NULL
- spam_score: DOUBLE PRECISION NOT NULL
- sample_titles: TEXT[] NULL

### public.discovery_public_premium_now
Fonte: supabase/migrations/20260215102000_discovery_public_intel.sql
- as_of: TIMESTAMPTZ NOT NULL
- region: TEXT NOT NULL
- surface_name: TEXT NOT NULL
- panel_name: TEXT NOT NULL
- panel_display_name: TEXT NULL
- panel_type: TEXT NULL
- rank: INT NOT NULL
- link_code: TEXT NOT NULL
- link_code_type: TEXT NOT NULL
- ccu: INT NULL
- title: TEXT NULL
- creator_code: TEXT NULL

### public.dppi_calibration_metrics
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- id: bigserial PRIMARY KEY
- measured_at: timestamptz NOT NULL DEFAULT now()
- model_name: text NOT NULL
- model_version: text NOT NULL
- task_type: text NOT NULL CHECK (task_type IN ('entry','survival'))
- prediction_horizon: text NOT NULL
- brier: double precision NULL
- logloss: double precision NULL
- ece: double precision NULL
- calibration_method: text NULL
- created_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_drift_metrics
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- id: bigserial PRIMARY KEY
- measured_at: timestamptz NOT NULL DEFAULT now()
- model_name: text NOT NULL
- model_version: text NOT NULL
- feature_name: text NOT NULL
- psi: double precision NULL
- ks: double precision NULL
- drift_level: text NOT NULL DEFAULT 'low' CHECK (drift_level IN ('low','medium','high'))
- created_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_feature_store_daily
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- as_of: date NOT NULL
- target_id: uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- region: text NOT NULL
- surface_name: text NOT NULL
- panel_name: text NOT NULL
- island_code: text NOT NULL
- feature_ccu_avg: double precision NOT NULL DEFAULT 0
- feature_minutes_exposed: int NOT NULL DEFAULT 0
- feature_appearances: int NOT NULL DEFAULT 0
- feature_entries_24h: int NOT NULL DEFAULT 0
- feature_exits_24h: int NOT NULL DEFAULT 0
- feature_replacements_24h: int NOT NULL DEFAULT 0
- feature_unique_panels_7d: int NOT NULL DEFAULT 0
- feature_favorites_7d: int NOT NULL DEFAULT 0
- feature_recommends_7d: int NOT NULL DEFAULT 0
- features_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_feature_store_hourly
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- as_of_bucket: timestamptz NOT NULL
- target_id: uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- region: text NOT NULL
- surface_name: text NOT NULL
- panel_name: text NOT NULL
- island_code: text NOT NULL
- ccu_avg: double precision NOT NULL DEFAULT 0
- ccu_max: int NOT NULL DEFAULT 0
- entries_1h: int NOT NULL DEFAULT 0
- exits_1h: int NOT NULL DEFAULT 0
- replacements_1h: int NOT NULL DEFAULT 0
- exposure_minutes_1h: double precision NOT NULL DEFAULT 0
- features_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_feedback_events
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- id: bigserial PRIMARY KEY
- created_at: timestamptz NOT NULL DEFAULT now()
- source: text NOT NULL
- user_id: uuid NULL
- island_code: text NULL
- panel_name: text NULL
- region: text NULL
- surface_name: text NULL
- event_type: text NOT NULL
- event_value: jsonb NOT NULL DEFAULT '{}'::jsonb

### public.dppi_inference_log
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- id: bigserial PRIMARY KEY
- ts: timestamptz NOT NULL DEFAULT now()
- mode: text NOT NULL
- target_scope: jsonb NOT NULL DEFAULT '{}'::jsonb
- processed_rows: int NOT NULL DEFAULT 0
- failed_rows: int NOT NULL DEFAULT 0
- latency_ms: int NULL
- model_name: text NULL
- model_version: text NULL
- error_text: text NULL
- created_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_labels_entry
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- as_of_bucket: timestamptz NOT NULL
- target_id: uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- panel_name: text NOT NULL
- island_code: text NOT NULL
- enter_2h: boolean NOT NULL DEFAULT false
- enter_5h: boolean NOT NULL DEFAULT false
- enter_12h: boolean NOT NULL DEFAULT false
- entered_at: timestamptz NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_labels_survival
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- stint_id: uuid PRIMARY KEY REFERENCES public.discovery_exposure_presence_segments(id) ON DELETE CASCADE
- target_id: uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- panel_name: text NOT NULL
- island_code: text NOT NULL
- stint_start: timestamptz NOT NULL
- stint_end: timestamptz NOT NULL
- duration_minutes: double precision NOT NULL DEFAULT 0
- stay_30m: boolean NOT NULL DEFAULT false
- stay_60m: boolean NOT NULL DEFAULT false
- replaced_lt_30m: boolean NOT NULL DEFAULT false
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_model_registry
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- id: bigserial PRIMARY KEY
- model_name: text NOT NULL
- model_version: text NOT NULL
- task_type: text NOT NULL CHECK (task_type IN ('entry','survival'))
- status: text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','training','production_candidate','shadow','production','archived','failed'))
- metrics_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- artifacts_uri: text NULL
- trained_at: timestamptz NULL
- published_at: timestamptz NULL
- created_by: uuid NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_opportunities
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- id: bigserial PRIMARY KEY
- generated_at: timestamptz NOT NULL DEFAULT now()
- as_of_bucket: timestamptz NOT NULL
- target_id: uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- region: text NOT NULL
- surface_name: text NOT NULL
- panel_name: text NOT NULL
- island_code: text NOT NULL
- enter_score_2h: double precision NOT NULL DEFAULT 0
- enter_score_5h: double precision NOT NULL DEFAULT 0
- enter_score_12h: double precision NOT NULL DEFAULT 0
- opening_signal: double precision NOT NULL DEFAULT 0
- pressure_forecast: text NOT NULL DEFAULT 'medium' CHECK (pressure_forecast IN ('low','medium','high'))
- confidence_bucket: text NOT NULL DEFAULT 'low' CHECK (confidence_bucket IN ('low','medium','high'))
- opportunity_rank: int NOT NULL DEFAULT 0
- model_name: text NULL
- model_version: text NULL
- evidence_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_panel_families
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- panel_name: text PRIMARY KEY
- family_name: text NOT NULL
- weight: double precision NOT NULL DEFAULT 1.0
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_predictions
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- id: bigserial PRIMARY KEY
- generated_at: timestamptz NOT NULL DEFAULT now()
- as_of_bucket: timestamptz NOT NULL
- target_id: uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- region: text NOT NULL
- surface_name: text NOT NULL
- panel_name: text NOT NULL
- island_code: text NOT NULL
- prediction_horizon: text NOT NULL CHECK (prediction_horizon IN ('2h','5h','12h'))
- score: double precision NOT NULL
- confidence_bucket: text NOT NULL DEFAULT 'low' CHECK (confidence_bucket IN ('low','medium','high'))
- model_name: text NULL
- model_version: text NULL
- evidence_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_release_channels
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- channel_name: text PRIMARY KEY CHECK (channel_name IN ('shadow','candidate','limited','production'))
- model_name: text NULL
- model_version: text NULL
- notes: text NULL
- updated_by: uuid NULL
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_survival_predictions
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- id: bigserial PRIMARY KEY
- generated_at: timestamptz NOT NULL DEFAULT now()
- as_of_bucket: timestamptz NOT NULL
- target_id: uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE
- region: text NOT NULL
- surface_name: text NOT NULL
- panel_name: text NOT NULL
- island_code: text NOT NULL
- prediction_horizon: text NOT NULL CHECK (prediction_horizon IN ('30m','60m','replace_lt_30m'))
- score: double precision NOT NULL
- confidence_bucket: text NOT NULL DEFAULT 'low' CHECK (confidence_bucket IN ('low','medium','high'))
- model_name: text NULL
- model_version: text NULL
- evidence_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_training_dataset_meta
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- id: bigserial PRIMARY KEY
- dataset_type: text NOT NULL CHECK (dataset_type IN ('entry','survival','inference'))
- range_start: timestamptz NOT NULL
- range_end: timestamptz NOT NULL
- sample_count: int NOT NULL DEFAULT 0
- status: text NOT NULL DEFAULT 'ready' CHECK (status IN ('building','ready','failed'))
- metadata_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_training_log
Fonte: supabase/migrations/20260227113000_dppi_tables.sql
- id: bigserial PRIMARY KEY
- requested_at: timestamptz NOT NULL DEFAULT now()
- started_at: timestamptz NULL
- ended_at: timestamptz NULL
- status: text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed','cancelled'))
- model_name: text NOT NULL
- model_version: text NOT NULL
- task_type: text NOT NULL CHECK (task_type IN ('entry','survival'))
- requested_by: uuid NULL
- worker_host: text NULL
- payload_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- result_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- error_text: text NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.dppi_worker_heartbeat
Fonte: supabase/migrations/20260227173000_dppi_readiness_benchmark_worker_and_materialize.sql
- id: bigserial PRIMARY KEY
- ts: timestamptz NOT NULL DEFAULT now()
- worker_host: text NOT NULL
- source: text NOT NULL DEFAULT 'hetzner-cx22'
- cpu_pct: double precision NULL
- mem_pct: double precision NULL
- mem_used_mb: integer NULL
- mem_total_mb: integer NULL
- disk_pct: double precision NULL
- queue_depth: integer NULL
- training_running: boolean NOT NULL DEFAULT false
- inference_running: boolean NOT NULL DEFAULT false
- extra_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()

### public.ops_backup_restore_drills
Fonte: supabase/migrations/20260311112000_ops_backup_restore_and_alerts.sql
- id: BIGSERIAL PRIMARY KEY
- environment: TEXT NOT NULL DEFAULT 'data'
- result: TEXT NOT NULL CHECK (result IN ('success', 'partial', 'failed'))
- rpo_minutes: INTEGER
- rto_minutes: INTEGER
- notes: TEXT
- performed_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- created_by: UUID DEFAULT auth.uid()
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.profiles
Fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- user_id: UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
- display_name: TEXT
- avatar_url: TEXT
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.projects
Fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- user_id: UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- name: TEXT NOT NULL
- description: TEXT
- island_code: TEXT
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.ralph_actions
Fonte: supabase/migrations/20260216123000_ralph_ops_foundation.sql
- id: bigserial PRIMARY KEY
- run_id: uuid NOT NULL REFERENCES public.ralph_runs(id) ON DELETE CASCADE
- step_index: integer NOT NULL DEFAULT 0
- phase: text NOT NULL DEFAULT 'execute'
- tool_name: text NULL
- target: text NULL
- status: text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warn', 'error', 'skipped'))
- latency_ms: integer NOT NULL DEFAULT 0
- details: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()

### public.ralph_eval_results
Fonte: supabase/migrations/20260216123000_ralph_ops_foundation.sql
- id: bigserial PRIMARY KEY
- run_id: uuid NOT NULL REFERENCES public.ralph_runs(id) ON DELETE CASCADE
- suite: text NOT NULL
- metric: text NOT NULL
- value: numeric NULL
- threshold: numeric NULL
- pass: boolean NOT NULL
- details: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()

### public.ralph_incidents
Fonte: supabase/migrations/20260216123000_ralph_ops_foundation.sql
- id: bigserial PRIMARY KEY
- run_id: uuid NULL REFERENCES public.ralph_runs(id) ON DELETE SET NULL
- severity: text NOT NULL CHECK (severity IN ('info', 'warn', 'error', 'critical'))
- incident_type: text NOT NULL
- message: text NOT NULL
- resolved: boolean NOT NULL DEFAULT false
- resolution_note: text NULL
- metadata: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()
- resolved_at: timestamptz NULL

### public.ralph_memory_decisions
Fonte: supabase/migrations/20260218154000_ralph_memory_context.sql
- id: BIGSERIAL PRIMARY KEY
- run_id: UUID NULL REFERENCES public.ralph_runs(id) ON DELETE SET NULL
- decision_key: TEXT NOT NULL
- decision: TEXT NOT NULL
- rationale: TEXT NULL
- status: TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected', 'applied'))
- scope: TEXT[] NOT NULL DEFAULT '{}'
- evidence: JSONB NOT NULL DEFAULT '{}'::jsonb
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.ralph_memory_documents
Fonte: supabase/migrations/20260218182000_ralph_semantic_memory.sql
- id: BIGSERIAL PRIMARY KEY
- doc_key: TEXT NOT NULL UNIQUE
- doc_type: TEXT NOT NULL DEFAULT 'doc'
- scope: TEXT[] NOT NULL DEFAULT '{}'
- title: TEXT NOT NULL DEFAULT ''
- content: TEXT NOT NULL DEFAULT ''
- metadata: JSONB NOT NULL DEFAULT '{}'::jsonb
- importance: INT NOT NULL DEFAULT 50 CHECK (importance >= 0 AND importance <= 100)
- token_count: INT NULL
- source_path: TEXT NULL
- content_hash: TEXT NULL
- embedding: VECTOR(1536) NULL
- search_text: TSVECTOR GENERATED ALWAYS AS (
- is_active: BOOLEAN NOT NULL DEFAULT true
- first_seen_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- last_seen_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.ralph_memory_items
Fonte: supabase/migrations/20260218154000_ralph_memory_context.sql
- id: BIGSERIAL PRIMARY KEY
- memory_key: TEXT NOT NULL UNIQUE
- category: TEXT NOT NULL DEFAULT 'general'
- importance: INT NOT NULL DEFAULT 50 CHECK (importance >= 0 AND importance <= 100)
- status: TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'watch', 'resolved', 'ignored'))
- scope: TEXT[] NOT NULL DEFAULT '{}'
- summary: TEXT NOT NULL
- evidence: JSONB NOT NULL DEFAULT '{}'::jsonb
- first_seen_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- last_seen_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- hit_count: INT NOT NULL DEFAULT 1

### public.ralph_memory_snapshots
Fonte: supabase/migrations/20260218154000_ralph_memory_context.sql
- id: BIGSERIAL PRIMARY KEY
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- source: TEXT NOT NULL DEFAULT 'system'
- scope: TEXT[] NOT NULL DEFAULT '{}'
- metrics: JSONB NOT NULL DEFAULT '{}'::jsonb
- notes: JSONB NOT NULL DEFAULT '{}'::jsonb

### public.ralph_runs
Fonte: supabase/migrations/20260216123000_ralph_ops_foundation.sql
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- mode: text NOT NULL CHECK (mode IN ('dev', 'dataops', 'report', 'qa', 'custom'))
- status: text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'promotable', 'rolled_back'))
- started_at: timestamptz NOT NULL DEFAULT now()
- ended_at: timestamptz NULL
- max_iterations: integer NOT NULL DEFAULT 8
- timeout_minutes: integer NOT NULL DEFAULT 45
- budget_usd: numeric(12,4) NOT NULL DEFAULT 0
- token_budget: bigint NOT NULL DEFAULT 0
- spent_usd: numeric(12,4) NOT NULL DEFAULT 0
- spent_tokens: bigint NOT NULL DEFAULT 0
- target_scope: text[] NOT NULL DEFAULT '{}'
- summary: jsonb NOT NULL DEFAULT '{}'::jsonb
- error_message: text NULL
- created_by: uuid NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.reports
Fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- upload_id: UUID NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE
- project_id: UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
- user_id: UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- parsed_data: JSONB DEFAULT '{}'::jsonb
- metrics: JSONB DEFAULT '{}'::jsonb
- diagnostics: JSONB DEFAULT '{}'::jsonb
- ai_summary: TEXT
- status: TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error'))
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.system_alerts_current
Fonte: supabase/migrations/20260215235000_v1_close_schema.sql
- alert_key: TEXT PRIMARY KEY
- severity: TEXT NOT NULL CHECK (severity IN ('ok','warn','error'))
- message: TEXT NOT NULL
- details: JSONB NOT NULL DEFAULT '{}'::jsonb
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()
- alert_key: TEXT PRIMARY KEY
- severity: TEXT NOT NULL CHECK (severity IN ('ok','warn','error'))
- message: TEXT NOT NULL
- details: JSONB NOT NULL DEFAULT '{}'::jsonb
- updated_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.tgis_beta_users
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- user_id: uuid PRIMARY KEY
- active: boolean NOT NULL DEFAULT true
- notes: text NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_blocklist_terms
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- term: text PRIMARY KEY
- is_active: boolean NOT NULL DEFAULT true
- reason: text NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_cluster_merge_rules
Fonte: supabase/migrations/20260303110000_tgis_recluster_v2.sql
- source_cluster_slug: text PRIMARY KEY
- target_cluster_slug: text NOT NULL
- reason: text NULL
- is_active: boolean NOT NULL DEFAULT true
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_cluster_registry
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- cluster_id: integer PRIMARY KEY
- cluster_name: text NOT NULL
- trigger_word: text NOT NULL
- categories_json: jsonb NOT NULL DEFAULT '[]'::jsonb
- lora_fal_path: text NULL
- lora_version: text NULL
- model_base: text NOT NULL DEFAULT 'Tongyi-MAI/Z-Image-Turbo'
- is_active: boolean NOT NULL DEFAULT true
- notes: text NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_cluster_taxonomy_rules
Fonte: supabase/migrations/20260303110000_tgis_recluster_v2.sql
- rule_id: bigserial PRIMARY KEY
- cluster_slug: text NOT NULL
- cluster_family: text NOT NULL
- priority: int NOT NULL
- include_any: text[] NOT NULL DEFAULT '{}'::text[]
- include_all: text[] NOT NULL DEFAULT '{}'::text[]
- exclude_any: text[] NOT NULL DEFAULT '{}'::text[]
- is_active: boolean NOT NULL DEFAULT true
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_cost_usage_daily
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- day: date NOT NULL
- provider: text NOT NULL
- model_name: text NOT NULL
- generations: int NOT NULL DEFAULT 0
- images_generated: int NOT NULL DEFAULT 0
- total_cost_usd: numeric(14,6) NOT NULL DEFAULT 0
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_dataset_runs
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- id: bigserial PRIMARY KEY
- run_type: text NOT NULL DEFAULT 'daily_refresh' CHECK (run_type IN ('daily_refresh','manual_refresh','clustering','captioning'))
- status: text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed'))
- summary_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- error_text: text NULL
- started_at: timestamptz NULL
- ended_at: timestamptz NULL
- requested_by: uuid NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_generation_log
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- user_id: uuid NULL
- prompt_raw: text NOT NULL
- prompt_rewritten: text NULL
- category: text NOT NULL
- cluster_id: integer NULL REFERENCES public.tgis_cluster_registry(cluster_id) ON DELETE SET NULL
- model_base: text NULL
- lora_version: text NULL
- fal_request_id: text NULL
- provider: text NOT NULL DEFAULT 'fal.ai'
- model_name: text NOT NULL DEFAULT 'fal-ai/z-image/turbo/lora'
- variants: int NOT NULL DEFAULT 4
- images_json: jsonb NOT NULL DEFAULT '[]'::jsonb
- latency_ms: int NULL
- cost_usd: numeric(12,6) NOT NULL DEFAULT 0
- error_text: text NULL
- status: text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','success','failed','blocked','quota_exceeded'))
- metadata_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_model_versions
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- id: bigserial PRIMARY KEY
- cluster_id: integer NOT NULL REFERENCES public.tgis_cluster_registry(cluster_id) ON DELETE CASCADE
- version: text NOT NULL
- lora_fal_path: text NOT NULL
- artifact_uri: text NULL
- quality_gate_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- status: text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','candidate','active','archived','failed'))
- promoted_by: uuid NULL
- promoted_at: timestamptz NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_prompt_rewrite_log
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- id: bigserial PRIMARY KEY
- generation_id: uuid NULL REFERENCES public.tgis_generation_log(id) ON DELETE CASCADE
- user_id: uuid NULL
- prompt_raw: text NOT NULL
- prompt_rewritten: text NOT NULL
- category: text NOT NULL
- cluster_id: integer NULL
- provider: text NOT NULL DEFAULT 'openrouter'
- model_name: text NOT NULL DEFAULT 'openai/gpt-4o-mini'
- created_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_prompt_templates
Fonte: supabase/migrations/20260303170000_tgis_nano_banana_v1.sql
- cluster_slug: text PRIMARY KEY
- template_text: text NOT NULL
- is_active: boolean NOT NULL DEFAULT true
- updated_by: uuid NULL
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_reference_images
Fonte: supabase/migrations/20260302083000_tgis_fal_trainer_i2i.sql
- cluster_id: int NOT NULL REFERENCES public.tgis_cluster_registry(cluster_id) ON DELETE CASCADE
- tag_group: text NOT NULL
- rank: int NOT NULL CHECK (rank >= 1 AND rank <= 20)
- link_code: text NOT NULL
- image_url: text NOT NULL
- quality_score: numeric(12,6) NOT NULL DEFAULT 0
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_runtime_config
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- config_key: text PRIMARY KEY
- max_generations_per_user_per_day: int NOT NULL DEFAULT 50
- max_variants_per_generation: int NOT NULL DEFAULT 4
- global_daily_budget_usd: numeric(12,2) NOT NULL DEFAULT 25.00
- default_generation_cost_usd: numeric(12,6) NOT NULL DEFAULT 0.007000
- circuit_breaker_error_rate: numeric(6,4) NOT NULL DEFAULT 0.3500
- openrouter_model: text NOT NULL DEFAULT 'openai/gpt-4o-mini'
- fal_model: text NOT NULL DEFAULT 'fal-ai/z-image/turbo/lora'
- rewrite_temperature: numeric(6,4) NOT NULL DEFAULT 0.40
- rewrite_max_tokens: int NOT NULL DEFAULT 220
- beta_closed: boolean NOT NULL DEFAULT true
- training_enabled: boolean NOT NULL DEFAULT false
- updated_by: uuid NULL
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_skin_usage_daily
Fonte: supabase/migrations/20260303170000_tgis_nano_banana_v1.sql
- date: date NOT NULL
- skin_id: text NOT NULL
- count: bigint NOT NULL DEFAULT 0
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_skin_vision_cache
Fonte: supabase/migrations/20260303213000_tgis_skin_vision_cache.sql
- skin_id: text PRIMARY KEY
- skin_name: text NOT NULL
- image_url: text NOT NULL
- vision_text: text NOT NULL
- model_name: text NOT NULL DEFAULT 'openai/gpt-4o'
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_skins_catalog
Fonte: supabase/migrations/20260303224500_tgis_skins_catalog.sql
- skin_id: text PRIMARY KEY
- name: text NOT NULL
- rarity: text NOT NULL DEFAULT 'unknown'
- image_url: text NOT NULL
- is_active: boolean NOT NULL DEFAULT true
- sync_batch_id: text NULL
- source: text NOT NULL DEFAULT 'fortnite_api'
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_thumb_assets
Fonte: supabase/migrations/20260304123000_tgis_thumb_tools_foundation.sql
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- user_id: uuid NOT NULL
- source_generation_id: uuid NULL REFERENCES public.tgis_generation_log(id) ON DELETE SET NULL
- parent_asset_id: uuid NULL REFERENCES public.tgis_thumb_assets(id) ON DELETE SET NULL
- origin_tool: text NOT NULL
- image_url: text NOT NULL
- width: int NOT NULL
- height: int NOT NULL
- metadata_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_thumb_tool_runs
Fonte: supabase/migrations/20260304123000_tgis_thumb_tools_foundation.sql
- id: bigserial PRIMARY KEY
- asset_id: uuid NULL REFERENCES public.tgis_thumb_assets(id) ON DELETE SET NULL
- user_id: uuid NOT NULL
- tool_name: text NOT NULL
- mode: text NULL
- status: text NOT NULL DEFAULT 'queued'
- provider: text NOT NULL DEFAULT 'fal'
- provider_model: text NULL
- input_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- output_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- latency_ms: int NULL
- cost_usd: numeric NULL
- error_text: text NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- started_at: timestamptz NULL
- ended_at: timestamptz NULL

### public.tgis_training_runs
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- id: bigserial PRIMARY KEY
- cluster_id: integer NULL REFERENCES public.tgis_cluster_registry(cluster_id) ON DELETE SET NULL
- requested_by: uuid NULL
- status: text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed','cancelled'))
- run_mode: text NOT NULL DEFAULT 'manual' CHECK (run_mode IN ('manual','scheduled','dry_run'))
- model_base: text NOT NULL DEFAULT 'Tongyi-MAI/Z-Image-Turbo'
- target_version: text NULL
- quality_gate_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- result_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- error_text: text NULL
- started_at: timestamptz NULL
- ended_at: timestamptz NULL
- created_at: timestamptz NOT NULL DEFAULT now()
- updated_at: timestamptz NOT NULL DEFAULT now()

### public.tgis_worker_heartbeat
Fonte: supabase/migrations/20260228103000_tgis_foundation.sql
- id: bigserial PRIMARY KEY
- worker_host: text NOT NULL
- worker_source: text NOT NULL DEFAULT 'hetzner-cx22'
- ts: timestamptz NOT NULL DEFAULT now()
- cpu_pct: numeric(6,2) NULL
- mem_pct: numeric(6,2) NULL
- disk_pct: numeric(6,2) NULL
- queue_depth: int NOT NULL DEFAULT 0
- metadata_json: jsonb NOT NULL DEFAULT '{}'::jsonb

### public.uploads
Fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- project_id: UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
- user_id: UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
- file_name: TEXT NOT NULL
- file_path: TEXT
- status: TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error'))
- csv_count: INTEGER DEFAULT 0
- warnings: JSONB DEFAULT '[]'::jsonb
- created_at: TIMESTAMPTZ NOT NULL DEFAULT now()

### public.user_roles
Fonte: supabase/migrations/20260214141504_d288c21e-5201-4dd6-a47f-078dbbb1cf6d.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- user_id: UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL
- role: app_role NOT NULL

### public.weekly_reports
Fonte: supabase/migrations/20260214141504_d288c21e-5201-4dd6-a47f-078dbbb1cf6d.sql
- id: UUID PRIMARY KEY DEFAULT gen_random_uuid()
- discover_report_id: UUID REFERENCES public.discover_reports(id) ON DELETE SET NULL
- week_key: TEXT NOT NULL
- date_from: DATE NOT NULL
- date_to: DATE NOT NULL
- status: TEXT NOT NULL DEFAULT 'draft'
- public_slug: TEXT UNIQUE
- title_public: TEXT
- subtitle_public: TEXT
- editor_note: TEXT
- kpis_json: JSONB DEFAULT '{}'
- rankings_json: JSONB DEFAULT '{}'
- sections_json: JSONB DEFAULT '[]'
- ai_sections_json: JSONB DEFAULT '{}'
- editor_sections_json: JSONB DEFAULT '{}'
- published_at: TIMESTAMPTZ
- created_at: TIMESTAMPTZ DEFAULT now()
- updated_at: TIMESTAMPTZ DEFAULT now()

### public.widgetkit_history
Fonte: supabase/migrations/20260305010000_widgetkit_history.sql
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- user_id: uuid NOT NULL DEFAULT auth.uid()
- tool: text NOT NULL CHECK (tool IN ('psd-umg', 'umg-verse'))
- name: text NOT NULL
- data_json: jsonb NOT NULL
- meta_json: jsonb NOT NULL DEFAULT '{}'::jsonb
- created_at: timestamptz NOT NULL DEFAULT now()

## Relações (detectadas por REFERENCES em CREATE TABLE)
- public.profiles -> auth.users (fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql)
- public.projects -> auth.users (fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql)
- public.uploads -> public.projects (fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql)
- public.uploads -> auth.users (fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql)
- public.reports -> public.uploads (fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql)
- public.reports -> public.projects (fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql)
- public.reports -> auth.users (fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql)
- public.chat_messages -> public.reports (fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql)
- public.chat_messages -> auth.users (fonte: supabase/migrations/20260211033736_e44ba8f2-1f73-42da-b033-e6f42d1e57d9.sql)
- public.discover_report_queue -> public.discover_reports (fonte: supabase/migrations/20260214124538_ca5dc773-9a82-4f23-b518-6e7f956dfa43.sql)
- public.discover_report_islands -> public.discover_reports (fonte: supabase/migrations/20260214124538_ca5dc773-9a82-4f23-b518-6e7f956dfa43.sql)
- public.user_roles -> auth.users (fonte: supabase/migrations/20260214141504_d288c21e-5201-4dd6-a47f-078dbbb1cf6d.sql)
- public.weekly_reports -> public.discover_reports (fonte: supabase/migrations/20260214141504_d288c21e-5201-4dd6-a47f-078dbbb1cf6d.sql)
- public.discovery_exposure_ticks -> public.discovery_exposure_targets (fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql)
- public.discovery_exposure_entries_raw -> public.discovery_exposure_ticks (fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql)
- public.discovery_exposure_entries_raw -> public.discovery_exposure_targets (fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql)
- public.discovery_exposure_presence_segments -> public.discovery_exposure_targets (fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql)
- public.discovery_exposure_rank_segments -> public.discovery_exposure_targets (fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql)
- public.discovery_exposure_rollup_daily -> public.discovery_exposure_targets (fonte: supabase/migrations/20260214193000_discovery_exposure_pipeline.sql)
- public.discovery_exposure_ticks -> public.discovery_exposure_targets (fonte: supabase/migrations/20260214213651_2edb44e9-1d09-4643-80c8-3617966f758d.sql)
- public.discovery_exposure_entries_raw -> public.discovery_exposure_ticks (fonte: supabase/migrations/20260214213651_2edb44e9-1d09-4643-80c8-3617966f758d.sql)
- public.discovery_exposure_entries_raw -> public.discovery_exposure_targets (fonte: supabase/migrations/20260214213651_2edb44e9-1d09-4643-80c8-3617966f758d.sql)
- public.discovery_exposure_presence_segments -> public.discovery_exposure_targets (fonte: supabase/migrations/20260214213651_2edb44e9-1d09-4643-80c8-3617966f758d.sql)
- public.discovery_exposure_rank_segments -> public.discovery_exposure_targets (fonte: supabase/migrations/20260214213651_2edb44e9-1d09-4643-80c8-3617966f758d.sql)
- public.discovery_exposure_rollup_daily -> public.discovery_exposure_targets (fonte: supabase/migrations/20260214213651_2edb44e9-1d09-4643-80c8-3617966f758d.sql)
- public.discovery_exposure_link_state -> public.discovery_exposure_targets (fonte: supabase/migrations/20260215023224_dab690e7-2def-4e91-9a87-a85859a4a187.sql)
- public.discovery_exposure_presence_events -> public.discovery_exposure_targets (fonte: supabase/migrations/20260215023224_dab690e7-2def-4e91-9a87-a85859a4a187.sql)
- public.discovery_exposure_presence_events -> public.discovery_exposure_ticks (fonte: supabase/migrations/20260215023224_dab690e7-2def-4e91-9a87-a85859a4a187.sql)
- public.discovery_exposure_link_state -> public.discovery_exposure_targets (fonte: supabase/migrations/20260215101000_discovery_exposure_events_and_link_state.sql)
- public.discovery_exposure_presence_events -> public.discovery_exposure_targets (fonte: supabase/migrations/20260215101000_discovery_exposure_events_and_link_state.sql)
- public.discovery_exposure_presence_events -> public.discovery_exposure_ticks (fonte: supabase/migrations/20260215101000_discovery_exposure_events_and_link_state.sql)
- public.discover_report_rebuild_runs -> public.weekly_reports (fonte: supabase/migrations/20260215235000_v1_close_schema.sql)
- public.discover_report_rebuild_runs -> public.discover_reports (fonte: supabase/migrations/20260215235000_v1_close_schema.sql)
- public.discover_report_rebuild_runs -> public.weekly_reports (fonte: supabase/migrations/20260216005834_01c1d59a-4450-40b0-89f6-3b8d51800874.sql)
- public.discover_report_rebuild_runs -> public.discover_reports (fonte: supabase/migrations/20260216005834_01c1d59a-4450-40b0-89f6-3b8d51800874.sql)
- public.ralph_actions -> public.ralph_runs (fonte: supabase/migrations/20260216123000_ralph_ops_foundation.sql)
- public.ralph_eval_results -> public.ralph_runs (fonte: supabase/migrations/20260216123000_ralph_ops_foundation.sql)
- public.ralph_incidents -> public.ralph_runs (fonte: supabase/migrations/20260216123000_ralph_ops_foundation.sql)
- public.ralph_memory_decisions -> public.ralph_runs (fonte: supabase/migrations/20260218154000_ralph_memory_context.sql)
- public.discovery_panel_intel_snapshot -> public.discovery_exposure_targets (fonte: supabase/migrations/20260226120000_discovery_panel_intel_snapshot.sql)
- public.dppi_feature_store_daily -> public.discovery_exposure_targets (fonte: supabase/migrations/20260227113000_dppi_tables.sql)
- public.dppi_feature_store_hourly -> public.discovery_exposure_targets (fonte: supabase/migrations/20260227113000_dppi_tables.sql)
- public.dppi_labels_entry -> public.discovery_exposure_targets (fonte: supabase/migrations/20260227113000_dppi_tables.sql)
- public.dppi_labels_survival -> public.discovery_exposure_presence_segments (fonte: supabase/migrations/20260227113000_dppi_tables.sql)
- public.dppi_labels_survival -> public.discovery_exposure_targets (fonte: supabase/migrations/20260227113000_dppi_tables.sql)
- public.dppi_predictions -> public.discovery_exposure_targets (fonte: supabase/migrations/20260227113000_dppi_tables.sql)
- public.dppi_survival_predictions -> public.discovery_exposure_targets (fonte: supabase/migrations/20260227113000_dppi_tables.sql)
- public.dppi_opportunities -> public.discovery_exposure_targets (fonte: supabase/migrations/20260227113000_dppi_tables.sql)
- public.tgis_model_versions -> public.tgis_cluster_registry (fonte: supabase/migrations/20260228103000_tgis_foundation.sql)
- public.tgis_generation_log -> public.tgis_cluster_registry (fonte: supabase/migrations/20260228103000_tgis_foundation.sql)
- public.tgis_prompt_rewrite_log -> public.tgis_generation_log (fonte: supabase/migrations/20260228103000_tgis_foundation.sql)
- public.tgis_training_runs -> public.tgis_cluster_registry (fonte: supabase/migrations/20260228103000_tgis_foundation.sql)
- public.tgis_reference_images -> public.tgis_cluster_registry (fonte: supabase/migrations/20260302083000_tgis_fal_trainer_i2i.sql)
- public.tgis_thumb_assets -> public.tgis_generation_log (fonte: supabase/migrations/20260304123000_tgis_thumb_tools_foundation.sql)
- public.tgis_thumb_assets -> public.tgis_thumb_assets (fonte: supabase/migrations/20260304123000_tgis_thumb_tools_foundation.sql)
- public.tgis_thumb_tool_runs -> public.tgis_thumb_assets (fonte: supabase/migrations/20260304123000_tgis_thumb_tools_foundation.sql)
- public.commerce_accounts -> auth.users (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_subscriptions -> auth.users (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_billing_cycles -> auth.users (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_billing_cycles -> public.commerce_subscriptions (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_wallets -> auth.users (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_wallets -> public.commerce_billing_cycles (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_ledger -> auth.users (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_ledger -> public.commerce_billing_cycles (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_tool_usage_attempts -> auth.users (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_pack_purchases -> auth.users (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_abuse_signals -> auth.users (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)
- public.commerce_events -> auth.users (fonte: supabase/migrations/20260312083000_commerce_foundation_v1.sql)

## Queries Críticas
- RPCs usadas em múltiplos pontos: `get_metadata_pipeline_stats`, `get_link_graph_stats`, `get_lookup_pipeline_stats`, `get_ralph_health`, `get_tgis_training_candidates`. (fonte: src/pages/admin/AdminOverview.tsx:692, src/pages/admin/tgis/AdminTgisDataset.tsx:23)
- RPCs de side-effect financeiro: `commerce_admin_adjust_credits`, `commerce_weekly_release_job`, `commerce_reconcile_job`. (fonte: supabase/functions/commerce/index.ts:1428, supabase/functions/commerce/index.ts:1703)
- `x-doc-status: incomplete` para plano de execução/index tuning por query sem banco rodando nesta execução.
