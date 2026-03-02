export type TgisImageVariant = {
  url: string;
  seed: number;
};

export type TgisGenerateRequest = {
  prompt: string;
  category: string;
  variants?: number;
  aspect_ratio?: "16:9";
};

export type TgisGenerateResponse = {
  success: boolean;
  generation_id?: string;
  cluster_id?: number;
  cluster_name?: string;
  model_version?: string | null;
  images?: TgisImageVariant[];
  cost_usd?: number;
  latency_ms?: number;
  rewritten_prompt?: string;
  error?: string;
  reason?: string;
};

export type TgisClusterRegistryRow = {
  cluster_id: number;
  cluster_name: string;
  trigger_word: string;
  categories_json: string[];
  lora_version: string | null;
  lora_fal_path: string | null;
  is_active: boolean;
  updated_at: string;
};

export type TgisModelVersion = {
  id: number;
  cluster_id: number;
  version: string;
  lora_fal_path: string;
  status: "draft" | "candidate" | "active" | "archived" | "failed";
  quality_gate_json: Record<string, unknown>;
  promoted_by: string | null;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TgisTrainingRun = {
  id: number;
  cluster_id: number | null;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  run_mode: "manual" | "scheduled" | "dry_run";
  target_version: string | null;
  error_text: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

export type TgisCostDaily = {
  day: string;
  provider: string;
  model_name: string;
  generations: number;
  images_generated: number;
  total_cost_usd: number;
  updated_at: string;
};
