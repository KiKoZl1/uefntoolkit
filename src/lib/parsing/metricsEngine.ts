/**
 * Metrics Engine — calculates derived KPIs and runs heuristics on parsed data.
 */
import type { ParsedDataset } from './zipProcessor';

export interface MetricsResult {
  kpis: Record<string, number | string | null>;
  timeseries: Record<string, { date: string; value: number }[]>;
  rankings: Record<string, { name: string; value: number }[]>;
  diagnostics: DiagnosticItem[];
}

export interface DiagnosticItem {
  priority: 'P0' | 'P1' | 'P2';
  area: string;
  title: string;
  description: string;
  evidence: string;
  action: string;
}

// ── Helpers ──

function sumColumn(rows: Record<string, any>[], col: string): number {
  return rows.reduce((s, r) => s + (typeof r[col] === 'number' ? r[col] : 0), 0);
}

function avgColumn(rows: Record<string, any>[], col: string): number {
  const nums = rows.map(r => r[col]).filter(v => typeof v === 'number') as number[];
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function lastValue(rows: Record<string, any>[], col: string): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (typeof rows[i][col] === 'number') return rows[i][col];
  }
  return null;
}

function buildTimeseries(rows: Record<string, any>[], dateCol: string, valueCol: string) {
  return rows
    .filter(r => r[dateCol] && typeof r[valueCol] === 'number')
    .map(r => ({ date: r[dateCol] as string, value: r[valueCol] as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildRanking(rows: Record<string, any>[], nameCol: string, valueCol: string, top = 10) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const name = String(r[nameCol] || 'Desconhecido');
    const val = typeof r[valueCol] === 'number' ? r[valueCol] : 0;
    map.set(name, (map.get(name) || 0) + val);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, top);
}

/**
 * Unpivot a pivoted dataset where category names are column headers.
 * E.g. columns: ["Date", "USA", "Brazil", "UK"] → ranking: [{name:"USA", value:sum}, ...]
 */
function buildRankingFromPivoted(rows: Record<string, any>[], columns: string[], top = 10) {
  const dateHints = ['date', 'data', 'dia', 'day', 'semana', 'week'];
  const valueCols = columns.filter(c => {
    const cn = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return !dateHints.some(h => cn.includes(h));
  });
  
  const totals: { name: string; value: number }[] = valueCols.map(col => ({
    name: col,
    value: rows.reduce((sum, r) => {
      const v = r[col];
      return sum + (typeof v === 'number' ? v : 0);
    }, 0),
  }));
  
  return totals.sort((a, b) => b.value - a.value).slice(0, top);
}

/**
 * Detect if a dataset is pivoted (date col + many numeric category columns).
 */
function isPivoted(ds: ParsedDataset): boolean {
  const dateHints = ['date', 'data', 'dia', 'day'];
  const hasDate = ds.columns.some(c => dateHints.some(h => c.toLowerCase().includes(h)));
  // If no explicit "source"/"country"/"platform" name column, and many columns → pivoted
  const nameHints = ['source', 'fonte', 'country', 'pais', 'país', 'platform', 'plataforma', 'name', 'nome'];
  const hasNameCol = ds.columns.some(c => nameHints.some(h => c.toLowerCase().includes(h)));
  return hasDate && !hasNameCol && ds.columns.length > 3;
}

function detectTrend(ts: { date: string; value: number }[]): 'up' | 'down' | 'stable' {
  if (ts.length < 4) return 'stable';
  const half = Math.floor(ts.length / 2);
  const firstHalf = ts.slice(0, half);
  const secondHalf = ts.slice(half);
  const avgFirst = firstHalf.reduce((s, v) => s + v.value, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v.value, 0) / secondHalf.length;
  const change = (avgSecond - avgFirst) / (avgFirst || 1);
  if (change > 0.05) return 'up';
  if (change < -0.05) return 'down';
  return 'stable';
}

// ── Main Engine ──

export function calculateMetrics(datasets: Record<string, ParsedDataset>): MetricsResult {
  const kpis: Record<string, number | string | null> = {};
  const timeseries: Record<string, { date: string; value: number }[]> = {};
  const rankings: Record<string, { name: string; value: number }[]> = {};
  const diagnostics: DiagnosticItem[] = [];

  // Detect numeric value columns heuristically
  const findValueCol = (ds: ParsedDataset | undefined, hints: string[]) => {
    if (!ds) return null;
    for (const h of hints) {
      const match = ds.columns.find(c => c.toLowerCase().includes(h));
      if (match) return match;
    }
    // Fallback: first numeric column that isn't "date"
    if (ds.rows.length > 0) {
      return ds.columns.find(c => c !== 'date' && typeof ds.rows[0][c] === 'number') || null;
    }
    return null;
  };

  // ── Acquisition ──
  const impTotal = datasets['acq_impressions_total'];
  const clickTotal = datasets['acq_clicks_total'];

  if (impTotal) {
    const valCol = findValueCol(impTotal, ['impressions', 'impressões', 'total', 'value', 'valor']);
    if (valCol) {
      kpis.total_impressions = sumColumn(impTotal.rows, valCol);
      timeseries.impressions = buildTimeseries(impTotal.rows, 'date', valCol);
    }
  }

  if (clickTotal) {
    const valCol = findValueCol(clickTotal, ['clicks', 'cliques', 'total', 'value', 'valor']);
    if (valCol) {
      kpis.total_clicks = sumColumn(clickTotal.rows, valCol);
      timeseries.clicks = buildTimeseries(clickTotal.rows, 'date', valCol);
    }
  }

  if (typeof kpis.total_impressions === 'number' && typeof kpis.total_clicks === 'number' && kpis.total_impressions > 0) {
    kpis.ctr = Number(((kpis.total_clicks as number) / (kpis.total_impressions as number) * 100).toFixed(2));
  }

  // Rankings
  const impSource = datasets['acq_impressions_source'];
  const clickSource = datasets['acq_clicks_source'];
  const clickCountry = datasets['acq_clicks_country'];
  const clickPlatform = datasets['acq_clicks_platform'];

  if (impSource) {
    if (isPivoted(impSource)) {
      rankings.impressions_by_source = buildRankingFromPivoted(impSource.rows, impSource.columns);
    } else {
      const nameCol = impSource.columns.find(c => ['source', 'fonte'].includes(c.toLowerCase())) || impSource.columns[0];
      const valCol = findValueCol(impSource, ['impressions', 'impressões', 'total', 'value']);
      if (nameCol && valCol) rankings.impressions_by_source = buildRanking(impSource.rows, nameCol, valCol);
    }
  }

  if (clickCountry) {
    if (isPivoted(clickCountry)) {
      rankings.clicks_by_country = buildRankingFromPivoted(clickCountry.rows, clickCountry.columns);
    } else {
      const nameCol = clickCountry.columns.find(c => ['country', 'país'].includes(c.toLowerCase())) || clickCountry.columns[0];
      const valCol = findValueCol(clickCountry, ['clicks', 'cliques', 'total', 'value']);
      if (nameCol && valCol) rankings.clicks_by_country = buildRanking(clickCountry.rows, nameCol, valCol);
    }
  }

  if (clickPlatform) {
    if (isPivoted(clickPlatform)) {
      rankings.clicks_by_platform = buildRankingFromPivoted(clickPlatform.rows, clickPlatform.columns);
    } else {
      const nameCol = clickPlatform.columns.find(c => ['platform', 'plataforma'].includes(c.toLowerCase())) || clickPlatform.columns[0];
      const valCol = findValueCol(clickPlatform, ['clicks', 'cliques', 'total', 'value']);
      if (nameCol && valCol) rankings.clicks_by_platform = buildRanking(clickPlatform.rows, nameCol, valCol);
    }
  }

  // ── Engagement ──
  const playTotal = datasets['eng_playtime_total'];
  const activeTotal = datasets['eng_active_total'];
  const queueTime = datasets['eng_queue_time'];

  if (playTotal) {
    const valCol = findValueCol(playTotal, ['playtime', 'tempo', 'active', 'total', 'value']);
    if (valCol) {
      kpis.total_playtime = sumColumn(playTotal.rows, valCol);
      timeseries.playtime = buildTimeseries(playTotal.rows, 'date', valCol);
    }
  }

  if (activeTotal) {
    const valCol = findValueCol(activeTotal, ['active', 'pessoas', 'people', 'total', 'value']);
    if (valCol) {
      kpis.total_active_people = sumColumn(activeTotal.rows, valCol);
      timeseries.active_people = buildTimeseries(activeTotal.rows, 'date', valCol);
    }
  }

  if (typeof kpis.total_playtime === 'number' && typeof kpis.total_active_people === 'number' && kpis.total_active_people > 0) {
    kpis.avg_playtime_per_player = Number(((kpis.total_playtime as number) / (kpis.total_active_people as number)).toFixed(1));
  }

  if (queueTime) {
    const p95Col = queueTime.columns.find(c => c.toLowerCase().includes('p95') || c.toLowerCase().includes('95'));
    const avgCol = findValueCol(queueTime, ['average', 'média', 'mean', 'avg']);
    if (p95Col) kpis.queue_p95 = lastValue(queueTime.rows, p95Col);
    if (avgCol) kpis.queue_avg = lastValue(queueTime.rows, avgCol);
  }

  // ── Retention ──
  const retention = datasets['ret_retention'];
  if (retention) {
    const d1Col = retention.columns.find(c => c.toLowerCase().includes('d1') || c.toLowerCase().includes('retention_d1'));
    const d7Col = retention.columns.find(c => c.toLowerCase().includes('d7') || c.toLowerCase().includes('retention_d7'));
    
    if (d1Col) {
      kpis.retention_d1 = lastValue(retention.rows, d1Col);
      timeseries.retention_d1 = buildTimeseries(retention.rows, 'date', d1Col);
    }
    if (d7Col) {
      kpis.retention_d7 = lastValue(retention.rows, d7Col);
      timeseries.retention_d7 = buildTimeseries(retention.rows, 'date', d7Col);
    }
  }

  // ── Surveys ──
  const ratingTrend = datasets['srv_rating_trend'];
  if (ratingTrend) {
    const valCol = findValueCol(ratingTrend, ['rating', 'avaliação', 'nota', 'score', 'value']);
    if (valCol) {
      kpis.avg_rating = Number(avgColumn(ratingTrend.rows, valCol).toFixed(1));
      timeseries.rating = buildTimeseries(ratingTrend.rows, 'date', valCol);
    }
  }

  // ── Diagnostics (Heuristics Engine) ──
  
  // CTR check
  if (typeof kpis.ctr === 'number') {
    if (kpis.ctr < 2) {
      diagnostics.push({
        priority: 'P0',
        area: 'Aquisição',
        title: 'CTR muito baixo',
        description: 'O CTR está abaixo de 2%, indicando que a thumbnail/título não está convertendo impressões em cliques.',
        evidence: `CTR atual: ${kpis.ctr}%`,
        action: 'Teste A/B de thumbnails e títulos. Considere imagens mais impactantes e títulos com urgência.',
      });
    } else if (kpis.ctr > 8) {
      diagnostics.push({
        priority: 'P2',
        area: 'Aquisição',
        title: 'CTR excelente',
        description: 'O CTR está acima de 8%, muito acima da média do ecossistema.',
        evidence: `CTR atual: ${kpis.ctr}%`,
        action: 'Manter a estratégia de thumbnail/título atual. Focar na retenção.',
      });
    }
  }

  // D1 retention check
  if (typeof kpis.retention_d1 === 'number') {
    const d1Pct = kpis.retention_d1 > 1 ? kpis.retention_d1 : kpis.retention_d1 * 100;
    if (d1Pct < 15) {
      diagnostics.push({
        priority: 'P0',
        area: 'Retenção',
        title: 'Retenção D1 crítica',
        description: 'A retenção D1 está muito baixa, indicando problemas na first-time experience.',
        evidence: `D1: ${d1Pct.toFixed(1)}%`,
        action: 'Melhorar onboarding, tutorial e primeiros 5 minutos de gameplay.',
      });
    }

    if (timeseries.retention_d1) {
      const d1Trend = detectTrend(timeseries.retention_d1);
      if (d1Trend === 'down') {
        diagnostics.push({
          priority: 'P1',
          area: 'Retenção',
          title: 'D1 em tendência de queda',
          description: 'A retenção D1 está caindo ao longo do tempo.',
          evidence: 'Tendência negativa no período analisado.',
          action: 'Investigar mudanças recentes que possam ter impactado a primeira sessão.',
        });
      }
    }
  }

  // D7 retention check
  if (typeof kpis.retention_d7 === 'number') {
    const d7Pct = kpis.retention_d7 > 1 ? kpis.retention_d7 : kpis.retention_d7 * 100;
    if (d7Pct < 5) {
      diagnostics.push({
        priority: 'P0',
        area: 'Retenção',
        title: 'Retenção D7 crítica',
        description: 'A retenção D7 está muito baixa, indicando falta de meta-loops e razões para voltar.',
        evidence: `D7: ${d7Pct.toFixed(1)}%`,
        action: 'Implementar daily quests, streaks, progression systems e content updates regulares.',
      });
    }
  }

  // Session length + low D7
  if (typeof kpis.avg_playtime_per_player === 'number' && typeof kpis.retention_d7 === 'number') {
    const d7Pct = kpis.retention_d7 > 1 ? kpis.retention_d7 : kpis.retention_d7 * 100;
    if (kpis.avg_playtime_per_player > 20 && d7Pct < 8) {
      diagnostics.push({
        priority: 'P1',
        area: 'Engajamento',
        title: 'Sessão longa mas D7 baixo',
        description: 'Jogadores jogam bastante quando entram, mas não voltam. Faltam meta-loops.',
        evidence: `Tempo médio: ${kpis.avg_playtime_per_player}min, D7: ${d7Pct.toFixed(1)}%`,
        action: 'Adicionar daily quests, battle pass, streaks e notificações de conteúdo novo.',
      });
    }
  }

  // Queue time P95 check
  if (typeof kpis.queue_p95 === 'number' && kpis.queue_p95 > 120) {
    diagnostics.push({
      priority: 'P1',
      area: 'Engajamento',
      title: 'Tempo de fila P95 alto',
      description: 'O percentil 95 do tempo de fila está alto, causando abandono.',
      evidence: `P95: ${kpis.queue_p95}s`,
      action: 'Otimizar matchmaking, considerar bots para preencher lobbies ou reduzir requisitos de players.',
    });
  }

  // Sort diagnostics by priority
  diagnostics.sort((a, b) => a.priority.localeCompare(b.priority));

  return { kpis, timeseries, rankings, diagnostics };
}
