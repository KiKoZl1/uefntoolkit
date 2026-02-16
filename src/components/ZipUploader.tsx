import { useState, useCallback, useMemo, useRef } from "react";
import {
  Upload,
  FileArchive,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  FileWarning,
  Rows3,
  Files,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { processZipFile, type ProcessingResult, type ProcessingLog } from "@/lib/parsing/zipProcessor";
import { calculateMetrics, type MetricsResult } from "@/lib/parsing/metricsEngine";

interface ZipUploaderProps {
  onComplete: (result: ProcessingResult, metrics: MetricsResult) => void;
  disabled?: boolean;
}

export default function ZipUploader({ onComplete, disabled }: ZipUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFileSize, setSelectedFileSize] = useState<number | null>(null);
  const [summary, setSummary] = useState<{
    csvCount: number;
    totalRows: number;
    identified: number;
    warnings: number;
    errors: number;
    missingCritical: number;
  } | null>(null);
  const [logFilter, setLogFilter] = useState<"all" | "warning" | "error">("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const maxFileSizeBytes = 200 * 1024 * 1024;

  const handleFile = useCallback(
    async (file: File) => {
      setSelectedFileName(file.name);
      setSelectedFileSize(file.size);
      setSummary(null);

      if (!file.name.toLowerCase().endsWith(".zip")) {
        setLogs([{ type: "error", message: "Apenas arquivos .zip sao aceitos." }]);
        return;
      }

      if (file.size > maxFileSizeBytes) {
        setLogs([
          {
            type: "error",
            message: `Arquivo muito grande (${formatBytes(file.size)}). Limite: ${formatBytes(maxFileSizeBytes)}.`,
          },
        ]);
        return;
      }

      setProcessing(true);
      setLogs([]);
      setProgress(0);

      try {
        const result = await processZipFile(file, (pct, msg) => {
          setProgress(pct);
          setProgressMsg(msg);
        });

        setLogs(result.logs);

        if (Object.keys(result.datasets).length === 0) {
          setProcessing(false);
          return;
        }

        const metrics = calculateMetrics(result.datasets);
        const warningCount = result.logs.filter((log) => log.type === "warning").length;
        const errorCount = result.logs.filter((log) => log.type === "error").length;
        const missingCritical = result.logs.filter((log) => log.message.toLowerCase().includes("dataset esperado")).length;

        setSummary({
          csvCount: result.csvCount,
          totalRows: result.totalRows,
          identified: Object.keys(result.datasets).length,
          warnings: warningCount,
          errors: errorCount,
          missingCritical,
        });

        onComplete(result, metrics);
      } catch (err) {
        setLogs((prev) => [
          ...prev,
          {
            type: "error" as const,
            message: `Erro inesperado: ${err instanceof Error ? err.message : "desconhecido"}`,
          },
        ]);
      } finally {
        setProcessing(false);
      }
    },
    [onComplete]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const logIcon = (type: ProcessingLog["type"]) => {
    switch (type) {
      case "info":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
      case "warning":
        return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
      case "error":
        return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    }
  };

  const filteredLogs = useMemo(() => {
    if (logFilter === "all") return logs;
    return logs.filter((log) => log.type === logFilter);
  }, [logs, logFilter]);

  const reset = () => {
    setLogs([]);
    setSummary(null);
    setSelectedFileName(null);
    setSelectedFileSize(null);
    setProgress(0);
    setProgressMsg("");
    setLogFilter("all");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !processing && !disabled && fileRef.current?.click()}
        className={`
          relative rounded-xl border-2 border-dashed p-8 text-center transition-all cursor-pointer
          ${dragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-muted-foreground/20 hover:border-primary/50"}
          ${processing || disabled ? "opacity-60 pointer-events-none" : ""}
        `}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={onFileChange}
          disabled={processing || disabled}
        />

        {processing ? (
          <div className="space-y-4">
            <Loader2 className="h-10 w-10 mx-auto text-primary animate-spin" />
            <p className="text-sm font-medium">{progressMsg}</p>
            <Progress value={progress} className="max-w-sm mx-auto" />
            <p className="text-xs text-muted-foreground">{progress}% concluido</p>
          </div>
        ) : (
          <>
            <FileArchive className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-display font-semibold text-lg mb-1">Arraste seu ZIP aqui</p>
            <p className="text-sm text-muted-foreground mb-4">ou clique para selecionar o export do Creator Portal</p>
            <Button variant="outline" size="sm" type="button" className="mx-auto">
              <Upload className="h-4 w-4 mr-2" /> Escolher Arquivo
            </Button>
            <p className="text-[11px] text-muted-foreground mt-3">Aceita .zip ate {formatBytes(maxFileSizeBytes)}</p>
          </>
        )}
      </div>

      {(selectedFileName || summary) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Files className="h-3.5 w-3.5" /> CSVs no pacote
              </p>
              <p className="font-display text-xl font-bold mt-1">{summary?.csvCount ?? "--"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Rows3 className="h-3.5 w-3.5" /> Linhas processadas
              </p>
              <p className="font-display text-xl font-bold mt-1">{summary?.totalRows?.toLocaleString("pt-BR") ?? "--"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Datasets identificados
              </p>
              <p className="font-display text-xl font-bold mt-1">{summary?.identified ?? "--"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <FileWarning className="h-3.5 w-3.5 text-amber-500" /> Warnings / Erros
              </p>
              <p className="font-display text-xl font-bold mt-1">{summary ? `${summary.warnings}/${summary.errors}` : "--"}</p>
              {summary && summary.missingCritical > 0 ? (
                <p className="text-[11px] text-amber-500 mt-1">{summary.missingCritical} dataset(s) criticos ausentes</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      {selectedFileName && (
        <Card>
          <CardContent className="pt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Arquivo selecionado</p>
              <p className="text-sm font-medium">{selectedFileName}</p>
              {selectedFileSize != null ? <p className="text-xs text-muted-foreground">{formatBytes(selectedFileSize)}</p> : null}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={processing}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Limpar
            </Button>
          </CardContent>
        </Card>
      )}

      {logs.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Log de processamento</p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant={logFilter === "all" ? "default" : "outline"} onClick={() => setLogFilter("all")}>
                Todos ({logs.length})
              </Button>
              <Button type="button" size="sm" variant={logFilter === "warning" ? "default" : "outline"} onClick={() => setLogFilter("warning")}>
                Warnings ({logs.filter((log) => log.type === "warning").length})
              </Button>
              <Button type="button" size="sm" variant={logFilter === "error" ? "default" : "outline"} onClick={() => setLogFilter("error")}>
                Erros ({logs.filter((log) => log.type === "error").length})
              </Button>
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto text-xs">
              {filteredLogs.map((log, i) => (
                <div key={i} className="flex items-start gap-2">
                  {logIcon(log.type)}
                  <span className={log.type === "error" ? "text-red-500" : ""}>{log.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "--";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}
