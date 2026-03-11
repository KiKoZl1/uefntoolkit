export type IslandChartRange = "1D" | "1W" | "1M" | "ALL";
export type IslandRangeKey = IslandChartRange | "1Y";

export type IslandSeriesPoint = {
  ts: string;
  current: number;
  previous: number | null;
};

export type IslandSeriesBundle = {
  playerCount24h: IslandSeriesPoint[];
  uniquePlayers: IslandSeriesPoint[];
  favorites: IslandSeriesPoint[];
  recommends: IslandSeriesPoint[];
  avgPlaytime: IslandSeriesPoint[];
  totalPlaytime: IslandSeriesPoint[];
  sessions: IslandSeriesPoint[];
};

export type IslandPanelTimelineSegment = {
  start: string;
  end: string;
  rank: number | null;
  minutes: number;
};

export type IslandPanelTimelineRow = {
  panelName: string;
  panelDisplayName: string;
  segments: IslandPanelTimelineSegment[];
};

export type IslandUpdateEvent = {
  ts: string;
  eventType: string;
  oldValue: unknown;
  newValue: unknown;
};

export type IslandPageResponse = {
  meta: {
    islandCode: string;
    title: string;
    imageUrl: string | null;
    creatorCode: string | null;
    category: string | null;
    tags: string[];
    publishedAtEpic: string | null;
    updatedAtEpic: string | null;
  };
  kpisNow: {
    playersNow: number;
    rankNow: number | null;
    peak24h: number;
    peakAllTime: number;
  };
  overview24h: {
    uniquePlayers: number;
    plays: number;
    favorites: number;
    recommends: number;
    minutesPlayed: number;
    avgMinutesPerPlayer: number;
    avgSessionMinutes: number;
    retentionD1: number;
    retentionD7: number;
  };
  overviewAllTime: {
    minutesPlayed: number;
    favorites: number;
    recommends: number;
  };
  platformDistribution?: {
    pc: number;
    console: number;
    mobile: number;
  } | null;
  series: IslandSeriesBundle;
  seriesByRange?: Record<IslandChartRange, IslandSeriesBundle>;
  panelTimeline24h: {
    rows: IslandPanelTimelineRow[];
  };
  updates: {
    events: IslandUpdateEvent[];
    technicalFilteredCount?: number;
    lastMeaningfulUpdateAt: string | null;
  };
  dppi_radar?: {
    model_version_used: string | null;
    prediction_generated_at: string | null;
    headline: {
      panel_name: string;
      score_h2: number;
      opening_signal: number;
      pressure_forecast: string;
      confidence_bucket: string;
    } | null;
    top_panel_opportunities: Array<{
      panel_name: string;
      score: { h2: number; h5: number; h12: number };
      opening_signal: number;
      pressure_forecast: string;
      confidence_bucket: string;
      evidence: Record<string, unknown>;
    }>;
    survival_signals: Array<{
      panel_name: string;
      horizon: string;
      score: number;
      confidence_bucket: string;
      generated_at: string | null;
    }>;
    attempts: {
      total_14d: number;
      entries_48h: number;
      exits_48h: number;
    };
  } | null;
  asOf: string;
  range?: IslandRangeKey;
  cache?: {
    hit: boolean;
    stale: boolean;
    asOf?: string;
  };
};

export type IslandPageSummaryResponse = {
  meta: IslandPageResponse["meta"];
  kpisNow: IslandPageResponse["kpisNow"];
  overview24h: IslandPageResponse["overview24h"];
  overviewAllTime: IslandPageResponse["overviewAllTime"];
  platformDistribution?: IslandPageResponse["platformDistribution"];
  asOf: string;
  cache?: {
    hit: boolean;
    stale: boolean;
    asOf?: string;
  };
  partial?: boolean;
};
