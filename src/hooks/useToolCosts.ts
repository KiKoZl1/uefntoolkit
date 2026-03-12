import { useEffect, useMemo, useState } from "react";
import { CommerceToolCode, DEFAULT_TOOL_COSTS, getToolCost, getToolCostCatalog, ToolCostCatalog } from "@/lib/commerce/toolCosts";

export function useToolCosts() {
  const [catalog, setCatalog] = useState<ToolCostCatalog>(DEFAULT_TOOL_COSTS);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const costs = await getToolCostCatalog();
      if (!cancelled) setCatalog(costs);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const getCost = useMemo(
    () => (toolCode: CommerceToolCode) => getToolCost(toolCode, catalog),
    [catalog],
  );

  return {
    catalog,
    getCost,
  };
}

