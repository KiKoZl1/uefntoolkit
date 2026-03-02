export type DppiConfidenceBucket = "low" | "medium" | "high";
export type DppiPressure = "low" | "medium" | "high";

export type DppiEntryPrediction = {
  generated_at: string;
  as_of_bucket: string;
  target_id: string;
  region: string;
  surface_name: string;
  panel_name: string;
  island_code: string;
  prediction_horizon: "2h" | "5h" | "12h";
  score: number;
  confidence_bucket: DppiConfidenceBucket;
  model_name: string | null;
  model_version: string | null;
  evidence_json: Record<string, unknown>;
};

export type DppiSurvivalPrediction = {
  generated_at: string;
  as_of_bucket: string;
  target_id: string;
  region: string;
  surface_name: string;
  panel_name: string;
  island_code: string;
  prediction_horizon: "30m" | "60m" | "replace_lt_30m";
  score: number;
  confidence_bucket: DppiConfidenceBucket;
  model_name: string | null;
  model_version: string | null;
  evidence_json: Record<string, unknown>;
};

export type DppiOpportunityItem = {
  generated_at: string;
  as_of_bucket: string;
  target_id: string;
  region: string;
  surface_name: string;
  panel_name: string;
  island_code: string;
  enter_score_2h: number;
  enter_score_5h: number;
  enter_score_12h: number;
  opening_signal: number;
  pressure_forecast: DppiPressure;
  confidence_bucket: DppiConfidenceBucket;
  opportunity_rank: number;
  model_name: string | null;
  model_version: string | null;
  evidence_json: Record<string, unknown>;
};

export type DppiModelInfo = {
  model_name: string;
  model_version: string;
  task_type: "entry" | "survival";
  status: string;
  metrics_json: Record<string, unknown>;
  trained_at: string | null;
  published_at: string | null;
};

export type DppiDriftSnapshot = {
  measured_at: string;
  model_name: string;
  model_version: string;
  feature_name: string;
  psi: number | null;
  ks: number | null;
  drift_level: DppiConfidenceBucket;
};

export type DppiCalibrationSnapshot = {
  measured_at: string;
  model_name: string;
  model_version: string;
  task_type: "entry" | "survival";
  prediction_horizon: string;
  brier: number | null;
  logloss: number | null;
  ece: number | null;
  calibration_method: string | null;
};

export type PanelDppiBlock = {
  model_version_used: string | null;
  prediction_generated_at: string | null;
  panel_opening_signal: {
    score_avg: number;
    slots_likely_opening: number;
    pressure_distribution: Record<string, number>;
  };
  panel_pressure_forecast: DppiPressure;
  panel_opportunities: Array<{
    island_code: string;
    rank: number;
    score: { h2: number; h5: number; h12: number };
    opening_signal: number;
    pressure_forecast: DppiPressure;
    confidence_bucket: DppiConfidenceBucket;
    evidence: Record<string, unknown>;
  }>;
};

export type IslandPromotionRadar = {
  model_version_used: string | null;
  prediction_generated_at: string | null;
  headline: {
    panel_name: string;
    score_h2: number;
    opening_signal: number;
    pressure_forecast: DppiPressure;
    confidence_bucket: DppiConfidenceBucket;
  } | null;
  top_panel_opportunities: Array<{
    panel_name: string;
    score: { h2: number; h5: number; h12: number };
    opening_signal: number;
    pressure_forecast: DppiPressure;
    confidence_bucket: DppiConfidenceBucket;
    evidence: Record<string, unknown>;
  }>;
  survival_signals: Array<{
    panel_name: string;
    horizon: string;
    score: number;
    confidence_bucket: DppiConfidenceBucket;
    generated_at: string | null;
  }>;
  attempts: {
    total_14d: number;
    entries_48h: number;
    exits_48h: number;
  };
};

export type DppiAdminOverviewState = {
  overview: Record<string, unknown>;
  inference_recent: Array<Record<string, unknown>>;
  training_recent: Array<Record<string, unknown>>;
  release_channels: Array<Record<string, unknown>>;
  cron_jobs: Array<Record<string, unknown>>;
  as_of: string;
};

