#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function asBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function parseList(v, fallback = []) {
  if (!v) return fallback;
  const out = String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return out.length ? out : fallback;
}

function loadDotEnvIfPresent(filePath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2] ?? "";
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function mustEnv(name, fallback = "") {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseArgs(argv) {
  const args = {
    paths: ["docs"],
    includeExt: [".md"],
    maxFiles: 300,
    chunkSize: 1800,
    overlap: 180,
    scope: ["support", "docs"],
    dryRun: false,
    useEmbeddings: true,
    embeddingModel: "text-embedding-3-small",
    importance: 90,
    deactivateExtraChunks: true,
  };

  for (const raw of argv) {
    if (raw.startsWith("--paths=")) args.paths = parseList(raw.slice("--paths=".length), args.paths);
    else if (raw.startsWith("--include-ext=")) args.includeExt = parseList(raw.slice("--include-ext=".length), args.includeExt);
    else if (raw.startsWith("--max-files=")) args.maxFiles = Number(raw.slice("--max-files=".length));
    else if (raw.startsWith("--chunk-size=")) args.chunkSize = Number(raw.slice("--chunk-size=".length));
    else if (raw.startsWith("--overlap=")) args.overlap = Number(raw.slice("--overlap=".length));
    else if (raw.startsWith("--scope=")) args.scope = parseList(raw.slice("--scope=".length), args.scope);
    else if (raw.startsWith("--dry-run=")) args.dryRun = asBool(raw.slice("--dry-run=".length), false);
    else if (raw.startsWith("--use-embeddings=")) args.useEmbeddings = asBool(raw.slice("--use-embeddings=".length), true);
    else if (raw.startsWith("--embedding-model=")) args.embeddingModel = raw.slice("--embedding-model=".length);
    else if (raw.startsWith("--importance=")) args.importance = Number(raw.slice("--importance=".length));
    else if (raw.startsWith("--deactivate-extra-chunks=")) args.deactivateExtraChunks = asBool(raw.slice("--deactivate-extra-chunks=".length), true);
  }

  if (!Number.isFinite(args.maxFiles) || args.maxFiles < 1) args.maxFiles = 300;
  if (!Number.isFinite(args.chunkSize) || args.chunkSize < 400) args.chunkSize = 1800;
  if (!Number.isFinite(args.overlap) || args.overlap < 0) args.overlap = 180;
  if (!Number.isFinite(args.importance) || args.importance < 0 || args.importance > 100) args.importance = 90;

  return args;
}

function normalizePath(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function shouldInclude(file, includeExt) {
  const ext = path.extname(file).toLowerCase();
  return includeExt.map((x) => x.toLowerCase()).includes(ext);
}

function walkFiles(root, includeExt, maxFiles) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const cur = stack.pop();
    if (!cur || !fs.existsSync(cur)) continue;
    const st = fs.statSync(cur);
    if (st.isDirectory()) {
      const entries = fs.readdirSync(cur);
      for (const e of entries.reverse()) {
        const next = path.join(cur, e);
        if (e === "node_modules" || e === ".git" || e === "dist" || e.startsWith("scripts/_out")) continue;
        stack.push(next);
      }
    } else if (st.isFile() && shouldInclude(cur, includeExt)) {
      out.push(cur);
    }
  }
  return out;
}

