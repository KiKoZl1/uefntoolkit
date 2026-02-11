/**
 * ZIP extraction and CSV processing pipeline.
 * Identifies datasets by CONTENT analysis (headers + data), not filenames.
 */
import JSZip from 'jszip';
import Papa from 'papaparse';
import { identifyDatasetByContent, type IdentifiedDataset } from './datasetRegistry';
import { normalizeRow } from './normalize';

export interface ProcessingLog {
  type: 'info' | 'warning' | 'error';
  message: string;
}

export interface ParsedDataset {
  canonical: string;
  category: string;
  label: string;
  fileName: string;
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
  confidence: string;
}

export interface ProcessingResult {
  datasets: Record<string, ParsedDataset>;
  logs: ProcessingLog[];
  csvCount: number;
  totalRows: number;
}

export async function processZipFile(
  file: File,
  onProgress?: (pct: number, msg: string) => void
): Promise<ProcessingResult> {
  const logs: ProcessingLog[] = [];
  const datasets: Record<string, ParsedDataset> = {};
  let totalRows = 0;
  let csvCount = 0;

  onProgress?.(5, 'Lendo arquivo ZIP...');

  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  onProgress?.(15, 'Extraindo CSVs...');

  const csvFiles: { name: string; entry: JSZip.JSZipObject }[] = [];
  zip.forEach((path, entry) => {
    if (
      !entry.dir &&
      path.toLowerCase().endsWith('.csv') &&
      !path.startsWith('__MACOSX') &&
      !path.startsWith('.')
    ) {
      csvFiles.push({ name: path.split('/').pop() || path, entry });
    }
  });

  if (csvFiles.length === 0) {
    logs.push({ type: 'error', message: 'Nenhum arquivo CSV encontrado no ZIP.' });
    return { datasets, logs, csvCount: 0, totalRows: 0 };
  }

  logs.push({ type: 'info', message: `${csvFiles.length} CSV(s) encontrado(s).` });
  csvCount = csvFiles.length;

  for (let i = 0; i < csvFiles.length; i++) {
    const { name, entry } = csvFiles[i];
    const pct = 15 + Math.round((i / csvFiles.length) * 75);
    onProgress?.(pct, `Analisando ${name}...`);

    try {
      const text = await entry.async('text');

      // Detect separator
      const firstLine = text.split('\n')[0] || '';
      const delimiter = firstLine.includes(';') ? ';' : ',';

      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        delimiter,
        skipEmptyLines: true,
      });

      if (parsed.errors.length > 0) {
        logs.push({ type: 'warning', message: `${name}: ${parsed.errors.length} erro(s) de parsing.` });
      }

      const headers = parsed.meta.fields || [];
      const rawRows = parsed.data;

      // Identify by content analysis
      const identified = identifyDatasetByContent(name, headers, rawRows);

      if (!identified) {
        logs.push({ type: 'warning', message: `${name}: não identificado (headers: ${headers.slice(0, 4).join(', ')}...). Ignorado.` });
        continue;
      }

      // If we already have this canonical, only replace if higher confidence
      if (datasets[identified.canonical]) {
        const existing = datasets[identified.canonical];
        const confOrder = { high: 3, medium: 2, low: 1 };
        if ((confOrder[identified.confidence] || 0) <= (confOrder[existing.confidence as keyof typeof confOrder] || 0)) {
          logs.push({ type: 'info', message: `${name}: duplicata de "${identified.label}" (mantendo versão anterior).` });
          continue;
        }
      }

      const normalizedRows = rawRows.map(row => normalizeRow(row));
      const columns = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : [];

      datasets[identified.canonical] = {
        canonical: identified.canonical,
        category: identified.category,
        label: identified.label,
        fileName: name,
        rows: normalizedRows,
        columns,
        rowCount: normalizedRows.length,
        confidence: identified.confidence,
      };

      totalRows += normalizedRows.length;

      const confEmoji = identified.confidence === 'high' ? '✅' : identified.confidence === 'medium' ? '🟡' : '🔸';
      logs.push({
        type: 'info',
        message: `${confEmoji} ${name} → ${identified.label} (${normalizedRows.length} linhas) [${identified.reason}]`,
      });
    } catch (err) {
      logs.push({
        type: 'error',
        message: `${name}: falha ao processar — ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
      });
    }
  }

  onProgress?.(95, 'Finalizando...');

  // Check for expected but missing datasets
  const expectedCritical = ['acq_impressions_total', 'acq_clicks_total', 'eng_playtime_total', 'ret_retention'];
  for (const key of expectedCritical) {
    if (!datasets[key]) {
      logs.push({ type: 'warning', message: `Dataset esperado não encontrado: ${key}.` });
    }
  }

  const identified = Object.keys(datasets).length;
  logs.push({ type: 'info', message: `📊 ${identified}/${csvFiles.length} CSVs identificados com sucesso.` });

  onProgress?.(100, 'Concluído!');
  return { datasets, logs, csvCount, totalRows };
}
