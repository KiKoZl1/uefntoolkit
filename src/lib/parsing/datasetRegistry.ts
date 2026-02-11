/**
 * Dataset Registry — identifies CSVs by analyzing their CONTENT (headers + data),
 * not filenames. This handles any language the Epic panel exports.
 */

export interface DatasetDef {
  canonical: string;
  category: 'acquisition' | 'engagement' | 'retention' | 'surveys' | 'versions';
  label: string;
}

export interface IdentifiedDataset extends DatasetDef {
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

// ── Header normalization ──

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-\/\\().]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function headersContain(headers: string[], ...terms: string[]): boolean {
  const nh = headers.map(norm);
  return terms.every(t => nh.some(h => h.includes(t)));
}

function headersContainAny(headers: string[], ...terms: string[]): boolean {
  const nh = headers.map(norm);
  return terms.some(t => nh.some(h => h.includes(t)));
}

function hasDateColumn(headers: string[]): boolean {
  return headersContainAny(headers, 'date', 'data', 'dia', 'day', 'semana', 'week', 'mes', 'month');
}

function countNumericColumns(headers: string[], firstRow: Record<string, string> | undefined): number {
  if (!firstRow) return 0;
  return headers.filter(h => {
    const v = firstRow[h];
    if (!v) return false;
    const cleaned = v.replace(/[%.,\s]/g, '');
    return /^\d+$/.test(cleaned);
  }).length;
}

// ── Filename hints (secondary, for disambiguation) ──

function fnNorm(fileName: string): string {
  return norm(fileName.replace(/\.csv$/i, ''));
}

function fnContains(fileName: string, ...terms: string[]): boolean {
  const fn = fnNorm(fileName);
  return terms.some(t => fn.includes(t));
}

// ── Content-based identification ──

