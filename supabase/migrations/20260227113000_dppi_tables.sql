-- DPPI foundation tables

CREATE TABLE IF NOT EXISTS public.dppi_training_dataset_meta (
  id bigserial PRIMARY KEY,
  dataset_type text NOT NULL CHECK (dataset_type IN ('entry','survival','inference')),
  range_start timestamptz NOT NULL,
  range_end timestamptz NOT NULL,
  sample_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('building','ready','failed')),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dppi_feature_store_daily (
  as_of date NOT NULL,
  target_id uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  region text NOT NULL,
  surface_name text NOT NULL,
  panel_name text NOT NULL,
  island_code text NOT NULL,
  feature_ccu_avg double precision NOT NULL DEFAULT 0,
  feature_minutes_exposed int NOT NULL DEFAULT 0,
  feature_appearances int NOT NULL DEFAULT 0,
  feature_entries_24h int NOT NULL DEFAULT 0,
  feature_exits_24h int NOT NULL DEFAULT 0,
  feature_replacements_24h int NOT NULL DEFAULT 0,
  feature_unique_panels_7d int NOT NULL DEFAULT 0,
  feature_favorites_7d int NOT NULL DEFAULT 0,
  feature_recommends_7d int NOT NULL DEFAULT 0,
  features_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (as_of, target_id, panel_name, island_code)
);

CREATE INDEX IF NOT EXISTS dppi_feature_store_daily_lookup_idx
  ON public.dppi_feature_store_daily (region, surface_name, panel_name, as_of DESC);
CREATE INDEX IF NOT EXISTS dppi_feature_store_daily_target_idx
  ON public.dppi_feature_store_daily (target_id, as_of DESC);

CREATE TABLE IF NOT EXISTS public.dppi_feature_store_hourly (
  as_of_bucket timestamptz NOT NULL,
  target_id uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  region text NOT NULL,
  surface_name text NOT NULL,
  panel_name text NOT NULL,
  island_code text NOT NULL,
  ccu_avg double precision NOT NULL DEFAULT 0,
  ccu_max int NOT NULL DEFAULT 0,
  entries_1h int NOT NULL DEFAULT 0,
  exits_1h int NOT NULL DEFAULT 0,
  replacements_1h int NOT NULL DEFAULT 0,
  exposure_minutes_1h double precision NOT NULL DEFAULT 0,
  features_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (as_of_bucket, target_id, panel_name, island_code)
);

CREATE INDEX IF NOT EXISTS dppi_feature_store_hourly_lookup_idx
  ON public.dppi_feature_store_hourly (region, surface_name, panel_name, as_of_bucket DESC);
CREATE INDEX IF NOT EXISTS dppi_feature_store_hourly_target_idx
  ON public.dppi_feature_store_hourly (target_id, as_of_bucket DESC);

CREATE TABLE IF NOT EXISTS public.dppi_labels_entry (
  as_of_bucket timestamptz NOT NULL,
  target_id uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  panel_name text NOT NULL,
  island_code text NOT NULL,
  enter_2h boolean NOT NULL DEFAULT false,
  enter_5h boolean NOT NULL DEFAULT false,
  enter_12h boolean NOT NULL DEFAULT false,
  entered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (as_of_bucket, target_id, panel_name, island_code)
);

CREATE INDEX IF NOT EXISTS dppi_labels_entry_lookup_idx
  ON public.dppi_labels_entry (target_id, panel_name, as_of_bucket DESC);

