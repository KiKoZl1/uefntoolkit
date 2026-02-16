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
  }

  if (!VALID_MODES.has(args.mode)) args.mode = "custom";
  if (!VALID_EDIT_MODES.has(args.editMode)) args.editMode = "off";
  if (!Number.isFinite(args.maxIterations) || args.maxIterations < 1) args.maxIterations = 3;
  if (!Number.isFinite(args.timeoutMinutes) || args.timeoutMinutes < 1) args.timeoutMinutes = 20;
  if (!Number.isFinite(args.budgetUsd) || args.budgetUsd < 0) args.budgetUsd = 0;
  if (!Number.isFinite(args.tokenBudget) || args.tokenBudget < 0) args.tokenBudget = 0;
  if (!Number.isFinite(args.editMaxFiles) || args.editMaxFiles < 1) args.editMaxFiles = 2;

  return args;
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

function buildPlanPrompt(args, iteration) {
  return [
    "You are Ralph runner in Epic Insight Engine.",
    `Mode: ${args.mode}`,
    `Iteration: ${iteration}/${args.maxIterations}`,
    `Scope: ${args.scope.join(", ")}`,
    `Goal: ${args.prompt}`,
    "Return concise JSON with keys: plan, risks, next_action.",
  ].join("\n");
}

function buildPatchPrompt(args, iteration, planText, repoContext) {
  return [
    "You are generating a safe git unified diff patch for a React + TypeScript app.",
    `Iteration ${iteration}/${args.maxIterations}`,
    `Goal: ${args.prompt}`,
    `Plan summary: ${planText || "n/a"}`,
    `Allowed paths prefixes: ${args.editAllowlist.join(", ")}`,
    `Max touched files: ${args.editMaxFiles}`,
    "Hard rules:",
    "- Output ONLY unified diff patch text (no markdown fences, no explanations).",
    "- Do not touch lock files, env files, migrations, or secrets.",
    "- Keep changes small and coherent for one improvement step.",
    "- If no safe change is possible, output empty string.",
    "Repository context:",
    repoContext,
  ].join("\n");
}

