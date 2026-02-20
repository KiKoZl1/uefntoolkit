# Weekly Pipeline Tuning

Este guia reduz tempo de coleta do `discover-collector` (fase `metrics`) com perfis prontos.

## 1) Aplicar perfil

Safe:

```powershell
scripts\run-set-discover-metrics-profile.bat -Profile safe
```

Balanced (recomendado para começar):

```powershell
scripts\run-set-discover-metrics-profile.bat -Profile balanced
```

Aggressive (usar com monitoramento de 429):

```powershell
scripts\run-set-discover-metrics-profile.bat -Profile aggressive
```

Com `project-ref` explícito:

```powershell
scripts\run-set-discover-metrics-profile.bat -Profile balanced -ProjectRef oixhmbhhkgtpuekvtrzz
```

Preview sem aplicar:

```powershell
scripts\run-set-discover-metrics-profile.bat -Profile aggressive -DryRun
```

## 2) Deploy da função

```powershell
npx supabase@latest functions deploy discover-collector --project-ref oixhmbhhkgtpuekvtrzz
```

## 3) Monitoramento em tempo real

Estado do report ativo:

```sql
select
  id,
  phase,
  progress_pct,
  pending_count,
  processing_count,
  done_count,
  error_count,
  throughput_per_min,
  workers_active,
  case
    when coalesce(throughput_per_min,0) > 0
      then round((coalesce(pending_count,0)::numeric / throughput_per_min), 1)
    else null
  end as eta_minutes
from public.discover_reports
where phase in ('catalog','metrics','finalize','ai')
order by created_at desc
limit 1;
```

Saúde dos cron jobs discover:

```sql
select * from public.admin_recent_discover_cron_runs(30, 100);
```

## 4) Regra prática de ajuste

Se `err_429` ou falhas começarem a subir, reduza para `balanced` ou `safe`.
Se `throughput_per_min` estabilizar e erros ficarem baixos por 20-30 min, pode subir um nível.

## 5) Objetivo esperado

Com perfil `balanced`/`aggressive`, o tempo total tende a cair de muitas horas para poucas horas, dependendo de:
- tamanho da fila (`pending_count`)
- limite real da API da Epic naquele horário
- taxa de retry/rate-limit durante a janela