export function identifyDatasetByContent(
  fileName: string,
  headers: string[],
  rows: Record<string, string>[]
): IdentifiedDataset | null {
  const nh = headers.map(norm);
  const firstRow = rows[0];
  const fn = fnNorm(fileName);
  const rowCount = rows.length;

  // ═══ CTR / CPI ═══
  // Usually has columns like: date, impressions, clicks, CTR/CPI
  if (
    headersContainAny(headers, 'ctr', 'cpi', 'click per impression', 'clique por impressao') ||
    (headersContainAny(headers, 'impression', 'impressao', 'impressoe') && headersContainAny(headers, 'click', 'clique') && headers.length <= 5)
  ) {
    return { canonical: 'acq_ctr_daily', category: 'acquisition', label: 'CTR Diário', confidence: 'high', reason: 'Headers contain CTR/CPI metrics' };
  }

  // ═══ IMPRESSIONS ═══
  if (headersContainAny(headers, 'impression', 'impressao', 'impressoe', 'diagnostico')) {
    if (headersContainAny(headers, 'source', 'fonte', 'fuente')) {
      return { canonical: 'acq_impressions_source', category: 'acquisition', label: 'Impressões por Fonte', confidence: 'high', reason: 'Impressions + source column' };
    }
    if (headersContainAny(headers, 'country', 'pais', 'paises', 'region')) {
      return { canonical: 'acq_impressions_country', category: 'acquisition', label: 'Impressões por País', confidence: 'high', reason: 'Impressions + country column' };
    }
    if (headersContainAny(headers, 'platform', 'plataforma')) {
      return { canonical: 'acq_impressions_platform', category: 'acquisition', label: 'Impressões por Plataforma', confidence: 'high', reason: 'Impressions + platform column' };
    }
    if (hasDateColumn(headers) && headers.length <= 4) {
      return { canonical: 'acq_impressions_total', category: 'acquisition', label: 'Impressões Totais', confidence: 'high', reason: 'Impressions timeseries (total)' };
    }
    // Fallback: if filename hints at total
    if (fnContains(fileName, 'total')) {
      return { canonical: 'acq_impressions_total', category: 'acquisition', label: 'Impressões Totais', confidence: 'medium', reason: 'Impressions + filename hint "total"' };
    }
  }

  // ═══ CLICKS ═══
  if (headersContainAny(headers, 'click', 'clique')) {
    if (headersContainAny(headers, 'source', 'fonte', 'fuente')) {
      return { canonical: 'acq_clicks_source', category: 'acquisition', label: 'Cliques por Fonte', confidence: 'high', reason: 'Clicks + source column' };
    }
    if (headersContainAny(headers, 'country', 'pais', 'paises', 'region')) {
      return { canonical: 'acq_clicks_country', category: 'acquisition', label: 'Cliques por País', confidence: 'high', reason: 'Clicks + country column' };
    }
    if (headersContainAny(headers, 'platform', 'plataforma')) {
      return { canonical: 'acq_clicks_platform', category: 'acquisition', label: 'Cliques por Plataforma', confidence: 'high', reason: 'Clicks + platform column' };
    }
    if (hasDateColumn(headers) && headers.length <= 4) {
      return { canonical: 'acq_clicks_total', category: 'acquisition', label: 'Cliques Totais', confidence: 'high', reason: 'Clicks timeseries (total)' };
    }
    if (fnContains(fileName, 'total')) {
      return { canonical: 'acq_clicks_total', category: 'acquisition', label: 'Cliques Totais', confidence: 'medium', reason: 'Clicks + filename hint "total"' };
    }
  }

  // ═══ ACTIVE PLAYTIME ═══
  if (headersContainAny(headers, 'playtime', 'tempo de jogo', 'active play', 'tiempo de juego', 'spielzeit')) {
    if (headersContainAny(headers, 'country', 'pais', 'paises')) {
      return { canonical: 'eng_playtime_country', category: 'engagement', label: 'Tempo de Jogo por País', confidence: 'high', reason: 'Playtime + country' };
    }
    if (headersContainAny(headers, 'platform', 'plataforma')) {
      return { canonical: 'eng_playtime_platform', category: 'engagement', label: 'Tempo de Jogo por Plataforma', confidence: 'high', reason: 'Playtime + platform' };
    }
    return { canonical: 'eng_playtime_total', category: 'engagement', label: 'Tempo de Jogo Total', confidence: 'high', reason: 'Playtime timeseries' };
  }

  // ═══ ACTIVE PEOPLE ═══
  if (headersContainAny(headers, 'active people', 'pessoas ativas', 'jugadores activos', 'aktive spieler')) {
    if (headersContainAny(headers, 'country', 'pais', 'paises')) {
      return { canonical: 'eng_active_country', category: 'engagement', label: 'Pessoas Ativas por País', confidence: 'high', reason: 'Active people + country' };
    }
    if (headersContainAny(headers, 'platform', 'plataforma')) {
      return { canonical: 'eng_active_platform', category: 'engagement', label: 'Pessoas Ativas por Plataforma', confidence: 'high', reason: 'Active people + platform' };
    }
    return { canonical: 'eng_active_total', category: 'engagement', label: 'Pessoas Ativas Total', confidence: 'high', reason: 'Active people timeseries' };
  }

  // ═══ QUEUE TIME ═══
  if (headersContainAny(headers, 'queue', 'fila', 'matchmak', 'warteschlange', 'cola')) {
    return { canonical: 'eng_queue_time', category: 'engagement', label: 'Tempo de Fila', confidence: 'high', reason: 'Queue/matchmaking data' };
  }

  // ═══ GAMES / SESSIONS ═══
  if (
    (fnContains(fileName, 'jogos', 'games', 'partida', 'match') && !fnContains(fileName, 'tempo', 'time', 'ativo', 'active')) ||
    (headers.length <= 4 && headersContainAny(headers, 'games', 'jogos', 'partidas', 'matches'))
  ) {
    return { canonical: 'eng_games', category: 'engagement', label: 'Jogos/Partidas', confidence: 'medium', reason: 'Games/matches data' };
  }

  // ═══ SESSION DURATION ═══
  if (
    headersContainAny(headers, 'session duration', 'duracao da sessao', 'duracao sessao', 'session length') ||
    fnContains(fileName, 'duracao', 'session', 'sessao')
  ) {
    return { canonical: 'eng_session_duration', category: 'engagement', label: 'Duração da Sessão', confidence: 'high', reason: 'Session duration data' };
  }

  // ═══ GAME EXPERIENCE / XP ═══
  if (
    headersContainAny(headers, 'xp', 'experience', 'experiencia', 'exp de jogo') ||
    fnContains(fileName, 'exp', 'xp', 'experiencia')
  ) {
    return { canonical: 'eng_xp', category: 'engagement', label: 'Experiência de Jogo', confidence: 'medium', reason: 'XP/experience data' };
  }

  // ═══ EVENTS ═══
  if (headersContainAny(headers, 'event', 'evento')) {
    return { canonical: 'eng_events', category: 'engagement', label: 'Eventos Custom', confidence: 'high', reason: 'Events data' };
  }

  // ═══ NEW VS RETURNING ═══
  if (
    headersContainAny(headers, 'new', 'novo', 'returning', 'retornando', 'nuevo', 'recurrente') ||
    fnContains(fileName, 'novas', 'novos', 'retornando', 'returning', 'new')
  ) {
    return { canonical: 'eng_new_returning', category: 'engagement', label: 'Novos vs Retornando', confidence: 'medium', reason: 'New vs returning players' };
  }

  // ═══ RETENTION ═══
  if (
    headersContainAny(headers, 'retention', 'retencao', 'd1', 'd7', 'retencion') ||
    fnContains(fileName, 'retencao', 'retention', 'retencion')
  ) {
    return { canonical: 'ret_retention', category: 'retention', label: 'Retenção D1/D7', confidence: 'high', reason: 'Retention data' };
  }

  // ═══ SURVEYS: Rating 1-10 ═══
  if (
    headersContainAny(headers, 'rating', 'avaliacao', 'nota', 'puntuacion', 'bewertung', '1 a 10', '1-10') ||
    fnContains(fileName, 'avaliacao', 'rating', '1 a 10', '1-10', 'puntuacion')
  ) {
    // Distinguish summary vs trend vs detail vs benchmark
    if (fnContains(fileName, 'resumo', 'summary', 'resumen')) {
      return { canonical: 'srv_rating_summary', category: 'surveys', label: 'Avaliação Resumo', confidence: 'high', reason: 'Rating summary' };
    }
    if (fnContains(fileName, 'tempo', 'trend', 'longo', 'time', 'ao longo')) {
      // Check if detailed (many columns) or average
      if (fnContains(fileName, 'detalh', 'detail', 'resposta')) {
        return { canonical: 'srv_rating_detail', category: 'surveys', label: 'Avaliação Detalhado', confidence: 'high', reason: 'Rating detailed responses' };
      }
      return { canonical: 'srv_rating_trend', category: 'surveys', label: 'Avaliação Tendência', confidence: 'high', reason: 'Rating trend over time' };
    }
    if (fnContains(fileName, 'compar', 'bench', 'dados')) {
      return { canonical: 'srv_rating_benchmark', category: 'surveys', label: 'Avaliação Benchmark', confidence: 'high', reason: 'Rating benchmark' };
    }
    // Default: try to guess from structure
    if (rowCount <= 12 && headers.length <= 3) {
      return { canonical: 'srv_rating_summary', category: 'surveys', label: 'Avaliação Resumo', confidence: 'medium', reason: 'Small rating table (likely summary)' };
    }
    return { canonical: 'srv_rating_trend', category: 'surveys', label: 'Avaliação Tendência', confidence: 'low', reason: 'Rating data (type unclear)' };
  }

  // ═══ SURVEYS: Fun ═══
  if (
    headersContainAny(headers, 'fun', 'divertiu', 'diversion', 'spass') ||
    fnContains(fileName, 'divertiu', 'fun', 'diversion')
  ) {
    if (fnContains(fileName, 'resumo', 'summary', 'resumen')) {
      return { canonical: 'srv_fun_summary', category: 'surveys', label: 'Diversão Resumo', confidence: 'high', reason: 'Fun summary' };
    }
    if (fnContains(fileName, 'tempo', 'trend', 'longo', 'time', 'ao longo')) {
      return { canonical: 'srv_fun_trend', category: 'surveys', label: 'Diversão Tendência', confidence: 'high', reason: 'Fun trend' };
    }
    if (fnContains(fileName, 'compar', 'bench', 'dados')) {
      return { canonical: 'srv_fun_benchmark', category: 'surveys', label: 'Diversão Benchmark', confidence: 'high', reason: 'Fun benchmark' };
    }
    return { canonical: 'srv_fun_summary', category: 'surveys', label: 'Diversão Resumo', confidence: 'low', reason: 'Fun data (type unclear)' };
  }

  // ═══ SURVEYS: Difficulty ═══
  if (
    headersContainAny(headers, 'difficulty', 'dificuldade', 'dificultad', 'schwierigkeit') ||
    fnContains(fileName, 'dificuldade', 'difficulty', 'dificultad')
  ) {
    if (fnContains(fileName, 'resumo', 'summary', 'resumen')) {
      return { canonical: 'srv_difficulty_summary', category: 'surveys', label: 'Dificuldade Resumo', confidence: 'high', reason: 'Difficulty summary' };
    }
    if (fnContains(fileName, 'tempo', 'trend', 'longo', 'time', 'ao longo')) {
      return { canonical: 'srv_difficulty_trend', category: 'surveys', label: 'Dificuldade Tendência', confidence: 'high', reason: 'Difficulty trend' };
    }
    if (fnContains(fileName, 'compar', 'bench', 'dados')) {
      return { canonical: 'srv_difficulty_benchmark', category: 'surveys', label: 'Dificuldade Benchmark', confidence: 'high', reason: 'Difficulty benchmark' };
    }
    return { canonical: 'srv_difficulty_summary', category: 'surveys', label: 'Dificuldade Resumo', confidence: 'low', reason: 'Difficulty data (type unclear)' };
  }

  // ═══ VERSIONS / CHANGELOG ═══
  if (
    headersContainAny(headers, 'version', 'versao', 'release', 'changelog', 'alteracao', 'cambio') ||
    fnContains(fileName, 'versao', 'version', 'changelog', 'alteracao', 'release')
  ) {
    return { canonical: 'ver_changelog', category: 'versions', label: 'Changelog/Versões', confidence: 'high', reason: 'Version/changelog data' };
  }

  // ═══ FALLBACK: Filename-based for remaining files ═══
  
  // Impressions by platform (filename only)
  if (fnContains(fileName, 'impressao', 'impression') && fnContains(fileName, 'plataforma', 'platform')) {
    return { canonical: 'acq_impressions_platform', category: 'acquisition', label: 'Impressões por Plataforma', confidence: 'medium', reason: 'Filename hints at impressions by platform' };
  }

  // Playtime by filename
  if (fnContains(fileName, 'tempo de jogo', 'playtime', 'play time', 'tiempo de juego')) {
    if (fnContains(fileName, 'pais', 'country', 'countr')) {
      return { canonical: 'eng_playtime_country', category: 'engagement', label: 'Tempo de Jogo por País', confidence: 'medium', reason: 'Filename playtime + country' };
    }
    if (fnContains(fileName, 'plataforma', 'platform')) {
      return { canonical: 'eng_playtime_platform', category: 'engagement', label: 'Tempo de Jogo por Plataforma', confidence: 'medium', reason: 'Filename playtime + platform' };
    }
    return { canonical: 'eng_playtime_total', category: 'engagement', label: 'Tempo de Jogo Total', confidence: 'medium', reason: 'Filename playtime' };
  }

  // Active people by filename
  if (fnContains(fileName, 'pessoas ativas', 'active people', 'jugadores activos')) {
    if (fnContains(fileName, 'pais', 'country')) {
      return { canonical: 'eng_active_country', category: 'engagement', label: 'Pessoas Ativas por País', confidence: 'medium', reason: 'Filename active + country' };
    }
    if (fnContains(fileName, 'plataforma', 'platform')) {
      return { canonical: 'eng_active_platform', category: 'engagement', label: 'Pessoas Ativas por Plataforma', confidence: 'medium', reason: 'Filename active + platform' };
    }
    return { canonical: 'eng_active_total', category: 'engagement', label: 'Pessoas Ativas Total', confidence: 'medium', reason: 'Filename active people' };
  }

  return null;
}
