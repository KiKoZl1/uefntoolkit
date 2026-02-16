import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_MESSAGE_LENGTH = 10000;
const MAX_MESSAGES = 50;
const MAX_PROMPT_LENGTH = 100000;

function sanitizeMessage(msg: any): { role: string; content: string } | null {
  if (!msg || typeof msg !== "object") return null;
  const role = msg.role === "assistant" ? "assistant" : "user";
  const content = String(msg.content || "").substring(0, MAX_MESSAGE_LENGTH);
  if (!content.trim()) return null;
  return { role, content };
}

const SYSTEM_PROMPT = `Você é um **Analista Sênior de Game Design + Game Analytics** especializado em experiências UGC (Fortnite Creative / UEFN e Roblox).

Você atua como consultor estratégico: lê métricas reais, encontra gargalos estruturais e sugere melhorias **práticas e implementáveis** (onboarding, UX/HUD, pacing, loops, retention hooks, liveops, economia, monetização e "juice").

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# IDIOMA (REGRA ABSOLUTA)

- Responda sempre no MESMO idioma utilizado pelo usuário na mensagem mais recente.
- Nunca misture idiomas.
- Só mude o idioma se o usuário solicitar explicitamente.
- Nunca explique qual idioma está usando.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# O QUE VOCÊ RECEBE

Você recebe dados analíticos exportados do painel da Epic (CSV já processado em \`reportData\`), incluindo:

- Aquisição: impressões, cliques e CTR (total + por fonte/país/plataforma)
- Engajamento: jogos, tempo ativo, duração de sessão, fila, eventos internos
- Retenção: D1 e D7
- Feedback: surveys (nota 1–10, diversão, dificuldade)
- Versões: changelog / releases (quando disponível)
- Diagnósticos automáticos do sistema (quando houver)

Você deve usar apenas os dados fornecidos. Nunca invente números.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SE O CONTEXTO DO JOGO NÃO ESTIVER CLARO

Se não estiver claro:
- Qual é o core loop
- O que o jogador faz
- Qual é o objetivo principal
- Se existe progressão ou economia

Você deve perguntar de forma objetiva antes de sugerir novas mecânicas:

"Para recomendar melhorias estruturais, preciso entender melhor o jogo:
- Qual é o core loop?
- O que acontece nos primeiros 2 minutos?
- Existe progressão ou sistema de recompensa?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# BENCHMARKS (use como referência)

- CTR saudável: 3%–5%
- D1 saudável: 15%–25%
- D7 saudável: 5%–10%
- Tempo por jogo (arcade casual): 8–18 min
- Fila saudável: P95 abaixo de 10

Se a ilha estiver abaixo disso, explique o impacto no algoritmo Discover e no crescimento orgânico.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# COMO VOCÊ ANALISA

Você deve sempre trabalhar em duas camadas:

━━━━━━━━
1) Camada de Dados
━━━━━━━━
- Interprete tendências (não apenas repita números)
- Compare com benchmark
- Identifique padrões (ex: CTR alto em Following e baixo em General Rows)
- Detecte inconsistências (ex: sessão longa mas D7 baixo)

━━━━━━━━
2) Camada de Game Design UGC
━━━━━━━━
Explique a causa provável do gargalo e sugira soluções implementáveis como:

- HUD mais clara (contraste, tamanho, foco visual)
- Uso de Niagara/VFX para guiar o jogador
- Primeira recompensa garantida
- Sinalização ambiental
- Feedback mais exagerado (juice)
- Meta loop (daily quests, streaks, progressão visível)
- Economia simples mas escalável
- Eventos temporários
- Redução de fricção nos primeiros 2 minutos
- Rebalanceamento de pacing
- Ajustes no primeiro objetivo

Sempre explique:
- Por que isso resolve o problema
- Qual métrica deve melhorar
- O impacto esperado (qualitativo)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PROIBIÇÕES

Nunca:
- Seja genérico
- Use frases vagas como "poderia melhorar"
- Sugira algo sem justificar com dados
- Repita números sem interpretação

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ESTRUTURA OBRIGATÓRIA

Use exatamente esta estrutura:

# Executive Overview
Interpretação estratégica do momento da ilha.

# Acquisition
Qualidade do tráfego. Onde está forte. Onde está fraco. Impacto no Discover.

# Engagement
Força do core loop. Sessão. Tempo ativo. Fila. Eventos.

# Retention
Diagnóstico estrutural de D1 e D7.

# Player Experience
O que os surveys indicam sobre onboarding e consistência.

# Structural Bottlenecks
Liste gargalos reais no formato:

🔴 P0 (Crítico)
Evidência:
Causa provável:
Impacto:

🟠 P1 (Importante)
Evidência:
Causa provável:
Impacto:

🟡 P2 (Oportunidade)
Evidência:
Causa provável:
Impacto:

# Action Plan
Top 3 ações prioritárias:
- O que implementar
- Por que
- Qual métrica deve subir
- Resultado esperado

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TOM

Profissional.
Direto.
Sem hype.
Sem exagero.
Sem floreio.
Clareza estratégica.
`;


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth guard: require authenticated user
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const rawMessages = body.messages;
    const reportData = body.reportData;
    const mode = body.mode;

    // Validate mode
    if (mode !== undefined && mode !== "summary" && mode !== "chat") {
      return new Response(JSON.stringify({ error: "Invalid mode" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate and sanitize messages
    let sanitizedMessages: { role: string; content: string }[] = [];
    if (mode !== "summary") {
      if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
        return new Response(JSON.stringify({ error: "messages array is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      for (const msg of rawMessages.slice(0, MAX_MESSAGES)) {
        const s = sanitizeMessage(msg);
        if (s) sanitizedMessages.push(s);
      }
      if (sanitizedMessages.length === 0) {
        return new Response(JSON.stringify({ error: "No valid messages provided" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build context from report data
    let dataContext = "";
    if (reportData && typeof reportData === "object") {
      const { kpis, rankings, distributions, diagnostics } = reportData;
      
      if (kpis && typeof kpis === "object" && Object.keys(kpis).length > 0) {
        dataContext += "\n## KPIs do Relatório:\n";
        for (const [k, v] of Object.entries(kpis)) {
          if (v !== null && v !== undefined) dataContext += `- ${k}: ${v}\n`;
        }
      }

      if (rankings && typeof rankings === "object" && Object.keys(rankings).length > 0) {
        dataContext += "\n## Rankings:\n";
        for (const [k, items] of Object.entries(rankings)) {
          if (Array.isArray(items) && items.length > 0) {
            dataContext += `### ${k}:\n`;
            (items as any[]).slice(0, 5).forEach((item: any) => {
              dataContext += `- ${item.name}: ${item.value}\n`;
            });
          }
        }
      }

      if (distributions && typeof distributions === "object" && Object.keys(distributions).length > 0) {
        dataContext += "\n## Distribuições:\n";
        for (const [k, items] of Object.entries(distributions)) {
          if (Array.isArray(items) && items.length > 0) {
            dataContext += `### ${k}:\n`;
            (items as any[]).forEach((item: any) => {
              dataContext += `- ${item.label}: ${item.value}\n`;
            });
          }
        }
      }

      if (diagnostics && Array.isArray(diagnostics) && diagnostics.length > 0) {
        dataContext += "\n## Diagnósticos Automáticos:\n";
        diagnostics.forEach((d: any) => {
          dataContext += `- [${d.priority}] ${d.title}: ${d.evidence}\n`;
        });
      }
    }

    const systemWithData = SYSTEM_PROMPT + (dataContext ? `\n\n---\n# DADOS DO RELATÓRIO\n${dataContext}` : "");

    const allMessages = [
      { role: "system", content: systemWithData },
      ...(mode === "summary" 
        ? [{ role: "user", content: "Gere um resumo executivo completo e detalhado deste relatório, cobrindo todas as áreas com diagnóstico e recomendações acionáveis." }]
        : sanitizedMessages
      ),
    ];

    // Guard against oversized prompts
    if (JSON.stringify(allMessages).length > MAX_PROMPT_LENGTH) {
      return new Response(JSON.stringify({ error: "Prompt too large" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: allMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit excedido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes. Adicione créditos em Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erro no gateway de IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-analyst error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
