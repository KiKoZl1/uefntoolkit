import { supabase } from "@/integrations/supabase/client";

type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "not" | "ilike" | "contains";
type SingleMode = "single" | "maybeSingle";

export type DataFilter = {
  op: FilterOp;
  column: string;
  value?: unknown;
  operator?: string;
};

export type DataOrder = {
  column: string;
  ascending?: boolean;
  nullsFirst?: boolean;
};

type SelectPayload = {
  table: string;
  columns?: string;
  filters?: DataFilter[];
  order?: DataOrder[];
  limit?: number;
  single?: SingleMode;
  count?: "exact";
  head?: boolean;
};

type UpdatePayload = {
  table: string;
  values: Record<string, unknown>;
  filters?: DataFilter[];
  returning?: string;
  single?: SingleMode;
};

type DeletePayload = {
  table: string;
  filters?: DataFilter[];
  returning?: string;
  single?: SingleMode;
};

type UpsertPayload = {
  table: string;
  values: Record<string, unknown> | Record<string, unknown>[];
  onConflict?: string;
  ignoreDuplicates?: boolean;
  defaultToNull?: boolean;
  returning?: string;
  single?: SingleMode;
};

type RpcPayload = {
  fn: string;
  args?: Record<string, unknown>;
};

async function invokeDataApi<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("discover-data-api", {
    body: { op, payload },
  });
  if (error) throw new Error(error.message || "discover_data_api_failed");
  if (!data?.success) throw new Error(data?.error || "discover_data_api_failed");
  return data as T;
}

export async function dataSelect<T = unknown>(payload: SelectPayload): Promise<{ data: T; count: number | null }> {
  const res = await invokeDataApi<{ data: T; count: number | null }>("select", payload as unknown as Record<string, unknown>);
  return { data: res.data, count: res.count ?? null };
}

export async function dataUpdate<T = unknown>(payload: UpdatePayload): Promise<{ data: T }> {
  const res = await invokeDataApi<{ data: T }>("update", payload as unknown as Record<string, unknown>);
  return { data: res.data };
}

export async function dataDelete<T = unknown>(payload: DeletePayload): Promise<{ data: T }> {
  const res = await invokeDataApi<{ data: T }>("delete", payload as unknown as Record<string, unknown>);
  return { data: res.data };
}

export async function dataUpsert<T = unknown>(payload: UpsertPayload): Promise<{ data: T }> {
  const res = await invokeDataApi<{ data: T }>("upsert", payload as unknown as Record<string, unknown>);
  return { data: res.data };
}

export async function dataRpc<T = unknown>(payload: RpcPayload): Promise<T> {
  const res = await invokeDataApi<{ data: T }>("rpc", payload as unknown as Record<string, unknown>);
  return res.data;
}

export async function dataPublicReportBundle(slug: string): Promise<any> {
  const res = await invokeDataApi<{ data: any }>("public_report_bundle", { slug });
  return res.data;
}
