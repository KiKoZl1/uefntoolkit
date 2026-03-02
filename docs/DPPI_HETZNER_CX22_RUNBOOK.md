# DPPI Hetzner CX22 Runbook

Guia operacional para subir o worker Python do DPPI no Hetzner CX22.

## 1) Compra e provisionamento

1. No Hetzner Cloud, criar server `CX22` com:
   - Ubuntu 24.04 LTS
   - Datacenter mais proximo da sua operacao
   - SSH key ja cadastrada
2. Habilitar firewall:
   - `22/tcp` apenas para seu IP
   - (opcional) `443/tcp` para saida/monitoramento
3. Nome sugerido: `dppi-worker-01`.

## 2) Setup inicial no servidor

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git python3.11 python3.11-venv python3-pip build-essential jq
```

## 3) Clonar projeto e preparar venv

```bash
sudo mkdir -p /opt/epic-insight-engine
sudo chown -R $USER:$USER /opt/epic-insight-engine
cd /opt/epic-insight-engine
git clone <SEU_REPO_URL> .

python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r ml/dppi/requirements.txt
```

## 4) Configurar ambiente

```bash
sudo mkdir -p /etc/dppi
sudo cp ml/dppi/deploy/worker.env.example /etc/dppi/worker.env
sudo nano /etc/dppi/worker.env
sudo chmod 600 /etc/dppi/worker.env
```

Variaveis obrigatorias:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`

## 5) Smoke test manual

```bash
cd /opt/epic-insight-engine
source .venv/bin/activate
python ml/dppi/monitoring/worker_heartbeat.py
python ml/dppi/pipelines/worker_tick.py --config ml/dppi/configs/base.yaml --channel production
```

Validar no admin:
- `/admin/dppi` -> bloco `Worker status (Hetzner)` atualizando.

## 6) Habilitar systemd timer

```bash
cd /opt/epic-insight-engine
sudo bash ml/dppi/deploy/install_systemd.sh /opt/epic-insight-engine dppi dppi
```

Verificar:

```bash
systemctl status dppi-worker.timer
systemctl status dppi-worker.service
journalctl -u dppi-worker.service -n 100 --no-pager
tail -n 100 /var/log/dppi/worker.log
```

## 7) Regras de operacao DPPI

1. Treino fica bloqueado ate readiness minimo (60 dias configurado no backend).
2. Worker roda inferencia + drift periodicamente.
3. Promocao de release passa por gates de qualidade/calibracao/drift.
4. Se precisar override, usar `force` apenas com service role e justificativa.

## 8) Rotina de manutencao

### Deploy de atualizacao

```bash
cd /opt/epic-insight-engine
git pull
source .venv/bin/activate
pip install -r ml/dppi/requirements.txt
sudo systemctl restart dppi-worker.timer
```

### Rollback rapido

```bash
cd /opt/epic-insight-engine
git checkout <commit_anterior>
source .venv/bin/activate
pip install -r ml/dppi/requirements.txt
sudo systemctl restart dppi-worker.timer
```

## 9) Checklist de pronto para producao

- [ ] Worker heartbeat aparecendo em `/admin/dppi`
- [ ] `dppi-refresh-batch` cron ativo no Supabase
- [ ] Inference logs crescendo sem erro sistemico
- [ ] Drift metrics sendo escritas periodicamente
- [ ] Gate de training readiness bloqueando antes da janela minima

