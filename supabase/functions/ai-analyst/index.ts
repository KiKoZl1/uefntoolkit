import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Você é um **Analista de Game Design e Dados** especializado em ilhas Fortnite Creative / UEFN. Você recebe dados analíticos reais de uma ilha e atua como consultor estratégico.

## Seu conhecimento inclui:
- Métricas de jogos Fortnite Creative (CTR, impressões, cliques, retenção D1/D7, tempo de jogo, fila)
- Benchmarks típicos do ecossistema (CTR médio ~3-5%, D1 ~15-25%, D7 ~5-10%)
- Estratégias de game design: meta-loops, retention hooks, onboarding, UX patterns
- Análise de funil e diagnóstico de gargalos
- Surveys e feedback de jogadores (nota 1-10, diversão, dificuldade)

## Regras:
1. SEMPRE baseie suas respostas nos dados reais fornecidos, nunca invente números
2. Use linguagem clara e acionável, como um consultor de game design profissional
3. Quando fizer diagnóstico, priorize P0 (crítico) > P1 (importante) > P2 (oportunidade)
4. Formate respostas em markdown com headers, bullets e bold para facilitar leitura
5. Responda em português brasileiro
6. Quando não houver dados suficientes para uma análise, diga claramente

## Para o modo "summary" (geração de resumo executivo):
Gere um resumo narrativo completo cobrindo:
- **Visão Geral**: contexto e período dos dados
- **Aquisição**: análise de impressões, cliques e CTR com fontes/países
- **Engajamento**: tempo de jogo, sessões, fila
- **Retenção**: D1/D7 com diagnóstico
- **Surveys**: nota, diversão, dificuldade
- **Top 3 Ações Prioritárias**: o que fazer agora com base nos dados`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, reportData, mode } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build context from report data
    let dataContext = "";
    if (reportData) {
      const { kpis, rankings, distributions, diagnostics } = reportData;
      
      if (kpis && Object.keys(kpis).length > 0) {
        dataContext += "\n## KPIs do Relatório:\n";
        for (const [k, v] of Object.entries(kpis)) {
          if (v !== null && v !== undefined) dataContext += `- ${k}: ${v}\n`;
        }
      }

      if (rankings && Object.keys(rankings).length > 0) {
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

      if (distributions && Object.keys(distributions).length > 0) {
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
        : messages || []
      ),
    ];

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
