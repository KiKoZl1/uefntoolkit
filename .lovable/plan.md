# Plano: Preview do Report, Editor Melhorado e IA em Portugues

## Problemas Identificados

1. **Sem preview antes de publicar** -- O editor admin (`AdminReportEditor`) so permite editar campos de texto, mas nao tem como ver como o report vai ficar para o publico
2. **Editor muito simples** -- Apenas `<Textarea>` basico, sem suporte a imagens, capa, ou formatacao rica
3. **IA gerando em ingles** -- O prompt da edge function `discover-report-ai` instrui explicitamente "Write in English", mas o site esta em portugues
4. **Terminologia incorreta** -- A IA nao sabe traduzir `CreativeDiscoverySurface_Browse` para "Browse" e `CreativeDiscoverySurface_Frontend` para "Discovery"

---

## Solucao em 4 Partes

### Parte 1: Preview do Report no Admin

Adicionar uma aba "Preview" ao lado da aba "Editar" na pagina `AdminReportEditor`. O preview vai reutilizar a mesma logica de renderizacao do `ReportView.tsx` publico, mas sem exigir que o report esteja publicado.

- Adicionar sistema de tabs (Editar | Preview) no `AdminReportEditor`
- Criar componente `ReportPreview` que recebe os dados do `weekly_report` e renderiza exatamente como a pagina publica
- O preview mostra os dados editados em tempo real (titulo, subtitulo, nota editorial, textos editados por secao) com fallback para IA
- Adicionar botao "Salvar" separado do "Publicar" (ja existe, mas garantir que funciona independente)

### Parte 2: Editor Melhorado com Capa e Imagens

- Adicionar campo `cover_image_url` na tabela `weekly_reports` (migracao SQL)
- Componente de upload de imagem de capa usando Storage do Lovable Cloud
  - Criar bucket `report-assets` para armazenar capas
  - Upload direto com preview inline no editor
- Melhorar os editores de texto das secoes:
  - Indicar que suportam Markdown (ja renderiza com ReactMarkdown)
  - Adicionar toolbar basica com dicas de formatacao (bold, italic, links, imagens via URL)
  - Aumentar area do textarea e adicionar preview inline do Markdown
- Exibir capa no ReportView publico e no Preview admin

### Parte 3: IA Escrevendo em Portugues (PT-BR)

Alterar o prompt da edge function `discover-report-ai/index.ts`:

A ai sempre pode escrever em ingles mas nunca devemos usar o texto da a.i DIRETAMENTE NO report o texto da ai deve passar pelo nosso sistema de tradução do site para quando  site tiver sistema de idiomas o texto nos report se atualizarem 

### Parte 4: Corrigir Labels no Frontend

Na funcao `profileLabel` em `ReportView.tsx` (linha 391), ja traduz parcialmente mas precisa garantir consistencia:

- `CreativeDiscoverySurface_Frontend` -> "Discovery"
- `CreativeDiscoverySurface_Browse` -> "Browse"

---

## Detalhes Tecnicos

### Migracao SQL

```text
- ALTER TABLE weekly_reports ADD COLUMN cover_image_url TEXT;
- Criar bucket de storage "report-assets" (publico para leitura)
```

### Arquivos Modificados

1. `supabase/functions/discover-report-ai/index.ts` -- Prompt em PT-BR + terminologia
2. `src/pages/admin/AdminReportEditor.tsx` -- Tabs Editar/Preview, upload de capa, editor melhorado
3. `src/pages/public/ReportView.tsx` -- Exibir capa, garantir label de surfaces
4. Novo componente `src/components/admin/ReportPreview.tsx` -- Renderizacao preview reutilizavel

### Estrutura do Editor Melhorado

```text
+-------------------------------------------+
| [Editar]  [Preview]                       |
+-------------------------------------------+
| Capa: [Upload imagem]  [preview thumb]    |
| Titulo: [________________]                |
| Subtitulo: [________________]             |
| Nota Editorial: [textarea com toolbar]    |
+-------------------------------------------+
| Secao 1: Core Activity                    |
| IA (original): [texto colapsavel]         |
| Editor: [textarea com toolbar markdown]   |
|         [mini preview do markdown]        |
+-------------------------------------------+
| ... (demais secoes)                       |
+-------------------------------------------+
| [Salvar]  [Publicar/Despublicar]          |
+-------------------------------------------+
```

### Mudancas no Prompt da IA

```text
De: "Write in English. Be analytical, not generic."
Para: "Write in English. Be analytical, not generic.
      IMPORTANT terminology rules:
      - Never translate: Discover, Browse, Discovery
      - CreativeDiscoverySurface_Browse = 'Browse'
      - CreativeDiscoverySurface_Frontend = 'Discovery'
      - Keep island names, creator names, and technical terms in Orinal State"
```

### Notas

- O preview usa os mesmos componentes do ReportView publico para garantir fidelidade visual
- O upload de capa usa Storage com URL publica para simplicidade