function extractJsonObject(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    // try first {...} block
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function extractPatch(text) {
  const t = String(text || "");
  if (!t.trim()) return "";
  const fenced = t.match(/```(?:diff)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const idx = t.indexOf("diff --git ");
  if (idx >= 0) return t.slice(idx).trim();
  if (/^\s*---\s+a\//m.test(t) && /^\s*\+\+\+\s+b\//m.test(t)) return t.trim();
  return t.trim();
}

function parseTouchedPathsFromPatch(patch) {
  const out = new Set();
  for (const line of String(patch || "").split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) out.add(normalizePath(line.slice("+++ b/".length)));
    if (line.startsWith("--- a/")) out.add(normalizePath(line.slice("--- a/".length)));
  }
  out.delete("/dev/null");
  return Array.from(out).filter(Boolean);
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

function validatePatchScope(patch, args) {
  const touched = parseTouchedPathsFromPatch(patch);
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

async function callLlm(provider, model, prompt) {
  const p = String(provider || "none").toLowerCase();
  if (p === "openai") return callOpenAI(prompt, model);
  if (p === "anthropic") return callAnthropic(prompt, model);
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
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = mustEnv("SUPABASE_URL", getEnv("VITE_SUPABASE_URL", ""));
  const serviceRole = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  const runDir = path.join(args.outDir, `run_${tsStamp()}`);
  ensureDir(runDir);
  const patchDir = path.join(runDir, "patches");
  ensureDir(patchDir);

  const branch = gitCurrentBranch();
  if (args.editMode === "apply" && args.requireNonMainBranch && ["main", "master"].includes(branch)) {
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
      edit_mode: args.editMode,
      branch,
    },
  });
  localLog.run_id = runId;

  let failed = false;
  let errorMessage = null;
  let appliedPatches = 0;
  const startedAt = Date.now();
  const repoContext = collectRepoContext();

  try {
    for (let i = 1; i <= args.maxIterations; i++) {
      if (Date.now() - startedAt > args.timeoutMinutes * 60_000) {
        throw new Error(`Run timeout exceeded (${args.timeoutMinutes} min).`);
      }

      const planPrompt = buildPlanPrompt(args, i);
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

      if (!args.dryRun && args.editMode !== "off") {
        const patchPrompt = buildPatchPrompt(args, i, llmPlan.text.slice(0, 1200), repoContext);
        const llmPatch = await callLlm(args.llmProvider, args.llmModel, patchPrompt);
        const patchText = extractPatch(llmPatch.text);
        const patchFile = path.join(patchDir, `iter_${String(i).padStart(2, "0")}.patch`);

        if (!patchText) {
          localLog.patches.push({ iteration: i, status: "empty", file: patchFile });
          await recordAction(supabase, runId, {
            stepIndex: i,
            phase: "patch",
            toolName: `${llmPatch.provider}:${llmPatch.model}`,
            target: "patch",
            status: "skipped",
            latencyMs: 30,
            details: { reason: "empty_patch" },
          });
          await recordEval(supabase, runId, {
            suite: "patch",
            metric: "patch_non_empty",
            value: 0,
            threshold: 1,
            pass: false,
            details: { iteration: i },
          });
          continue;
        }

        await fsp.writeFile(patchFile, `${patchText}\n`, "utf8");
        const scopeCheck = validatePatchScope(patchText, args);
        localLog.patches.push({
          iteration: i,
          status: "proposed",
          file: patchFile,
          touched: scopeCheck.touched,
          disallowed: scopeCheck.disallowed,
          withinFileLimit: scopeCheck.withinFileLimit,
        });

        await recordAction(supabase, runId, {
          stepIndex: i,
          phase: "patch",
          toolName: `${llmPatch.provider}:${llmPatch.model}`,
          target: "patch_proposal",
          status: scopeCheck.ok ? "ok" : "warn",
          latencyMs: 40,
          details: { touched: scopeCheck.touched, disallowed: scopeCheck.disallowed, patch_file: patchFile },
        });
        await recordEval(supabase, runId, {
          suite: "patch",
          metric: "patch_scope_allowed",
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
            "patch_scope_violation",
            `Iteration ${i} patch violated allowlist or file limit`,
            { touched: scopeCheck.touched, disallowed: scopeCheck.disallowed, limit: args.editMaxFiles }
          );
          continue;
        }

        if (args.editMode === "apply") {
          const patchAbs = path.resolve(patchFile).replace(/\\/g, "/");
          const checkRes = runShell(`git apply --check --whitespace=nowarn "${patchAbs}"`);
          if (checkRes.code !== 0) {
            await recordAction(supabase, runId, {
              stepIndex: i,
              phase: "apply",
              toolName: "git",
              target: "git apply --check",
              status: "error",
              latencyMs: checkRes.latencyMs,
              details: { stdout: checkRes.stdout, stderr: checkRes.stderr },
            });
            await raiseIncident(supabase, runId, "error", "patch_apply_check_failed", "git apply --check failed", {
              iteration: i,
              patch_file: patchFile,
              stderr: checkRes.stderr,
            });
            continue;
          }

          const applyRes = runShell(`git apply --whitespace=nowarn "${patchAbs}"`);
          const appliedOk = applyRes.code === 0;
          await recordAction(supabase, runId, {
            stepIndex: i,
            phase: "apply",
            toolName: "git",
            target: "git apply",
            status: appliedOk ? "ok" : "error",
            latencyMs: applyRes.latencyMs,
            details: { stdout: applyRes.stdout, stderr: applyRes.stderr, patch_file: patchFile },
          });
          await recordEval(supabase, runId, {
            suite: "patch",
            metric: "patch_apply_success",
            value: applyRes.code,
            threshold: 0,
            pass: appliedOk,
            details: { iteration: i, patch_file: patchFile },
          });

          if (!appliedOk) {
            await raiseIncident(supabase, runId, "error", "patch_apply_failed", "git apply failed", {
              iteration: i,
              patch_file: patchFile,
              stderr: applyRes.stderr,
            });
          } else {
            appliedPatches += 1;
            localLog.patches[localLog.patches.length - 1].status = "applied";
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
      await recordAction(supabase, runId, {
        stepIndex: args.maxIterations + 2,
        phase: "gate",
        toolName: "npm",
        target: "build",
        status: buildRes.code === 0 ? "ok" : "error",
        latencyMs: buildRes.latencyMs,
        details: { stdout: buildRes.stdout, stderr: buildRes.stderr },
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

  const finalStatus = failed ? "failed" : !args.dryRun && args.editMode === "apply" ? "promotable" : "completed";
  const finishData = await rpc(supabase, "finish_ralph_run", {
    p_run_id: runId,
    p_status: finalStatus,
    p_summary: {
      local_runner: true,
      dry_run: args.dryRun,
      llm_provider: args.llmProvider,
      scope: args.scope,
      edit_mode: args.editMode,
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

  const outPath = path.join(runDir, "ralph_local_runner_summary.json");
  await fsp.writeFile(outPath, JSON.stringify(localLog, null, 2), "utf8");

  console.log("Ralph local runner finished.");
  console.log(`- run_id: ${runId}`);
  console.log(`- status: ${finalStatus}`);
  console.log(`- dry_run: ${args.dryRun}`);
  console.log(`- mode: ${args.mode}`);
  console.log(`- edit_mode: ${args.editMode}`);
  console.log(`- applied_patches: ${appliedPatches}`);
  console.log(`- gates: lint=${args.gateLint} build=${args.gateBuild} test=${args.gateTest}`);
  console.log(`- summary: ${outPath}`);

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