CREATE TABLE IF NOT EXISTS public.dppi_labels_survival (
  stint_id uuid PRIMARY KEY REFERENCES public.discovery_exposure_presence_segments(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  panel_name text NOT NULL,
  island_code text NOT NULL,
  stint_start timestamptz NOT NULL,
  stint_end timestamptz NOT NULL,
  duration_minutes double precision NOT NULL DEFAULT 0,
  stay_30m boolean NOT NULL DEFAULT false,
  stay_60m boolean NOT NULL DEFAULT false,
  replaced_lt_30m boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dppi_labels_survival_lookup_idx
  ON public.dppi_labels_survival (target_id, panel_name, stint_start DESC);

CREATE TABLE IF NOT EXISTS public.dppi_model_registry (
  id bigserial PRIMARY KEY,
  model_name text NOT NULL,
  model_version text NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('entry','survival')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','training','production_candidate','shadow','production','archived','failed')),
  metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifacts_uri text NULL,
  trained_at timestamptz NULL,
  published_at timestamptz NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_name, model_version)
);

CREATE INDEX IF NOT EXISTS dppi_model_registry_status_idx
  ON public.dppi_model_registry (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.dppi_release_channels (
  channel_name text PRIMARY KEY CHECK (channel_name IN ('shadow','candidate','limited','production')),
  model_name text NULL,
  model_version text NULL,
  notes text NULL,
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.dppi_release_channels (channel_name, notes)
VALUES ('shadow', 'awaiting first model'), ('candidate', 'awaiting first model'), ('limited', 'awaiting first model'), ('production', 'awaiting first model')
ON CONFLICT (channel_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dppi_predictions (
  id bigserial PRIMARY KEY,
  generated_at timestamptz NOT NULL DEFAULT now(),
  as_of_bucket timestamptz NOT NULL,
  target_id uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  region text NOT NULL,
  surface_name text NOT NULL,
  panel_name text NOT NULL,
  island_code text NOT NULL,
  prediction_horizon text NOT NULL CHECK (prediction_horizon IN ('2h','5h','12h')),
  score double precision NOT NULL,
  confidence_bucket text NOT NULL DEFAULT 'low' CHECK (confidence_bucket IN ('low','medium','high')),
  model_name text NULL,
  model_version text NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_id, panel_name, island_code, prediction_horizon, as_of_bucket)
);

CREATE INDEX IF NOT EXISTS dppi_predictions_lookup_idx
  ON public.dppi_predictions (region, surface_name, panel_name, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.dppi_survival_predictions (
  id bigserial PRIMARY KEY,
  generated_at timestamptz NOT NULL DEFAULT now(),
  as_of_bucket timestamptz NOT NULL,
  target_id uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  region text NOT NULL,
  surface_name text NOT NULL,
  panel_name text NOT NULL,
  island_code text NOT NULL,
  prediction_horizon text NOT NULL CHECK (prediction_horizon IN ('30m','60m','replace_lt_30m')),
  score double precision NOT NULL,
  confidence_bucket text NOT NULL DEFAULT 'low' CHECK (confidence_bucket IN ('low','medium','high')),
  model_name text NULL,
  model_version text NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_id, panel_name, island_code, prediction_horizon, as_of_bucket)
);

CREATE TABLE IF NOT EXISTS public.dppi_opportunities (
  id bigserial PRIMARY KEY,
  generated_at timestamptz NOT NULL DEFAULT now(),
  as_of_bucket timestamptz NOT NULL,
  target_id uuid NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  region text NOT NULL,
  surface_name text NOT NULL,
  panel_name text NOT NULL,
  island_code text NOT NULL,
  enter_score_2h double precision NOT NULL DEFAULT 0,
  enter_score_5h double precision NOT NULL DEFAULT 0,
  enter_score_12h double precision NOT NULL DEFAULT 0,
  opening_signal double precision NOT NULL DEFAULT 0,
  pressure_forecast text NOT NULL DEFAULT 'medium' CHECK (pressure_forecast IN ('low','medium','high')),
  confidence_bucket text NOT NULL DEFAULT 'low' CHECK (confidence_bucket IN ('low','medium','high')),
  opportunity_rank int NOT NULL DEFAULT 0,
  model_name text NULL,
  model_version text NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_id, panel_name, island_code)
);

CREATE INDEX IF NOT EXISTS dppi_opportunities_lookup_idx
  ON public.dppi_opportunities (region, surface_name, panel_name, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.dppi_training_log (
  id bigserial PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  ended_at timestamptz NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed','cancelled')),
  model_name text NOT NULL,
  model_version text NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('entry','survival')),
  requested_by uuid NULL,
  worker_host text NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dppi_inference_log (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL,
  target_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_rows int NOT NULL DEFAULT 0,
  failed_rows int NOT NULL DEFAULT 0,
  latency_ms int NULL,
  model_name text NULL,
  model_version text NULL,
  error_text text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dppi_drift_metrics (
  id bigserial PRIMARY KEY,
  measured_at timestamptz NOT NULL DEFAULT now(),
  model_name text NOT NULL,
  model_version text NOT NULL,
  feature_name text NOT NULL,
  psi double precision NULL,
  ks double precision NULL,
  drift_level text NOT NULL DEFAULT 'low' CHECK (drift_level IN ('low','medium','high')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dppi_calibration_metrics (
  id bigserial PRIMARY KEY,
  measured_at timestamptz NOT NULL DEFAULT now(),
  model_name text NOT NULL,
  model_version text NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('entry','survival')),
  prediction_horizon text NOT NULL,
  brier double precision NULL,
  logloss double precision NULL,
  ece double precision NULL,
  calibration_method text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dppi_feedback_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  user_id uuid NULL,
  island_code text NULL,
  panel_name text NULL,
  region text NULL,
  surface_name text NULL,
  event_type text NOT NULL,
  event_value jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.dppi_panel_families (
  panel_name text PRIMARY KEY,
  family_name text NOT NULL,
  weight double precision NOT NULL DEFAULT 1.0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
