/**
 * Metrics Engine — calculates derived KPIs and runs heuristics on parsed data.
 */
import type { ParsedDataset } from './zipProcessor';

export interface MetricsResult {
  kpis: Record<string, number | string | null>;
  timeseries: Record<string, { date: string; value: number }[]>;
  rankings: Record<string, { name: string; value: number }[]>;
  distributions: Record<string, { label: string; value: number }[]>;
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

function buildRankingFromPivoted(rows: Record<string, any>[], columns: string[], top = 10) {
  const dateHints = ['date', 'data', 'dia', 'day', 'semana', 'week'];
  const valueCols = columns.filter(c => {
    const cn = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return !dateHints.some(h => cn.includes(h));
  });
  return valueCols.map(col => ({
    name: col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    value: rows.reduce((sum, r) => sum + (typeof r[col] === 'number' ? r[col] : 0), 0),
  })).sort((a, b) => b.value - a.value).slice(0, top);
}

function isPivoted(ds: ParsedDataset): boolean {
  const dateHints = ['date', 'data', 'dia', 'day'];
  const hasDate = ds.columns.some(c => dateHints.some(h => c.toLowerCase().includes(h)));
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

/** Build distribution from summary datasets (label/value pairs) */
function buildDistribution(ds: ParsedDataset | undefined): { label: string; value: number }[] {
  if (!ds || ds.rows.length === 0) return [];
  // Try to find label + value columns
  const cols = ds.columns;
  if (cols.length >= 2) {
    const firstRow = ds.rows[0];
    const labelCol = cols.find(c => typeof firstRow[c] === 'string') || cols[0];
    const valueCol = cols.find(c => c !== labelCol && typeof firstRow[c] === 'number') || cols[1];
    return ds.rows
      .filter(r => r[labelCol] && typeof r[valueCol] === 'number')
      .map(r => ({ label: String(r[labelCol]), value: r[valueCol] as number }));
  }
  return [];
}

// ── Main Engine ──

export function calculateMetrics(datasets: Record<string, ParsedDataset>): MetricsResult {
  const kpis: Record<string, number | string | null> = {};
  const timeseries: Record<string, { date: string; value: number }[]> = {};
  const rankings: Record<string, { name: string; value: number }[]> = {};
  const distributions: Record<string, { label: string; value: number }[]> = {};
  const diagnostics: DiagnosticItem[] = [];

  const findValueCol = (ds: ParsedDataset | undefined, hints: string[]) => {
    if (!ds) return null;
    for (const h of hints) {
      const match = ds.columns.find(c => c.toLowerCase().includes(h));
      if (match) return match;
    }
    if (ds.rows.length > 0) {
      return ds.columns.find(c => c !== 'date' && typeof ds.rows[0][c] === 'number') || null;
    }
    return null;
  };

  const findDateCol = (ds: ParsedDataset): string => {
    return ds.columns.find(c => ['date', 'data'].includes(c.toLowerCase())) || 'date';
  };

  // ── Acquisition ──
  const impTotal = datasets['acq_impressions_total'];
  const clickTotal = datasets['acq_clicks_total'];

  if (impTotal) {
    const valCol = findValueCol(impTotal, ['impressions', 'impressões', 'total', 'value', 'valor']);
    if (valCol) {
      kpis.total_impressions = sumColumn(impTotal.rows, valCol);
      timeseries.impressions = buildTimeseries(impTotal.rows, findDateCol(impTotal), valCol);
    }
  }

  if (clickTotal) {
    const valCol = findValueCol(clickTotal, ['clicks', 'cliques', 'total', 'value', 'valor']);
    if (valCol) {
      kpis.total_clicks = sumColumn(clickTotal.rows, valCol);
      timeseries.clicks = buildTimeseries(clickTotal.rows, findDateCol(clickTotal), valCol);
    }
  }

  if (typeof kpis.total_impressions === 'number' && typeof kpis.total_clicks === 'number' && kpis.total_impressions > 0) {
    kpis.ctr = Number(((kpis.total_clicks as number) / (kpis.total_impressions as number) * 100).toFixed(2));
  }

  // CTR timeseries
  const ctrDs = datasets['acq_ctr_daily'];
  if (ctrDs) {
    const valCol = findValueCol(ctrDs, ['ctr', 'cpi', 'rate', 'taxa']);
    if (valCol) timeseries.ctr = buildTimeseries(ctrDs.rows, findDateCol(ctrDs), valCol);
  }

  // Rankings
  const impSource = datasets['acq_impressions_source'];
  const clickCountry = datasets['acq_clicks_country'];
  const clickPlatform = datasets['acq_clicks_platform'];

  if (impSource) {
    rankings.impressions_by_source = isPivoted(impSource)
      ? buildRankingFromPivoted(impSource.rows, impSource.columns)
      : (() => { const n = impSource.columns.find(c => ['source', 'fonte'].includes(c.toLowerCase())) || impSource.columns[0]; const v = findValueCol(impSource, ['impressions', 'impressões', 'total', 'value']); return n && v ? buildRanking(impSource.rows, n, v) : []; })();
  }
  if (clickCountry) {
    rankings.clicks_by_country = isPivoted(clickCountry)
      ? buildRankingFromPivoted(clickCountry.rows, clickCountry.columns)
      : (() => { const n = clickCountry.columns.find(c => ['country', 'país'].includes(c.toLowerCase())) || clickCountry.columns[0]; const v = findValueCol(clickCountry, ['clicks', 'cliques', 'total', 'value']); return n && v ? buildRanking(clickCountry.rows, n, v) : []; })();
  }
  if (clickPlatform) {
    rankings.clicks_by_platform = isPivoted(clickPlatform)
      ? buildRankingFromPivoted(clickPlatform.rows, clickPlatform.columns)
      : (() => { const n = clickPlatform.columns.find(c => ['platform', 'plataforma'].includes(c.toLowerCase())) || clickPlatform.columns[0]; const v = findValueCol(clickPlatform, ['clicks', 'cliques', 'total', 'value']); return n && v ? buildRanking(clickPlatform.rows, n, v) : []; })();
  }

  // Impression breakdowns (country + platform)
  const impCountry = datasets['acq_impressions_country'];
  const impPlatform = datasets['acq_impressions_platform'];
  if (impCountry) {
    rankings.impressions_by_country = isPivoted(impCountry)
      ? buildRankingFromPivoted(impCountry.rows, impCountry.columns)
      : [];
  }
  if (impPlatform) {
    rankings.impressions_by_platform = isPivoted(impPlatform)
      ? buildRankingFromPivoted(impPlatform.rows, impPlatform.columns)
      : [];
  }

  // Click source
  const clickSource = datasets['acq_clicks_source'];
  if (clickSource) {
    rankings.clicks_by_source = isPivoted(clickSource)
      ? buildRankingFromPivoted(clickSource.rows, clickSource.columns)
      : [];
  }

  // ── Engagement ──
  const playTotal = datasets['eng_playtime_total'];
  const activeTotal = datasets['eng_active_total'];
  const queueTime = datasets['eng_queue_time'];
  const games = datasets['eng_games'];
  const sessionDuration = datasets['eng_session_duration'];
  const newReturning = datasets['eng_new_returning'];

  if (playTotal) {
    const valCol = findValueCol(playTotal, ['playtime', 'tempo', 'active', 'total', 'value']);
    if (valCol) {
      kpis.total_playtime = sumColumn(playTotal.rows, valCol);
      timeseries.playtime = buildTimeseries(playTotal.rows, findDateCol(playTotal), valCol);
    }
  }

  if (activeTotal) {
    const valCol = findValueCol(activeTotal, ['active', 'pessoas', 'people', 'total', 'value']);
    if (valCol) {
      kpis.total_active_people = sumColumn(activeTotal.rows, valCol);
      timeseries.active_people = buildTimeseries(activeTotal.rows, findDateCol(activeTotal), valCol);
    }
  }

  if (typeof kpis.total_playtime === 'number' && typeof kpis.total_active_people === 'number' && kpis.total_active_people > 0) {
    kpis.avg_playtime_per_player = Number(((kpis.total_playtime as number) / (kpis.total_active_people as number)).toFixed(1));
  }

  if (games) {
    const valCol = findValueCol(games, ['games', 'jogos', 'partidas', 'matches', 'total', 'value']);
    if (valCol) {
      kpis.total_games = sumColumn(games.rows, valCol);
      timeseries.games = buildTimeseries(games.rows, findDateCol(games), valCol);
    }
  }

  if (sessionDuration) {
    distributions.session_duration = buildDistribution(sessionDuration);
  }

  if (queueTime) {
    const p95Col = queueTime.columns.find(c => c.toLowerCase().includes('p95') || c.toLowerCase().includes('95'));
    const p75Col = queueTime.columns.find(c => c.toLowerCase().includes('p75') || c.toLowerCase().includes('75'));
    const p25Col = queueTime.columns.find(c => c.toLowerCase().includes('p25') || c.toLowerCase().includes('25'));
    const avgCol = findValueCol(queueTime, ['average', 'média', 'mean', 'avg', 'media']);
    if (p95Col) kpis.queue_p95 = lastValue(queueTime.rows, p95Col);
    if (p75Col) kpis.queue_p75 = lastValue(queueTime.rows, p75Col);
    if (p25Col) kpis.queue_p25 = lastValue(queueTime.rows, p25Col);
    if (avgCol) {
      kpis.queue_avg = lastValue(queueTime.rows, avgCol);
      timeseries.queue_avg = buildTimeseries(queueTime.rows, findDateCol(queueTime), avgCol);
    }
  }

  // Playtime/Active breakdowns
  const playCountry = datasets['eng_playtime_country'];
  const playPlatform = datasets['eng_playtime_platform'];
  const activeCountry = datasets['eng_active_country'];
  const activePlatform = datasets['eng_active_platform'];

  if (playCountry && isPivoted(playCountry)) rankings.playtime_by_country = buildRankingFromPivoted(playCountry.rows, playCountry.columns);
  if (playPlatform && isPivoted(playPlatform)) rankings.playtime_by_platform = buildRankingFromPivoted(playPlatform.rows, playPlatform.columns);
  if (activeCountry && isPivoted(activeCountry)) rankings.active_by_country = buildRankingFromPivoted(activeCountry.rows, activeCountry.columns);
  if (activePlatform && isPivoted(activePlatform)) rankings.active_by_platform = buildRankingFromPivoted(activePlatform.rows, activePlatform.columns);

  if (newReturning) {
    const valCol = findValueCol(newReturning, ['new', 'novo', 'novos']);
    if (valCol) timeseries.new_players = buildTimeseries(newReturning.rows, findDateCol(newReturning), valCol);
  }

  // ── Retention ──
  const retention = datasets['ret_retention'];
  if (retention) {
    const d1Col = retention.columns.find(c => c.toLowerCase().includes('d1') || c.toLowerCase().includes('retention_d1'));
    const d7Col = retention.columns.find(c => c.toLowerCase().includes('d7') || c.toLowerCase().includes('retention_d7'));
    if (d1Col) {
      kpis.retention_d1 = lastValue(retention.rows, d1Col);
      timeseries.retention_d1 = buildTimeseries(retention.rows, findDateCol(retention), d1Col);
    }
    if (d7Col) {
      kpis.retention_d7 = lastValue(retention.rows, d7Col);
      timeseries.retention_d7 = buildTimeseries(retention.rows, findDateCol(retention), d7Col);
    }
  }

  // ── Surveys ──
  const ratingSummary = datasets['srv_rating_summary'];
  const ratingTrend = datasets['srv_rating_trend'];
  const ratingDetail = datasets['srv_rating_detail'];
  const ratingBenchmark = datasets['srv_rating_benchmark'];
  const funSummary = datasets['srv_fun_summary'];
  const funTrend = datasets['srv_fun_trend'];
  const funBenchmark = datasets['srv_fun_benchmark'];
  const diffSummary = datasets['srv_difficulty_summary'];
  const diffTrend = datasets['srv_difficulty_trend'];
  const diffBenchmark = datasets['srv_difficulty_benchmark'];

  if (ratingSummary) distributions.rating_summary = buildDistribution(ratingSummary);
  if (ratingBenchmark) distributions.rating_benchmark = buildDistribution(ratingBenchmark);
  if (funSummary) distributions.fun_summary = buildDistribution(funSummary);
  if (funBenchmark) distributions.fun_benchmark = buildDistribution(funBenchmark);
  if (diffSummary) distributions.difficulty_summary = buildDistribution(diffSummary);
  if (diffBenchmark) distributions.difficulty_benchmark = buildDistribution(diffBenchmark);

  if (ratingTrend) {
    const valCol = findValueCol(ratingTrend, ['rating', 'avaliação', 'nota', 'score', 'value', 'media', 'média']);
    if (valCol) {
      kpis.avg_rating = Number(avgColumn(ratingTrend.rows, valCol).toFixed(1));
      timeseries.rating = buildTimeseries(ratingTrend.rows, findDateCol(ratingTrend), valCol);
    }
  }

  if (funTrend) {
    const valCol = findValueCol(funTrend, ['fun', 'divertiu', 'sim', 'yes', 'value']);
    if (valCol) timeseries.fun = buildTimeseries(funTrend.rows, findDateCol(funTrend), valCol);
  }

  if (diffTrend) {
    const valCol = findValueCol(diffTrend, ['difficulty', 'dificuldade', 'value', 'media', 'média']);
    if (valCol) timeseries.difficulty = buildTimeseries(diffTrend.rows, findDateCol(diffTrend), valCol);
  }

  // ── Changelog ──
  const changelog = datasets['ver_changelog'];
  if (changelog) {
    // Store raw changelog data for display
    distributions.changelog = changelog.rows.map(r => {
      const label = Object.values(r).find(v => typeof v === 'string' && v.length > 5) as string || 'Version';
      const value = 0;
      return { label, value };
    });
  }

  // ── Diagnostics ──
  if (typeof kpis.ctr === 'number') {
    if (kpis.ctr < 2) {
      diagnostics.push({ priority: 'P0', area: 'Aquisição', title: 'CTR muito baixo', description: 'O CTR está abaixo de 2%, indicando que a thumbnail/título não está convertendo impressões em cliques.', evidence: `CTR atual: ${kpis.ctr}%`, action: 'Teste A/B de thumbnails e títulos. Considere imagens mais impactantes e títulos com urgência.' });
    } else if (kpis.ctr > 8) {
      diagnostics.push({ priority: 'P2', area: 'Aquisição', title: 'CTR excelente', description: 'O CTR está acima de 8%, muito acima da média do ecossistema.', evidence: `CTR atual: ${kpis.ctr}%`, action: 'Manter a estratégia de thumbnail/título atual. Focar na retenção.' });
    }
  }

  if (typeof kpis.retention_d1 === 'number') {
    const d1Pct = kpis.retention_d1 > 1 ? kpis.retention_d1 : kpis.retention_d1 * 100;
    if (d1Pct < 15) {
      diagnostics.push({ priority: 'P0', area: 'Retenção', title: 'Retenção D1 crítica', description: 'A retenção D1 está muito baixa, indicando problemas na first-time experience.', evidence: `D1: ${d1Pct.toFixed(1)}%`, action: 'Melhorar onboarding, tutorial e primeiros 5 minutos de gameplay.' });
    }
    if (timeseries.retention_d1) {
      const d1Trend = detectTrend(timeseries.retention_d1);
      if (d1Trend === 'down') {
        diagnostics.push({ priority: 'P1', area: 'Retenção', title: 'D1 em tendência de queda', description: 'A retenção D1 está caindo ao longo do tempo.', evidence: 'Tendência negativa no período analisado.', action: 'Investigar mudanças recentes que possam ter impactado a primeira sessão.' });
      }
    }
  }

  if (typeof kpis.retention_d7 === 'number') {
    const d7Pct = kpis.retention_d7 > 1 ? kpis.retention_d7 : kpis.retention_d7 * 100;
    if (d7Pct < 5) {
      diagnostics.push({ priority: 'P0', area: 'Retenção', title: 'Retenção D7 crítica', description: 'A retenção D7 está muito baixa, indicando falta de meta-loops e razões para voltar.', evidence: `D7: ${d7Pct.toFixed(1)}%`, action: 'Implementar daily quests, streaks, progression systems e content updates regulares.' });
    }
  }

  if (typeof kpis.avg_playtime_per_player === 'number' && typeof kpis.retention_d7 === 'number') {
    const d7Pct = kpis.retention_d7 > 1 ? kpis.retention_d7 : kpis.retention_d7 * 100;
    if (kpis.avg_playtime_per_player > 20 && d7Pct < 8) {
      diagnostics.push({ priority: 'P1', area: 'Engajamento', title: 'Sessão longa mas D7 baixo', description: 'Jogadores jogam bastante quando entram, mas não voltam. Faltam meta-loops.', evidence: `Tempo médio: ${kpis.avg_playtime_per_player}min, D7: ${d7Pct.toFixed(1)}%`, action: 'Adicionar daily quests, battle pass, streaks e notificações de conteúdo novo.' });
    }
  }

  if (typeof kpis.queue_p95 === 'number' && kpis.queue_p95 > 120) {
    diagnostics.push({ priority: 'P1', area: 'Engajamento', title: 'Tempo de fila P95 alto', description: 'O percentil 95 do tempo de fila está alto, causando abandono.', evidence: `P95: ${kpis.queue_p95}s`, action: 'Otimizar matchmaking, considerar bots para preencher lobbies ou reduzir requisitos de players.' });
  }

  if (typeof kpis.avg_rating === 'number' && kpis.avg_rating < 5) {
    diagnostics.push({ priority: 'P1', area: 'Surveys', title: 'Nota média baixa', description: 'A nota média dos jogadores está abaixo de 5/10.', evidence: `Nota: ${kpis.avg_rating}/10`, action: 'Analisar feedback detalhado e corrigir os problemas mais mencionados.' });
  }

  diagnostics.sort((a, b) => a.priority.localeCompare(b.priority));

  return { kpis, timeseries, rankings, distributions, diagnostics };
}
