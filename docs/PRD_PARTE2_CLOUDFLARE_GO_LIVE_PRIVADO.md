# PRD - Parte 2: Cloudflare Privado + Go-Live Controlado

## 1) Contexto

A Parte 1 (split App/Data) foi concluida:
- Discovery + DPPI rodando no Data.
- TGIS + Ralph no App.
- Bridge App->Data em modo fail-closed.
- Cadencia de coleta ajustada.
- Rotina operacional e alertas base implementados.

Pendente para go-live real:
- Publicacao do frontend em Cloudflare com acesso privado.
- DNS final com dominio proprio.
- Controle de acesso (allowlist) antes do beta publico.

Este PRD define a **Parte 2**.

## 2) Objetivo

Colocar a plataforma no ar em modo **privado e seguro**, com dominio final e fluxo de acesso controlado, preservando a arquitetura App/Data ja validada.

## 3) Escopo

### Incluido

1. Configuracao de dominio no Cloudflare.
2. DNS final (apex + `www` + ajustes necessarios).
3. Deploy do frontend em Cloudflare Pages.
4. Protecao com Cloudflare Access (allowlist por e-mail).
5. HTTPS ativo e politicas basicas de seguranca web.
6. No-index ate liberar beta (`X-Robots-Tag`/`robots` conforme estrategia).
7. Smoke tests de acesso privado e funcionamento end-to-end.

### Fora de escopo

1. Mudancas de produto/UI.
2. Beta publico aberto.
3. Mudanca de ownership App/Data (ja fechado na Parte 1).

## 4) Requisitos Funcionais

1. Usuario fora da allowlist nao acessa o app.
2. Usuario na allowlist acessa o app apos autenticacao no Access.
3. Frontend continua consumindo App Supabase normalmente.
4. Rotas criticas Discovery/Lookup seguem respondendo via owner Data.
5. Admin continua funcional com mesmos limites de autorizacao.

## 5) Requisitos Nao Funcionais

1. TLS obrigatorio em todo trafego.
2. Sem exposicao publica acidental durante rollout.
3. Latencia adicional de Access aceitavel para uso interno.
4. Rollback rapido para estado anterior em caso de falha.

## 6) Arquitetura Alvo (Parte 2)

1. `Cloudflare Pages` hospeda frontend.
2. `Cloudflare Access` protege o dominio de app.
3. Frontend -> App Supabase (managed) -> Data Supabase (bridge atual).
4. Sem alteracao de banco/cron na Parte 2.

## 7) Plano de Implementacao

## Fase A - Preparacao

1. Comprar/definir dominio final.
2. Apontar nameservers para Cloudflare.
3. Confirmar variaveis de ambiente de producao do frontend.

## Fase B - Deploy Privado

1. Criar projeto no Cloudflare Pages (branch de producao).
2. Configurar build command/output do frontend.
3. Configurar env vars necessarias no Pages.
4. Publicar primeira versao em URL de preview.
5. Validar smoke basico.

## Fase C - Access + DNS

1. Criar app no Cloudflare Access para dominio final.
2. Definir politica default deny.
3. Criar allowlist inicial de e-mails.
4. Configurar DNS final (`apex`/`www`) para Pages.
5. Validar fluxo completo com e sem allowlist.

## Fase D - Hardening e Validacao

1. Confirmar cabecalhos de seguranca basicos.
2. Confirmar no-index ate liberar beta.
3. Rodar smoke test completo (auth, dashboard, discovery, lookup, admin).
4. Registrar resultado no runbook operacional.

## 8) Criterios de Aceite

1. Dominio final responde com HTTPS valido.
2. Acesso bloqueado para usuario fora da allowlist.
3. Acesso liberado para usuario na allowlist.
4. Fluxos criticos funcionando sem regressao:
   - discovery-island-lookup
   - discovery-island-page
   - discovery-panel-timeline
   - discovery-rails-resolver
5. Admin funcional em modo privado.
6. Nenhuma rota critica devolvendo fallback local.

## 9) Plano de Testes

1. Teste de acesso:
   - usuario autorizado vs nao autorizado.
2. Teste funcional:
   - login, dashboard, discovery, lookup, admin.
3. Teste tecnico:
   - validar `x-backend-owner: data` nas respostas bridged.
4. Teste de resiliencia:
   - indisponibilidade temporaria do Data deve retornar `503 DATA_BRIDGE_UNAVAILABLE`.

## 10) Riscos e Mitigacoes

1. Risco: configuracao DNS incorreta.
   - Mitigacao: janela de corte + checklist + rollback DNS.
2. Risco: bloqueio indevido de usuarios internos.
   - Mitigacao: grupo de allowlist de contingencia + teste com 2 contas antes do corte.
3. Risco: env vars incompletas no Pages.
   - Mitigacao: checklist de env e smoke automatizado pos-deploy.

## 11) Rollback

1. Reverter dominio para endpoint anterior (ou pausar cutover).
2. Desativar/proteger temporariamente Access policy nova.
3. Republicar ultimo build estavel no Pages.
4. Validar novamente login + rotas criticas.

## 12) Dependencias

1. Dominio comprado e disponivel.
2. Conta Cloudflare com permissao de Access/Pages.
3. Credenciais/env de producao revisadas.

## 13) Perguntas em Aberto (para inicio da task)

1. Qual dominio/subdominio final sera usado?
2. Allowlist inicial (lista de e-mails) ja definida?
3. SSO do Access sera Google/Microsoft ou OTP por e-mail?
4. Janela de corte preferida (data/hora)?

## 14) Entregaveis da Task Futura

1. Cloudflare Pages publicado e protegido por Access.
2. DNS final ativo.
3. Checklist de validacao assinado.
4. Atualizacao do runbook com operacao de acesso privado.
