#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const VALID_MODES = new Set(["dev", "dataops", "report", "qa", "custom"]);
const VALID_EDIT_MODES = new Set(["off", "propose", "apply"]);
const DEFAULT_ALLOWLIST = ["src/", "index.html", "docs/", "public/"];

function tsStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

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
  return out.length > 0 ? out : fallback;
}

function parseArgs(argv) {
  const args = {
    mode: "qa",
    dryRun: true,
    llmProvider: "none",
    llmModel: "",
    scope: ["csv", "lookup"],
    maxIterations: 3,
    timeoutMinutes: 20,
    budgetUsd: 0,
    tokenBudget: 0,
    gateBuild: false,
    gateTest: false,
    gateLint: false,
    editMode: "off",
    editMaxFiles: 2,
    editAllowlist: [...DEFAULT_ALLOWLIST],
    requireNonMainBranch: true,
    outDir: path.join(process.cwd(), "scripts", "_out", "ralph_local_runner"),
    prompt: "Improve reliability and product quality for CSV and Island Lookup.",
    promptFile: "",
    featureFile: "docs/ralph/feature_backlog.json",
    progressFile: "docs/ralph/progress_log.jsonl",
    targetFiles: [],
    autoMarkFeaturePass: true,
    semanticMatchCount: 8,
    semanticMinImportance: 40,
    semanticUseEmbeddings: true,
    semanticEmbeddingProvider: "auto",
    semanticEmbeddingModel: "text-embedding-3-small",
    maxCandidateFiles: 80,
    applyMinFindChars: 120,
    buildFailureGuardThreshold: 2,
  };

  for (const raw of argv) {
    if (raw.startsWith("--mode=")) args.mode = raw.slice("--mode=".length);
    else if (raw.startsWith("--dry-run=")) args.dryRun = asBool(raw.slice("--dry-run=".length), true);
    else if (raw.startsWith("--llm-provider=")) args.llmProvider = raw.slice("--llm-provider=".length);
    else if (raw.startsWith("--llm-model=")) args.llmModel = raw.slice("--llm-model=".length);
    else if (raw.startsWith("--scope=")) args.scope = parseList(raw.slice("--scope=".length), args.scope);
    else if (raw.startsWith("--max-iterations=")) args.maxIterations = Number(raw.slice("--max-iterations=".length));
    else if (raw.startsWith("--timeout-minutes=")) args.timeoutMinutes = Number(raw.slice("--timeout-minutes=".length));
    else if (raw.startsWith("--budget-usd=")) args.budgetUsd = Number(raw.slice("--budget-usd=".length));
    else if (raw.startsWith("--token-budget=")) args.tokenBudget = Number(raw.slice("--token-budget=".length));
    else if (raw.startsWith("--gate-build=")) args.gateBuild = asBool(raw.slice("--gate-build=".length), false);
    else if (raw.startsWith("--gate-test=")) args.gateTest = asBool(raw.slice("--gate-test=".length), false);
    else if (raw.startsWith("--gate-lint=")) args.gateLint = asBool(raw.slice("--gate-lint=".length), false);
    else if (raw.startsWith("--edit-mode=")) args.editMode = raw.slice("--edit-mode=".length);
    else if (raw.startsWith("--edit-max-files=")) args.editMaxFiles = Number(raw.slice("--edit-max-files=".length));
    else if (raw.startsWith("--edit-allowlist=")) args.editAllowlist = parseList(raw.slice("--edit-allowlist=".length), args.editAllowlist);
    else if (raw.startsWith("--require-non-main-branch=")) args.requireNonMainBranch = asBool(raw.slice("--require-non-main-branch=".length), true);
    else if (raw.startsWith("--out-dir=")) args.outDir = raw.slice("--out-dir=".length);
    else if (raw.startsWith("--prompt=")) args.prompt = raw.slice("--prompt=".length);
    else if (raw.startsWith("--prompt-file=")) args.promptFile = raw.slice("--prompt-file=".length);
    else if (raw.startsWith("--feature-file=")) args.featureFile = raw.slice("--feature-file=".length);
    else if (raw.startsWith("--progress-file=")) args.progressFile = raw.slice("--progress-file=".length);
    else if (raw.startsWith("--target-files=")) args.targetFiles = parseList(raw.slice("--target-files=".length), args.targetFiles);
    else if (raw.startsWith("--auto-mark-feature-pass=")) args.autoMarkFeaturePass = asBool(raw.slice("--auto-mark-feature-pass=".length), true);
    else if (raw.startsWith("--semantic-match-count=")) args.semanticMatchCount = Number(raw.slice("--semantic-match-count=".length));
    else if (raw.startsWith("--semantic-min-importance=")) args.semanticMinImportance = Number(raw.slice("--semantic-min-importance=".length));
    else if (raw.startsWith("--semantic-use-embeddings=")) args.semanticUseEmbeddings = asBool(raw.slice("--semantic-use-embeddings=".length), true);
    else if (raw.startsWith("--semantic-embedding-provider=")) args.semanticEmbeddingProvider = raw.slice("--semantic-embedding-provider=".length);
    else if (raw.startsWith("--semantic-embedding-model=")) args.semanticEmbeddingModel = raw.slice("--semantic-embedding-model=".length);
    else if (raw.startsWith("--max-candidate-files=")) args.maxCandidateFiles = Number(raw.slice("--max-candidate-files=".length));
    else if (raw.startsWith("--apply-min-find-chars=")) args.applyMinFindChars = Number(raw.slice("--apply-min-find-chars=".length));
    else if (raw.startsWith("--build-failure-guard-threshold=")) args.buildFailureGuardThreshold = Number(raw.slice("--build-failure-guard-threshold=".length));
  }

  if (!VALID_MODES.has(args.mode)) args.mode = "custom";
  if (!VALID_EDIT_MODES.has(args.editMode)) args.editMode = "off";
  if (!Number.isFinite(args.maxIterations) || args.maxIterations < 1) args.maxIterations = 3;
  if (!Number.isFinite(args.timeoutMinutes) || args.timeoutMinutes < 1) args.timeoutMinutes = 20;
  if (!Number.isFinite(args.budgetUsd) || args.budgetUsd < 0) args.budgetUsd = 0;
  if (!Number.isFinite(args.tokenBudget) || args.tokenBudget < 0) args.tokenBudget = 0;
  if (!Number.isFinite(args.editMaxFiles) || args.editMaxFiles < 1) args.editMaxFiles = 2;
  if (!Number.isFinite(args.semanticMatchCount) || args.semanticMatchCount < 1) args.semanticMatchCount = 8;
  if (!Number.isFinite(args.semanticMinImportance) || args.semanticMinImportance < 0) args.semanticMinImportance = 40;
  args.semanticEmbeddingProvider = String(args.semanticEmbeddingProvider || "auto").trim().toLowerCase();
  if (!["auto", "openai", "nvidia", "none"].includes(args.semanticEmbeddingProvider)) args.semanticEmbeddingProvider = "auto";
  if (!Number.isFinite(args.maxCandidateFiles) || args.maxCandidateFiles < 10) args.maxCandidateFiles = 80;
  if (!Number.isFinite(args.applyMinFindChars) || args.applyMinFindChars < 40) args.applyMinFindChars = 120;
  if (!Number.isFinite(args.buildFailureGuardThreshold) || args.buildFailureGuardThreshold < 2) args.buildFailureGuardThreshold = 2;

  return args;
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

function resolvePrompt(args) {
  const file = String(args.promptFile || "").trim();
  if (!file) return args.prompt;
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) return args.prompt;
  try {
    const txt = fs.readFileSync(abs, "utf8").trim();
    return txt || args.prompt;
  } catch {
    return args.prompt;
  }
}

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function mustEnv(name, fallback = "") {
  const v = getEnv(name, fallback);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function runShell(command, cwd = process.cwd()) {
  const isWin = process.platform === "win32";
  const exe = isWin ? "powershell.exe" : "bash";
  const cmdArgs = isWin ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-lc", command];
  const started = Date.now();
  const res = spawnSync(exe, cmdArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  return {
    command,
    code: typeof res.status === "number" ? res.status : 1,
    latencyMs: Date.now() - started,
    stdout: String(res.stdout || "").slice(-10000),
    stderr: String(res.stderr || "").slice(-10000),
  };
}

function normalizePath(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function summarizeContextPack(contextPack) {
  if (!contextPack || typeof contextPack !== "object") return "No context pack available.";
  const latest = contextPack.latest_snapshot || {};
  const metrics = latest.metrics || {};
  const items = Array.isArray(contextPack.memory_items) ? contextPack.memory_items : [];
  const alerts = Array.isArray(contextPack.open_alerts) ? contextPack.open_alerts : [];
  const topItems = items.slice(0, 5).map((x) => `- [${x.category}] ${x.summary}`).join("\n");

  return [
    `Context generated_at: ${contextPack.generated_at || "n/a"}`,
    `Snapshot source: ${latest.source || "n/a"} at ${latest.created_at || "n/a"}`,
    `Exposure stale targets: ${metrics.exposure_targets_stale ?? "n/a"}`,
    `Metadata due now: ${metrics.metadata_due_now ?? "n/a"}`,
    `Metadata title coverage %: ${metrics.metadata_coverage_title_pct ?? "n/a"}`,
    `Metadata image coverage %: ${metrics.metadata_coverage_image_pct ?? "n/a"}`,
    `Collections edge coverage %: ${metrics.collections_edges_coverage_pct ?? "n/a"}`,
    `Open alerts: ${alerts.length}`,
    `Top memory items:\n${topItems || "- none"}`,
  ].join("\n");
}

function summarizeSemanticRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "No semantic memory matches.";
  return rows
    .slice(0, 6)
    .map((r) => `- [${r.score}] (${r.doc_type}) ${r.title || r.doc_key}: ${(r.content_excerpt || "").slice(0, 180)}`)
    .join("\n");
}

function readJsonSafe(filePath, fallback = null) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return fallback;
  try {
    const raw = fs.readFileSync(abs, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseJsonlSafe(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return [];
  try {
    return fs
      .readFileSync(abs, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function extractBuildFailureSignature(stderrText) {
  const stderr = String(stderrText || "");
  if (!stderr) return null;
  const lines = stderr.split(/\r?\n/);
  const fileLine =
    lines.find((l) => /src\/.+\.(tsx?|jsx?):\d+:\d+/.test(l)) ||
    lines.find((l) => /file:\s+.+\.(tsx?|jsx?):\d+:\d+/.test(l)) ||
    "";
  const messageLine =
    lines.find((l) => /ERROR:\s+/.test(l)) ||
    lines.find((l) => /Transform failed/.test(l)) ||
    "";
  const normalizedFile = fileLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
  const normalizedMessage = messageLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (!normalizedFile && !normalizedMessage) return null;
  const signature = [normalizedFile, normalizedMessage].filter(Boolean).join(" | ");
  return {
    file: normalizedFile || null,
    message: normalizedMessage || null,
    signature,
  };
}

function evaluateBuildFailureGuard(progressFile, requestedEditMode, threshold = 2) {
  if (requestedEditMode !== "apply") {
    return { forcePropose: false, reason: "not_apply_mode", repeated_count: 0 };
  }
  const rows = parseJsonlSafe(progressFile);
  if (!rows.length) {
    return { forcePropose: false, reason: "no_history", repeated_count: 0 };
  }
  const recent = rows.slice(-20).reverse();
  let repeated = 0;
  let anchor = null;
  for (const row of recent) {
    if (String(row?.status || "") !== "failed") break;
    const sig = String(row?.build_failure_signature || "").trim();
    if (!sig) break;
    if (!anchor) anchor = sig;
    if (sig !== anchor) break;
    repeated += 1;
  }
  if (repeated >= threshold) {
    return {
      forcePropose: true,
      reason: "repeated_build_failure_signature",
      repeated_count: repeated,
      signature: anchor,
    };
  }
  return {
    forcePropose: false,
    reason: "below_threshold",
    repeated_count: repeated,
    signature: anchor,
  };
}

function pickActiveFeature(featureDoc) {
  if (!featureDoc) return null;
  const features = Array.isArray(featureDoc)
    ? featureDoc
    : Array.isArray(featureDoc.features)
      ? featureDoc.features
      : [];
  if (!features.length) return null;
  const pending = features.filter((f) => f && f.passes !== true);
  if (!pending.length) return null;
  pending.sort((a, b) => {
    const pa = Number.isFinite(a?.priority) ? a.priority : 9999;
    const pb = Number.isFinite(b?.priority) ? b.priority : 9999;
    return pa - pb;
  });
  return pending[0];
}

function gateStatusMap(gateResults) {
  const out = new Map();
  for (const g of Array.isArray(gateResults) ? gateResults : []) {
    if (!g?.gate) continue;
    out.set(String(g.gate), Number(g.code) === 0);
  }
  return out;
}

function shouldMarkFeaturePass(args, runEditMode, activeFeature, finalStatus, failed, appliedPatches, gateResults) {
  if (!args.autoMarkFeaturePass) return { ok: false, reason: "auto_mark_disabled" };
  if (!activeFeature?.id) return { ok: false, reason: "no_active_feature" };
  if (failed || finalStatus === "failed") return { ok: false, reason: "run_failed" };
  if (runEditMode !== "apply") return { ok: false, reason: "not_apply_mode" };
  if (appliedPatches <= 0) return { ok: false, reason: "no_applied_patches" };
  if (!args.gateBuild || !args.gateTest) return { ok: false, reason: "required_gates_not_enabled" };

  const gates = gateStatusMap(gateResults);
  if (gates.get("build") !== true) return { ok: false, reason: "build_gate_failed" };
  if (gates.get("test") !== true) return { ok: false, reason: "test_gate_failed" };
  if (args.gateLint && gates.get("lint") !== true) return { ok: false, reason: "lint_gate_failed" };

  return { ok: true, reason: "validated_apply_run" };
}

function markFeaturePass(featureFile, featureId, meta = {}) {
  const abs = path.resolve(featureFile);
  if (!fs.existsSync(abs)) return { updated: false, reason: "feature_file_missing", path: abs };
  let doc = null;
  try {
    doc = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return { updated: false, reason: "feature_file_invalid_json", path: abs };
  }
  if (!doc || !Array.isArray(doc.features)) {
    return { updated: false, reason: "feature_file_missing_features_array", path: abs };
  }
  const idx = doc.features.findIndex((f) => f && f.id === featureId);
  if (idx < 0) return { updated: false, reason: "feature_not_found", path: abs };

  const prev = doc.features[idx];
  if (prev.passes === true) return { updated: false, reason: "already_passed", path: abs, feature: prev };

  doc.features[idx] = {
    ...prev,
    passes: true,
    passed_at: new Date().toISOString(),
    pass_evidence: {
      ...(prev.pass_evidence || {}),
      ...meta,
    },
  };
  fs.writeFileSync(abs, JSON.stringify(doc, null, 2), "utf8");
  return { updated: true, reason: "feature_marked_pass", path: abs, feature: doc.features[idx] };
}

function appendJsonl(filePath, obj) {
  const abs = path.resolve(filePath);
  ensureDir(path.dirname(abs));
  const line = `${JSON.stringify(obj)}\n`;
  fs.appendFileSync(abs, line, "utf8");
}

function collectSourceFiles(maxFiles = 500) {
  const root = path.resolve("src");
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const cur = stack.pop();
    if (!cur || !fs.existsSync(cur)) continue;
    const st = fs.statSync(cur);
    if (st.isDirectory()) {
      const entries = fs.readdirSync(cur);
      for (const e of entries.reverse()) stack.push(path.join(cur, e));
      continue;
    }
    if (!st.isFile()) continue;
    const ext = path.extname(cur).toLowerCase();
    if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) continue;
    out.push(normalizePath(path.relative(process.cwd(), cur)));
  }
  return out;
}

function getCandidateFiles(args, activeFeature, semanticRows) {
  const wanted = new Set(args.scope.map((s) => String(s).toLowerCase()));
  const candidates = new Set();
  const sourceFiles = collectSourceFiles(1200);

  const pushIfExists = (p) => {
    const np = normalizePath(p);
    if (np && fs.existsSync(path.resolve(np))) candidates.add(np);
  };

  for (const p of args.targetFiles || []) pushIfExists(p);
  for (const p of activeFeature?.target_files || []) pushIfExists(p);
  for (const row of Array.isArray(semanticRows) ? semanticRows : []) {
    const p = row?.metadata?.path || row?.source_path;
    if (typeof p === "string") pushIfExists(p);
  }

  const includeByRegex = (regex) => {
    for (const f of sourceFiles) {
      if (regex.test(f)) pushIfExists(f);
      if (candidates.size >= args.maxCandidateFiles) break;
    }
  };

  if (wanted.has("lookup")) includeByRegex(/lookup|island/i);
  if (wanted.has("csv")) includeByRegex(/csv|zip|uploader|metrics|parsing|analytics/i);
  if (wanted.has("report")) includeByRegex(/report|weekly/i);
  if (wanted.has("admin")) includeByRegex(/admin|command/i);
  if (wanted.has("dataops")) includeByRegex(/integrations|supabase|hooks|lib/i);

  if (candidates.size === 0) {
    pushIfExists("src/pages/IslandLookup.tsx");
    pushIfExists("src/components/ZipUploader.tsx");
  }

  return Array.from(candidates).slice(0, args.maxCandidateFiles);
}

function buildPlanPrompt(args, iteration, contextSummary, semanticSummary, activeFeature) {
  const featureBlock = activeFeature
    ? [
        "Active feature from backlog:",
        JSON.stringify(
          {
            id: activeFeature.id || null,
            category: activeFeature.category || null,
            title: activeFeature.title || null,
            description: activeFeature.description || null,
            target_files: activeFeature.target_files || [],
          },
          null,
          2
        ),
      ].join("\n")
    : "Active feature from backlog: none (fallback to best improvement opportunity).";

  return [
    "You are Ralph runner in Epic Insight Engine.",
    `Mode: ${args.mode}`,
    `Iteration: ${iteration}/${args.maxIterations}`,
    `Scope: ${args.scope.join(", ")}`,
    `Goal: ${args.prompt}`,
    "",
    "Operational context pack:",
    contextSummary || "No context pack available.",
    "",
    "Semantic memory matches:",
    semanticSummary || "No semantic memory matches.",
    "",
    featureBlock,
    "Return concise JSON with keys: plan, risks, next_action.",
  ].join("\n");
}

function readCandidateContext(paths, maxCharsPerFile = 5000, maxFiles = 14) {
  const blocks = [];
  for (const p of paths.slice(0, maxFiles)) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) continue;
    let text = "";
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (text.length > maxCharsPerFile) {
      text = `${text.slice(0, maxCharsPerFile)}\n/* ...truncated... */`;
    }
    blocks.push(`FILE: ${normalizePath(p)}\n-----\n${text}\n-----`);
  }
  return blocks.join("\n\n");
}

function buildOpsPrompt(args, iteration, planText, candidateFiles, candidateContext, contextSummary, semanticSummary, activeFeature) {
  const featureBlock = activeFeature
    ? `Active feature: ${activeFeature.title || activeFeature.id || "unnamed"}`
    : "Active feature: none";

  return [
    "You are generating SAFE code edit operations for a React + TypeScript repository.",
    `Iteration ${iteration}/${args.maxIterations}`,
    `Goal: ${args.prompt}`,
    `Plan summary: ${planText || "n/a"}`,
    "",
    "Operational context pack:",
    contextSummary || "No context pack available.",
    "",
    "Semantic memory matches:",
    semanticSummary || "No semantic memory matches.",
    featureBlock,
    `Allowed paths prefixes: ${args.editAllowlist.join(", ")}`,
    `Max files this iteration: ${args.editMaxFiles}`,
    "You must return STRICT VALID JSON only (no markdown, no prose):",
    '{"edits":[{"path":"src/...","find":"exact snippet","replace":"new snippet","reason":"short reason"}]}',
    "Rules:",
    "- path MUST be one of candidate files listed below.",
    "- use exact find snippet from current file content (multiline allowed).",
    "- keep changes small and coherent.",
    "- do not create new files in this mode.",
    "- if no safe edit, return {\"edits\":[]}.",
    "",
    "Candidate files:",
    candidateFiles.map((p) => `- ${p}`).join("\n"),
    "",
    "Current file contents (truncated):",
    candidateContext,
  ].join("\n");
}

function extractJsonObject(text) {
  let t = String(text || "").trim();
  if (!t) return null;
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  try {
    const p = JSON.parse(t);
    if (typeof p === "string") {
      try {
        return JSON.parse(p);
      } catch {
        return null;
      }
    }
    return p;
  } catch {
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const slice = t.slice(first, last + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callOpenAIEmbedding(input, model) {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const m = model || "text-embedding-3-small";
  const endpoint = getEnv("OPENAI_EMBEDDINGS_URL", "https://api.openai.com/v1/embeddings");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: m,
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

async function callNvidiaEmbedding(input, model) {
  const apiKey = mustEnv("NVIDIA_API_KEY");
  const m = model || "baai/bge-m3";
  const endpoint = getEnv("NVIDIA_EMBEDDINGS_URL", "https://integrate.api.nvidia.com/v1/embeddings");
  const configuredInputType = getEnv("NVIDIA_EMBEDDING_INPUT_TYPE", "").trim();

  async function doRequest(inputType) {
    const body = {
      model: m,
      input,
      encoding_format: "float",
    };
    if (inputType) body.input_type = inputType;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    return { res, raw };
  }

  let attempt = await doRequest(configuredInputType || null);
  if (!attempt.res.ok) {
    const low = String(attempt.raw || "").toLowerCase();
    const needsInputType = low.includes("input_type") && low.includes("required");
    // For asymmetric models, NVIDIA requires input_type=query/passage.
    if (needsInputType && !configuredInputType) {
      attempt = await doRequest("query");
    }
  }

  if (!attempt.res.ok) {
    throw new Error(`NVIDIA embeddings error ${attempt.res.status}: ${String(attempt.raw || "").slice(0, 500)}`);
  }

  const json = JSON.parse(attempt.raw);
  const emb = json?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) throw new Error("Invalid NVIDIA embedding response");
  return emb;
}

function resolveEmbeddingProvider(args) {
  const requested = String(args.semanticEmbeddingProvider || "auto").toLowerCase();
  if (requested === "none") return "none";
  if (requested === "openai") return process.env.OPENAI_API_KEY ? "openai" : "none";
  if (requested === "nvidia") return process.env.NVIDIA_API_KEY ? "nvidia" : "none";
  if (process.env.NVIDIA_API_KEY) return "nvidia";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

function resolveEmbeddingModel(provider, configuredModel) {
  const configured = String(configuredModel || "").trim();
  if (!configured) {
    return provider === "nvidia" ? "baai/bge-m3" : "text-embedding-3-small";
  }
  if (provider === "nvidia" && configured === "text-embedding-3-small") {
    return "nvidia/nv-embedqa-e5-v5";
  }
  return configured;
}

async function callSemanticEmbedding(args, input) {
  const provider = resolveEmbeddingProvider(args);
  if (provider === "none") return { provider: "none", model: null, embedding: null };
  const model = resolveEmbeddingModel(provider, args.semanticEmbeddingModel);
  if (provider === "nvidia") {
    const embedding = await callNvidiaEmbedding(input, model);
    return { provider, model, embedding };
  }
  const embedding = await callOpenAIEmbedding(input, model);
  return { provider, model, embedding };
}

function parseEditOps(rawText) {
  const parsed = extractJsonObject(rawText);
  if (!parsed) return [];
  const edits = Array.isArray(parsed) ? parsed : parsed.edits;
  if (!Array.isArray(edits)) return [];
  return edits
    .map((e) => ({
      path: normalizePath(e?.path),
      find: String(e?.find ?? ""),
      replace: String(e?.replace ?? ""),
      reason: String(e?.reason ?? ""),
    }))
    .filter((e) => e.path && e.find);
}

function pathAllowed(p, allowlist) {
  const np = normalizePath(p);
  const blocked = ["package-lock.json", ".env", ".env.local", ".env.production", "supabase/migrations/"];
  if (blocked.some((b) => np === b || np.startsWith(b))) return false;
  return allowlist.some((prefix) => {
    const npre = normalizePath(prefix);
    return np === npre || np.startsWith(npre);
  });
}

function validateOpsScope(ops, args) {
  const touched = Array.from(new Set(ops.map((o) => normalizePath(o.path))));
  const disallowed = touched.filter((p) => !pathAllowed(p, args.editAllowlist));
  return {
    touched,
    touchedCount: touched.length,
    withinFileLimit: touched.length <= args.editMaxFiles,
    disallowed,
    ok: touched.length > 0 && touched.length <= args.editMaxFiles && disallowed.length === 0,
  };
}

function gitCurrentBranch() {
  const res = runShell("git rev-parse --abbrev-ref HEAD");
  if (res.code !== 0) return "unknown";
  return String(res.stdout || "").trim().split(/\r?\n/).pop() || "unknown";
}

function collectRepoContext() {
  const status = runShell("git status --short");
  const files = runShell(
    process.platform === "win32"
      ? "$i=0; Get-ChildItem src -Recurse -File | ForEach-Object { $i++; if($i -le 120){ $_.FullName.Replace((Get-Location).Path + '\\\\','').Replace('\\\\','/') } }"
      : "find src -type f | head -n 120"
  );
  const head = runShell("git diff --name-only HEAD");
  return [
    "git status --short:",
    status.stdout || "(none)",
    "recent changed files:",
    head.stdout || "(none)",
    "src files sample:",
    files.stdout || "(none)",
  ].join("\n");
}

async function callOpenAI(prompt, model) {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const m = model || "gpt-4.1-mini";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: m,
      input: prompt,
      temperature: 0.2,
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${raw.slice(0, 300)}`);
  const json = JSON.parse(raw);
  const text = Array.isArray(json.output)
    ? json.output
        .flatMap((o) => o.content || [])
        .map((c) => c.text || "")
        .join("\n")
    : "";
  return { provider: "openai", model: m, text: text.trim(), raw: json };
}

async function callAnthropic(prompt, model) {
  const apiKey = mustEnv("ANTHROPIC_API_KEY");
  const m = model || "claude-3-5-sonnet-latest";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: m,
      max_tokens: 1400,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${raw.slice(0, 300)}`);
  const json = JSON.parse(raw);
  const text = Array.isArray(json.content) ? json.content.map((c) => c.text || "").join("\n") : "";
  return { provider: "anthropic", model: m, text: text.trim(), raw: json };
}

function normalizeNvidiaContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function callNvidia(prompt, model) {
  const apiKey = mustEnv("NVIDIA_API_KEY");
  const m = model || "moonshotai/kimi-k2.5";
  const endpoint = getEnv("NVIDIA_CHAT_COMPLETIONS_URL", "https://integrate.api.nvidia.com/v1/chat/completions");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: m,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0.2,
      top_p: 1,
      stream: false,
      chat_template_kwargs: { thinking: true },
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`NVIDIA error ${res.status}: ${raw.slice(0, 500)}`);
  const json = JSON.parse(raw);
  const text = Array.isArray(json?.choices)
    ? json.choices
        .map((choice) => normalizeNvidiaContent(choice?.message?.content))
        .filter(Boolean)
        .join("\n")
    : "";
  return { provider: "nvidia", model: m, text: text.trim(), raw: json };
}

async function callLlm(provider, model, prompt) {
  const p = String(provider || "none").toLowerCase();
  if (p === "openai") return callOpenAI(prompt, model);
  if (p === "anthropic") return callAnthropic(prompt, model);
  if (p === "nvidia") return callNvidia(prompt, model);
  return { provider: "none", model: "dry-run", text: "Dry run response.", raw: { dry_run: true } };
}

async function rpc(supabase, fn, params) {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
}

async function recordAction(supabase, runId, payload) {
  return rpc(supabase, "record_ralph_action", {
    p_run_id: runId,
    p_step_index: payload.stepIndex ?? 0,
    p_phase: payload.phase ?? "execute",
    p_tool_name: payload.toolName ?? null,
    p_target: payload.target ?? null,
    p_status: payload.status ?? "ok",
    p_latency_ms: payload.latencyMs ?? 0,
    p_details: payload.details ?? {},
  });
}

async function recordEval(supabase, runId, payload) {
  return rpc(supabase, "record_ralph_eval", {
    p_run_id: runId,
    p_suite: payload.suite ?? "default",
    p_metric: payload.metric ?? "unknown_metric",
    p_value: payload.value ?? null,
    p_threshold: payload.threshold ?? null,
    p_pass: payload.pass ?? false,
    p_details: payload.details ?? {},
  });
}

async function raiseIncident(supabase, runId, severity, type, message, metadata = {}) {
  return rpc(supabase, "raise_ralph_incident", {
    p_run_id: runId,
    p_severity: severity,
    p_incident_type: type,
    p_message: message,
    p_metadata: metadata,
  });
}

async function main() {
  loadDotEnvIfPresent();
  const args = parseArgs(process.argv.slice(2));
  args.prompt = resolvePrompt(args);
  const requestedEditMode = args.editMode;
  const guardDecision = evaluateBuildFailureGuard(
    args.progressFile,
    requestedEditMode,
    args.buildFailureGuardThreshold
  );
  const effectiveEditMode = guardDecision.forcePropose ? "propose" : requestedEditMode;
  const supabaseUrl = mustEnv("SUPABASE_URL", getEnv("VITE_SUPABASE_URL", ""));
  const serviceRole = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  const runDir = path.join(args.outDir, `run_${tsStamp()}`);
  ensureDir(runDir);
  const patchDir = path.join(runDir, "patches");
  ensureDir(patchDir);

  const branch = gitCurrentBranch();
  if (effectiveEditMode === "apply" && args.requireNonMainBranch && ["main", "master"].includes(branch)) {
    throw new Error("Refusing edit-mode=apply on main/master. Switch to a feature branch or set --require-non-main-branch=false.");
  }

  const localLog = {
    started_at: new Date().toISOString(),
    args,
    branch,
    run_id: null,
    actions: [],
    evals: [],
    incidents: [],
    llm_outputs: [],
    patches: [],
    gate_results: [],
    guard_decision: guardDecision,
    requested_edit_mode: requestedEditMode,
    effective_edit_mode: effectiveEditMode,
  };

  const runId = await rpc(supabase, "start_ralph_run", {
    p_mode: args.mode,
    p_created_by: null,
    p_target_scope: args.scope,
    p_max_iterations: args.maxIterations,
    p_timeout_minutes: args.timeoutMinutes,
    p_budget_usd: args.budgetUsd,
    p_token_budget: args.tokenBudget,
    p_summary: {
      runner: "scripts/ralph_local_runner.mjs",
      dry_run: args.dryRun,
      llm_provider: args.llmProvider,
      llm_model: args.llmModel || null,
      semantic_embedding_provider: args.semanticEmbeddingProvider,
      semantic_embedding_model: args.semanticEmbeddingModel || null,
      edit_mode_requested: requestedEditMode,
      edit_mode_effective: effectiveEditMode,
      guard_decision: guardDecision,
      branch,
    },
  });
  localLog.run_id = runId;

  let failed = false;
  let errorMessage = null;
  let appliedPatches = 0;
  const startedAt = Date.now();
  const repoContext = collectRepoContext();
  const featureDoc = readJsonSafe(args.featureFile, null);
  const activeFeature = pickActiveFeature(featureDoc);
  let candidateFiles = [];
  let candidateContext = "";
  let contextPack = null;
  let contextSummary = "No context pack available.";
  let semanticRows = [];
  let semanticSummary = "No semantic memory matches.";
  localLog.feature_file = path.resolve(args.featureFile);
  localLog.active_feature = activeFeature;

  if (guardDecision.forcePropose) {
    await recordAction(supabase, runId, {
      stepIndex: 0,
      phase: "guard",
      toolName: "build_failure_guard",
      target: "edit_mode",
      status: "warn",
      latencyMs: 1,
      details: {
        requested_edit_mode: requestedEditMode,
        effective_edit_mode: effectiveEditMode,
        reason: guardDecision.reason,
        repeated_count: guardDecision.repeated_count,
        signature: guardDecision.signature || null,
      },
    });
    await raiseIncident(
      supabase,
      runId,
      "warn",
      "build_failure_guard_activated",
      "Apply mode downgraded to propose due to repeated build failure signature",
      {
        requested_edit_mode: requestedEditMode,
        effective_edit_mode: effectiveEditMode,
        repeated_count: guardDecision.repeated_count,
        signature: guardDecision.signature || null,
      }
    );
  }

  try {
    contextPack = await rpc(supabase, "get_ralph_context_pack", {
      p_scope: args.scope,
      p_hours: 72,
      p_limit_items: 20,
    });
    contextSummary = summarizeContextPack(contextPack);
    localLog.context_pack = contextPack;
    await recordAction(supabase, runId, {
      stepIndex: 0,
      phase: "context",
      toolName: "rpc:get_ralph_context_pack",
      target: args.scope.join(","),
      status: "ok",
      latencyMs: 20,
      details: { has_context_pack: true, memory_items: Array.isArray(contextPack?.memory_items) ? contextPack.memory_items.length : 0 },
    });
    await recordEval(supabase, runId, {
      suite: "context",
      metric: "context_pack_available",
      value: 1,
      threshold: 1,
      pass: true,
      details: { scope: args.scope },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    localLog.context_pack_error = msg;
    await recordAction(supabase, runId, {
      stepIndex: 0,
      phase: "context",
      toolName: "rpc:get_ralph_context_pack",
      target: args.scope.join(","),
      status: "warn",
      latencyMs: 20,
      details: { has_context_pack: false, error: msg },
    });
    await recordEval(supabase, runId, {
      suite: "context",
      metric: "context_pack_available",
      value: 0,
      threshold: 1,
      pass: false,
      details: { error: msg },
    });
  }

  try {
    const semanticQuery = [
      args.prompt,
      `Mode: ${args.mode}`,
      `Scope: ${args.scope.join(", ")}`,
      contextSummary,
    ].join("\n");

    let embeddingText = null;
    let embeddingInfo = { provider: "none", model: null };
    if (!args.dryRun && args.semanticUseEmbeddings) {
      const embRes = await callSemanticEmbedding(args, semanticQuery);
      if (Array.isArray(embRes.embedding) && embRes.embedding.length > 0) {
        embeddingText = JSON.stringify(embRes.embedding);
      }
      embeddingInfo = { provider: embRes.provider, model: embRes.model };
    }

    let embeddingFallbackToText = false;
    try {
      semanticRows = await rpc(supabase, "search_ralph_memory_documents", {
        p_query_text: semanticQuery,
        p_query_embedding_text: embeddingText,
        p_scope: args.scope,
        p_match_count: args.semanticMatchCount,
        p_min_importance: args.semanticMinImportance,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isVectorDimMismatch =
        msg.toLowerCase().includes("expected") &&
        msg.toLowerCase().includes("dimensions");
      if (embeddingText && isVectorDimMismatch) {
        embeddingFallbackToText = true;
        semanticRows = await rpc(supabase, "search_ralph_memory_documents", {
          p_query_text: semanticQuery,
          p_query_embedding_text: null,
          p_scope: args.scope,
          p_match_count: args.semanticMatchCount,
          p_min_importance: args.semanticMinImportance,
        });
      } else {
        throw e;
      }
    }

    if (!Array.isArray(semanticRows)) semanticRows = [];
    semanticSummary = summarizeSemanticRows(semanticRows);
    localLog.semantic_context = {
      rows: semanticRows,
      embedding_provider: embeddingInfo.provider,
      embedding_model: embeddingInfo.model,
      used_vector_search: Boolean(embeddingText),
      fallback_to_text_search: embeddingFallbackToText,
    };

    await recordAction(supabase, runId, {
      stepIndex: 0,
      phase: "context",
      toolName: "rpc:search_ralph_memory_documents",
      target: args.scope.join(","),
      status: "ok",
      latencyMs: 20,
      details: {
        matches: semanticRows.length,
        embedding_provider: embeddingInfo.provider,
        embedding_model: embeddingInfo.model,
        used_vector_search: Boolean(embeddingText),
        fallback_to_text_search: embeddingFallbackToText,
      },
    });
    await recordEval(supabase, runId, {
      suite: "context",
      metric: "semantic_matches_count",
      value: semanticRows.length,
      threshold: 1,
      pass: semanticRows.length > 0,
      details: { query: semanticQuery.slice(0, 180) },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    localLog.semantic_context_error = msg;
    await recordAction(supabase, runId, {
      stepIndex: 0,
      phase: "context",
      toolName: "rpc:search_ralph_memory_documents",
      target: args.scope.join(","),
      status: "warn",
      latencyMs: 20,
      details: { error: msg },
    });
  }

  candidateFiles = getCandidateFiles(args, activeFeature, semanticRows).filter((p) => pathAllowed(p, args.editAllowlist));
  candidateContext = readCandidateContext(candidateFiles, 5000, 14);
  localLog.candidate_files = candidateFiles;

  try {
    for (let i = 1; i <= args.maxIterations; i++) {
      if (Date.now() - startedAt > args.timeoutMinutes * 60_000) {
        throw new Error(`Run timeout exceeded (${args.timeoutMinutes} min).`);
      }

      const planPrompt = buildPlanPrompt(args, i, contextSummary, semanticSummary, activeFeature);
      const llmPlan = args.dryRun
        ? { provider: "none", model: "dry-run", text: '{"plan":"dry","risks":[],"next_action":"noop"}', raw: { dry_run: true, iteration: i } }
        : await callLlm(args.llmProvider, args.llmModel, planPrompt);

      const parsedPlan = extractJsonObject(llmPlan.text);
      localLog.llm_outputs.push({
        iteration: i,
        type: "plan",
        provider: llmPlan.provider,
        model: llmPlan.model,
        text_preview: llmPlan.text.slice(0, 1000),
        parsed: parsedPlan,
      });

      const actionId = await recordAction(supabase, runId, {
        stepIndex: i,
        phase: "plan",
        toolName: args.dryRun ? "dry_runner" : `${llmPlan.provider}:${llmPlan.model}`,
        target: args.scope.join(","),
        status: "ok",
        latencyMs: 30,
        details: { iteration: i, text_preview: llmPlan.text.slice(0, 400), dry_run: args.dryRun },
      });
      localLog.actions.push({ iteration: i, action_id: actionId, phase: "plan" });

      const evalPass = llmPlan.text.length > 0;
      const evalId = await recordEval(supabase, runId, {
        suite: "iteration",
        metric: "llm_plan_non_empty",
        value: llmPlan.text.length,
        threshold: 1,
        pass: evalPass,
        details: { iteration: i },
      });
      localLog.evals.push({ iteration: i, eval_id: evalId, phase: "plan", pass: evalPass });

      if (!evalPass) {
        failed = true;
        errorMessage = `Iteration ${i} produced empty plan`;
        await raiseIncident(supabase, runId, "error", "empty_llm_plan", errorMessage, { iteration: i });
        break;
      }

      if (!args.dryRun && effectiveEditMode !== "off") {
        const opsPrompt = buildOpsPrompt(
          args,
          i,
          llmPlan.text.slice(0, 1200),
          candidateFiles,
          candidateContext || repoContext,
          contextSummary,
          semanticSummary,
          activeFeature
        );
        const llmOps = await callLlm(args.llmProvider, args.llmModel, opsPrompt);
        const ops = parseEditOps(llmOps.text);
        const opsFile = path.join(patchDir, `iter_${String(i).padStart(2, "0")}_ops.json`);
        await fsp.writeFile(
          opsFile,
          JSON.stringify(
            {
              iteration: i,
              provider: llmOps.provider,
              model: llmOps.model,
              raw_preview: llmOps.text.slice(0, 1500),
              ops,
            },
            null,
            2
          ),
          "utf8"
        );

        if (ops.length === 0) {
          localLog.patches.push({ iteration: i, status: "empty", file: opsFile, touched: [] });
          await recordAction(supabase, runId, {
            stepIndex: i,
            phase: "patch",
            toolName: `${llmOps.provider}:${llmOps.model}`,
            target: "ops",
            status: "skipped",
            latencyMs: 20,
            details: { reason: "empty_ops", ops_file: opsFile },
          });
          await recordEval(supabase, runId, {
            suite: "patch",
            metric: "ops_non_empty",
            value: 0,
            threshold: 1,
            pass: false,
            details: { iteration: i },
          });
          continue;
        }

        const scopeCheck = validateOpsScope(ops, args);
        localLog.patches.push({
          iteration: i,
          status: "proposed",
          file: opsFile,
          touched: scopeCheck.touched,
          disallowed: scopeCheck.disallowed,
          withinFileLimit: scopeCheck.withinFileLimit,
        });

        await recordAction(supabase, runId, {
          stepIndex: i,
          phase: "patch",
          toolName: `${llmOps.provider}:${llmOps.model}`,
          target: "ops_proposal",
          status: scopeCheck.ok ? "ok" : "warn",
          latencyMs: 35,
          details: { touched: scopeCheck.touched, disallowed: scopeCheck.disallowed, ops_file: opsFile },
        });
        await recordEval(supabase, runId, {
          suite: "patch",
          metric: "ops_scope_allowed",
          value: scopeCheck.touchedCount,
          threshold: args.editMaxFiles,
          pass: scopeCheck.ok,
          details: { disallowed: scopeCheck.disallowed },
        });

        if (!scopeCheck.ok) {
          await raiseIncident(
            supabase,
            runId,
            "warn",
            "ops_scope_violation",
            `Iteration ${i} ops violated allowlist or file limit`,
            { touched: scopeCheck.touched, disallowed: scopeCheck.disallowed, limit: args.editMaxFiles }
          );
          continue;
        }

        if (effectiveEditMode === "apply") {
          let appliedThisIter = 0;
          const applyErrors = [];
          for (const op of ops.slice(0, args.editMaxFiles)) {
            const opPath = normalizePath(op.path);
            if (!pathAllowed(opPath, args.editAllowlist)) {
              applyErrors.push({ path: opPath, reason: "path_not_allowed" });
              continue;
            }
            const abs = path.resolve(opPath);
            if (!fs.existsSync(abs)) {
              applyErrors.push({ path: opPath, reason: "file_not_found" });
              continue;
            }
            const findText = String(op.find || "");
            if (findText.length < args.applyMinFindChars) {
              applyErrors.push({
                path: opPath,
                reason: "find_too_short",
                find_len: findText.length,
                min_required: args.applyMinFindChars,
              });
              continue;
            }
            const before = fs.readFileSync(abs, "utf8");
            const idx = before.indexOf(findText);
            if (idx < 0) {
              applyErrors.push({ path: opPath, reason: "find_not_found", find_preview: findText.slice(0, 120) });
              continue;
            }
            const occurrences = before.split(findText).length - 1;
            if (occurrences !== 1) {
              applyErrors.push({ path: opPath, reason: "find_ambiguous", occurrences, find_preview: findText.slice(0, 120) });
              continue;
            }
            const endIdx = idx + findText.length;
            const startsOnBoundary = idx === 0 || before[idx - 1] === "\n";
            const endsOnBoundary = endIdx === before.length || before[endIdx] === "\n";
            if (!startsOnBoundary || !endsOnBoundary) {
              applyErrors.push({
                path: opPath,
                reason: "find_not_line_bounded",
                starts_on_boundary: startsOnBoundary,
                ends_on_boundary: endsOnBoundary,
                find_preview: findText.slice(0, 120),
              });
              continue;
            }
            const after = `${before.slice(0, idx)}${op.replace}${before.slice(endIdx)}`;
            if (after === before) {
              applyErrors.push({ path: opPath, reason: "no_effect" });
              continue;
            }
            fs.writeFileSync(abs, after, "utf8");
            appliedThisIter += 1;
          }

          await recordAction(supabase, runId, {
            stepIndex: i,
            phase: "apply",
            toolName: "file_replace",
            target: "ops_apply",
            status: appliedThisIter > 0 ? "ok" : "error",
            latencyMs: 25,
            details: { applied_this_iteration: appliedThisIter, errors: applyErrors, ops_file: opsFile },
          });
          await recordEval(supabase, runId, {
            suite: "patch",
            metric: "ops_apply_success_count",
            value: appliedThisIter,
            threshold: 1,
            pass: appliedThisIter > 0,
            details: { iteration: i, errors: applyErrors },
          });

          if (appliedThisIter === 0) {
            await raiseIncident(supabase, runId, "error", "ops_apply_failed", "No edit op could be applied", {
              iteration: i,
              errors: applyErrors,
            });
          } else {
            appliedPatches += appliedThisIter;
            localLog.patches[localLog.patches.length - 1].status = "applied";
            localLog.patches[localLog.patches.length - 1].applied_this_iteration = appliedThisIter;
          }
        }
      }
    }

    if (!failed && args.gateLint) {
      const lintRes = runShell("npm run lint");
      localLog.gate_results.push({ gate: "lint", ...lintRes });
      await recordAction(supabase, runId, {
        stepIndex: args.maxIterations + 1,
        phase: "gate",
        toolName: "npm",
        target: "lint",
        status: lintRes.code === 0 ? "ok" : "error",
        latencyMs: lintRes.latencyMs,
        details: { stdout: lintRes.stdout, stderr: lintRes.stderr },
      });
      await recordEval(supabase, runId, {
        suite: "gates",
        metric: "lint_exit_code",
        value: lintRes.code,
        threshold: 0,
        pass: lintRes.code === 0,
        details: { command: lintRes.command },
      });
      if (lintRes.code !== 0) {
        failed = true;
        errorMessage = "Lint gate failed";
      }
    }

    if (!failed && args.gateBuild) {
      const buildRes = runShell("npm run build");
      localLog.gate_results.push({ gate: "build", ...buildRes });
      const buildFailure = buildRes.code !== 0 ? extractBuildFailureSignature(buildRes.stderr) : null;
      localLog.build_failure = buildFailure;
      await recordAction(supabase, runId, {
        stepIndex: args.maxIterations + 2,
        phase: "gate",
        toolName: "npm",
        target: "build",
        status: buildRes.code === 0 ? "ok" : "error",
        latencyMs: buildRes.latencyMs,
        details: {
          stdout: buildRes.stdout,
          stderr: buildRes.stderr,
          failure_signature: buildFailure?.signature || null,
          failure_file: buildFailure?.file || null,
        },
      });
      await recordEval(supabase, runId, {
        suite: "gates",
        metric: "build_exit_code",
        value: buildRes.code,
        threshold: 0,
        pass: buildRes.code === 0,
        details: { command: buildRes.command },
      });
      if (buildRes.code !== 0) {
        failed = true;
        errorMessage = "Build gate failed";
        await raiseIncident(
          supabase,
          runId,
          "error",
          "build_gate_failed",
          "Build gate failed during Ralph run",
          {
            failure_signature: buildFailure?.signature || null,
            failure_file: buildFailure?.file || null,
          }
        );
      }
    }

    if (!failed && args.gateTest) {
      const testRes = runShell("npm run test -- --run");
      localLog.gate_results.push({ gate: "test", ...testRes });
      await recordAction(supabase, runId, {
        stepIndex: args.maxIterations + 3,
        phase: "gate",
        toolName: "npm",
        target: "test",
        status: testRes.code === 0 ? "ok" : "error",
        latencyMs: testRes.latencyMs,
        details: { stdout: testRes.stdout, stderr: testRes.stderr },
      });
      await recordEval(supabase, runId, {
        suite: "gates",
        metric: "test_exit_code",
        value: testRes.code,
        threshold: 0,
        pass: testRes.code === 0,
        details: { command: testRes.command },
      });
      if (testRes.code !== 0) {
        failed = true;
        errorMessage = "Test gate failed";
      }
    }
  } catch (err) {
    failed = true;
    errorMessage = err instanceof Error ? err.message : String(err);
    localLog.incidents.push({ type: "runner_exception", message: errorMessage });
    await raiseIncident(supabase, runId, "critical", "runner_exception", errorMessage, {});
  }

  if (!failed && !args.dryRun && effectiveEditMode === "apply" && appliedPatches === 0) {
    failed = true;
    errorMessage = "No edit operations were applied (0 changes).";
    await raiseIncident(supabase, runId, "error", "no_changes_applied", errorMessage, {
      edit_mode: effectiveEditMode,
      max_iterations: args.maxIterations,
    });
  }

  const finalStatus = failed ? "failed" : !args.dryRun && effectiveEditMode === "apply" ? "promotable" : "completed";

  try {
    await rpc(supabase, "compute_ralph_memory_snapshot", {
      p_source: "ralph_local_runner",
      p_scope: args.scope,
      p_notes: {
        run_id: runId,
        mode: args.mode,
        dry_run: args.dryRun,
        final_status: finalStatus,
        applied_patches: appliedPatches,
      },
      p_min_interval_minutes: 1,
      p_force: true,
    });
  } catch (_e) {
    // best-effort
  }

  const finishData = await rpc(supabase, "finish_ralph_run", {
    p_run_id: runId,
    p_status: finalStatus,
    p_summary: {
      local_runner: true,
      dry_run: args.dryRun,
      llm_provider: args.llmProvider,
      scope: args.scope,
      edit_mode: effectiveEditMode,
      edit_mode_requested: requestedEditMode,
      edit_mode_effective: effectiveEditMode,
      guard_decision: guardDecision,
      applied_patches: appliedPatches,
      gates: {
        lint: args.gateLint,
        build: args.gateBuild,
        test: args.gateTest,
      },
    },
    p_error_message: errorMessage,
    p_spent_tokens: 0,
    p_spent_usd: 0,
  });

  const health = await rpc(supabase, "get_ralph_health", { p_hours: 24 });
  const finalDiff = runShell("git diff --name-only");

  localLog.finished_at = new Date().toISOString();
  localLog.final_status = finalStatus;
  localLog.finish_data = finishData;
  localLog.health = health;
  localLog.error = errorMessage;
  localLog.applied_patches = appliedPatches;
  localLog.changed_files_after_run = (finalDiff.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const passCheck = shouldMarkFeaturePass(
    args,
    effectiveEditMode,
    activeFeature,
    finalStatus,
    failed,
    appliedPatches,
    localLog.gate_results
  );
  localLog.feature_pass_check = passCheck;
  if (passCheck.ok && activeFeature?.id) {
    const markRes = markFeaturePass(args.featureFile, activeFeature.id, {
      run_id: runId,
      final_status: finalStatus,
      applied_patches: appliedPatches,
      changed_files_after_run: localLog.changed_files_after_run,
      gates: {
        lint: args.gateLint,
        build: args.gateBuild,
        test: args.gateTest,
      },
    });
    localLog.feature_pass_update = markRes;
  }

  const outPath = path.join(runDir, "ralph_local_runner_summary.json");
  await fsp.writeFile(outPath, JSON.stringify(localLog, null, 2), "utf8");

  try {
    appendJsonl(args.progressFile, {
      ts: new Date().toISOString(),
      run_id: runId,
      mode: args.mode,
      status: finalStatus,
      dry_run: args.dryRun,
      edit_mode: effectiveEditMode,
      requested_edit_mode: requestedEditMode,
      effective_edit_mode: effectiveEditMode,
      scope: args.scope,
      guard_decision: guardDecision,
      active_feature: activeFeature
        ? {
            id: activeFeature.id || null,
            title: activeFeature.title || null,
            category: activeFeature.category || null,
          }
        : null,
      feature_pass_check: localLog.feature_pass_check || null,
      feature_pass_update: localLog.feature_pass_update || null,
      build_failure_signature: localLog.build_failure?.signature || null,
      build_failure_file: localLog.build_failure?.file || null,
      applied_patches: appliedPatches,
      changed_files_after_run: localLog.changed_files_after_run,
      summary_path: outPath,
    });
  } catch (_e) {
    // best-effort progress artifact
  }

  console.log("Ralph local runner finished.");
  console.log(`- run_id: ${runId}`);
  console.log(`- status: ${finalStatus}`);
  console.log(`- dry_run: ${args.dryRun}`);
  console.log(`- mode: ${args.mode}`);
  console.log(`- edit_mode_requested: ${requestedEditMode}`);
  console.log(`- edit_mode_effective: ${effectiveEditMode}`);
  if (guardDecision.forcePropose) {
    console.log(`- guard: activated (${guardDecision.reason}, repeated=${guardDecision.repeated_count})`);
  }
  console.log(`- applied_patches: ${appliedPatches}`);
  console.log(`- gates: lint=${args.gateLint} build=${args.gateBuild} test=${args.gateTest}`);
  console.log(`- summary: ${outPath}`);

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