function chunkText(text, chunkSize, overlap) {
  const clean = String(text || "").replace(/\u0000/g, "").trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + chunkSize, clean.length);
    chunks.push(clean.slice(i, end));
    if (end >= clean.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

async function getEmbedding(input, model) {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "text-embedding-3-small",
      input,
    }),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI embeddings error ${res.status}: ${raw.slice(0, 300)}`);
  const json = JSON.parse(raw);
  const emb = json?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) throw new Error("Invalid embedding response");
  return emb;
}

async function fetchExistingHashes(supabase, filePrefix) {
  const { data, error } = await supabase
    .from("ralph_memory_documents")
    .select("doc_key,content_hash")
    .like("doc_key", `${filePrefix}%`)
    .limit(2000);
  if (error) throw new Error(`fetch_existing_hashes_failed:${error.message}`);

  const out = new Map();
  for (const row of data || []) out.set(String(row.doc_key), String(row.content_hash || ""));
  return out;
}

async function deactivateExtraChunksForFile(supabase, filePrefix, keepKeys) {
  const { data, error } = await supabase
    .from("ralph_memory_documents")
    .select("id,doc_key")
    .like("doc_key", `${filePrefix}%`)
    .eq("is_active", true)
    .limit(2000);
  if (error) throw new Error(`fetch_for_deactivate_failed:${error.message}`);

  const staleIds = (data || [])
    .filter((row) => !keepKeys.has(String(row.doc_key)))
    .map((row) => row.id);

  if (!staleIds.length) return 0;
  const { error: updateError } = await supabase
    .from("ralph_memory_documents")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .in("id", staleIds);
  if (updateError) throw new Error(`deactivate_stale_failed:${updateError.message}`);
  return staleIds.length;
}

async function main() {
  loadDotEnvIfPresent();
  const args = parseArgs(process.argv.slice(2));

  const envPaths = parseList(process.env.SUPPORT_RAG_PATHS || "", []);
  if (envPaths.length > 0 && args.paths.length === 1 && args.paths[0] === "docs") {
    args.paths = envPaths;
  }

  const supabaseUrl = mustEnv("SUPABASE_URL", process.env.VITE_SUPABASE_URL || "");
  const serviceRole = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  const roots = args.paths.map((p) => path.resolve(p)).filter((p) => fs.existsSync(p));
  if (!roots.length) throw new Error("No valid --paths found.");

  let files = [];
  for (const root of roots) {
    files = files.concat(walkFiles(root, args.includeExt, args.maxFiles));
    if (files.length >= args.maxFiles) break;
  }
  files = Array.from(new Set(files)).slice(0, args.maxFiles);

  let processedFiles = 0;
  let totalChunks = 0;
  let unchangedChunks = 0;
  let changedChunks = 0;
  let upserts = 0;
  let deactivated = 0;
  let embeddings = 0;
  const errors = [];

  for (const file of files) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const normalized = normalizePath(path.relative(process.cwd(), file));
    const chunks = chunkText(text, args.chunkSize, args.overlap);
    if (!chunks.length) continue;
    processedFiles += 1;
    totalChunks += chunks.length;

    const filePrefix = `file:${normalized}:chunk:`;
    let existingByKey = new Map();
    try {
      existingByKey = await fetchExistingHashes(supabase, filePrefix);
    } catch (error) {
      errors.push({
        file: normalized,
        stage: "fetch_existing",
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const keepKeys = new Set();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const docKey = `file:${normalized}:chunk:${i + 1}`;
      const hash = sha1(chunk);
      keepKeys.add(docKey);

      if (existingByKey.get(docKey) === hash) {
        unchangedChunks += 1;
        continue;
      }

      changedChunks += 1;
      const metadata = {
        path: normalized,
        chunk_index: i + 1,
        chunks_total: chunks.length,
        ingested_at: new Date().toISOString(),
        sync_mode: "incremental",
      };

      let embeddingText = null;
      try {
        if (!args.dryRun && args.useEmbeddings && process.env.OPENAI_API_KEY) {
          const emb = await getEmbedding(chunk, args.embeddingModel);
          embeddingText = JSON.stringify(emb);
          embeddings += 1;
        }

        if (!args.dryRun) {
          const { error } = await supabase.rpc("upsert_ralph_memory_document", {
            p_doc_key: docKey,
            p_doc_type: normalized.endsWith(".md") ? "doc" : "code",
            p_scope: args.scope,
            p_title: `${normalized} [${i + 1}/${chunks.length}]`,
            p_content: chunk,
            p_metadata: metadata,
            p_embedding_text: embeddingText,
            p_source_path: normalized,
            p_content_hash: hash,
            p_importance: args.importance,
            p_token_count: Math.ceil(chunk.length / 4),
            p_is_active: true,
          });
          if (error) throw new Error(error.message);
          upserts += 1;
        }
      } catch (error) {
        errors.push({
          file: normalized,
          chunk: i + 1,
          stage: "upsert",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!args.dryRun && args.deactivateExtraChunks) {
      try {
        deactivated += await deactivateExtraChunksForFile(supabase, filePrefix, keepKeys);
      } catch (error) {
        errors.push({
          file: normalized,
          stage: "deactivate",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.log("Support memory reingest finished.");
  console.log(`- dry_run: ${args.dryRun}`);
  console.log(`- roots: ${roots.map(normalizePath).join(", ")}`);
  console.log(`- files_scanned: ${files.length}`);
  console.log(`- files_processed: ${processedFiles}`);
  console.log(`- chunks_total: ${totalChunks}`);
  console.log(`- chunks_unchanged: ${unchangedChunks}`);
  console.log(`- chunks_changed: ${changedChunks}`);
  console.log(`- embeddings_generated: ${embeddings}`);
  console.log(`- upserts: ${upserts}`);
  console.log(`- deactivated_extra_chunks: ${deactivated}`);
  console.log(`- errors: ${errors.length}`);
  if (errors.length) console.log("- sample_error:", errors[0]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

