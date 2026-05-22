import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---- State ----

interface WhispererState {
  enabled: boolean;
  warnThreshold: number;    // % of context at which to warn (default 70)
  autoThreshold: number;    // % of context at which to compact (default 80)
  compactedCount: number;   // how many times compacted this session
  lastWarningAt: number;    // last warning % to avoid spam
}

const STORAGE_KEY = "pi-context-whisperer-state";

let state: WhispererState = {
  enabled: true,
  warnThreshold: 70,
  autoThreshold: 80,
  compactedCount: 0,
  lastWarningAt: 0,
};

let tuiRef: any = null;
let inContextLock = false;

// ---- Helpers ----

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "?k";
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n > 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function pct(n: number): string {
  return `${n.toFixed(0)}%`;
}

// ---- Extension ----

export default function (pi: ExtensionAPI) {
  // ---- Restore state ----
  pi.on("session_start", async (_event, ctx) => {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === STORAGE_KEY && entry.data) {
        state = { ...state, ...(entry.data as Partial<WhispererState>) };
        break;
      }
    }

    // Replace/supplement footer with context health indicator
    ctx.ui.setFooter((tui, theme, footerData) => {
      tuiRef = tui;
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const A = (s: string) => theme.fg("accent", s);
          const D = (s: string) => theme.fg("dim", s);
          const W = (s: string) => theme.fg("warning", s);
          const E = (s: string) => theme.fg("error", s);
          const S = (s: string) => theme.fg("success", s);

          const lines: string[] = [];

          if (!state.enabled) {
            lines.push(D("🦜 Context Whisperer: off  (/whisper-enable to turn on)"));
            return lines;
          }

          // Get current context
          const cu = (ctx as any).getContextUsage?.();
          let pctVal: number | null = null;
          let tokens: number | null = null;
          let window: number | null = (ctx as any).model?.contextWindow ?? null;

          if (cu && cu.percent != null) {
            pctVal = cu.percent;
            tokens = cu.tokens ?? null;
          }

          if (pctVal === null) {
            lines.push(D("🦜 Context Whisperer: waiting for context data..."));
            return lines;
          }

          const w = Math.min(20, Math.max(8, Math.floor(width / 5)));
          const filled = Math.min(w, Math.max(0, Math.round((pctVal / 100) * w)));
          const empty = w - filled;
          const barColor =
            pctVal >= state.autoThreshold ? "error" :
            pctVal >= state.warnThreshold ? "warning" : "success";
          const bar = theme.fg(barColor, "█".repeat(filled)) + D("░".repeat(empty));

          const tokenStr = tokens != null ? fmtTokens(tokens) : "?k";
          const windowStr = window != null ? fmtTokens(window) : "?k";

          const health = pctVal >= state.autoThreshold
            ? E("⚠ COMPACT NOW")
            : pctVal >= state.warnThreshold
              ? W("⚡ Warning")
              : S("✓ Healthy");

          const compacted = state.compactedCount > 0
            ? D(` | ${state.compactedCount} compacted`)
            : "";

          lines.push(
            `🦜 ${bar} ${tokenStr}/${windowStr} ${health}${compacted}  ${D("warn:")}${state.warnThreshold}% ${D("auto:")}${state.autoThreshold}%`,
          );

          return lines;
        },
      };
    });
  });

  // ---- Detect context pressure ----
  pi.on("turn_end", async (_event, ctx) => {
    if (!state.enabled || inContextLock) return;

    const cu = (ctx as any).getContextUsage?.();
    if (!cu || cu.percent == null) return;

    const pct = cu.percent;
    const tokens = cu.tokens;

    // Warning at warnThreshold — only warn once per crossing
    if (pct >= state.warnThreshold && pct < state.autoThreshold && state.lastWarningAt < state.warnThreshold) {
      ctx.ui.notify(
        `🦜 Context at ${pct(pct)} — ${fmtTokens(tokens)}/${fmtTokens(cu.contextWindow)}. Consider /compact soon.`,
        "warning",
      );
      state.lastWarningAt = pct;
      tuiRef?.requestRender();
    }

    // Auto-compact at autoThreshold
    if (pct >= state.autoThreshold && !inContextLock) {
      inContextLock = true;
      ctx.ui.notify(
        `🦜 Context at ${pct(pct)} — auto-compacting to preserve history...`,
        "info",
      );

      try {
        let done = false;
        let errorMsg = "";

        ctx.compact({
          customInstructions:
            "Summarize the conversation so far, preserving all key decisions, file changes, and the user's current goal. Be concise but complete.",
          onComplete: () => {
            done = true;
            state.compactedCount++;
            state.lastWarningAt = 0;
            persistState(ctx);
            tuiRef?.requestRender();
          },
          onError: (err: Error) => {
            errorMsg = err.message;
            done = true;
          },
        });

        // Wait for compaction to complete
        let waited = 0;
        while (!done && waited < 30000) {
          await new Promise((r) => setTimeout(r, 200));
          waited += 200;
        }

        if (errorMsg) {
          ctx.ui.notify(`🦜 Compaction failed: ${errorMsg.slice(0, 100)}`, "error");
        } else if (done) {
          ctx.ui.notify(
            `🦜 Compaction complete (${state.compactedCount} total). Context freed.`,
            "success",
          );
        }
      } finally {
        inContextLock = false;
      }
    }
  });

  // ---- Commands ----

  pi.registerCommand({
    name: "whisper-enable",
    description: "Enable the Context Whisperer auto-compaction",
    async handler(_args: string[], ctx: any) {
      state.enabled = true;
      persistState(ctx);
      tuiRef?.requestRender();
      ctx.ui.notify("🦜 Context Whisperer enabled", "success");
    },
  });

  pi.registerCommand({
    name: "whisper-disable",
    description: "Disable the Context Whisperer (manual compaction only)",
    async handler(_args: string[], ctx: any) {
      state.enabled = false;
      persistState(ctx);
      tuiRef?.requestRender();
      ctx.ui.notify("🦜 Context Whisperer disabled", "info");
    },
  });

  pi.registerCommand({
    name: "whisper-stats",
    description: "Show Context Whisperer statistics",
    async handler(_args: string[], ctx: any) {
      const cu = (ctx as any).getContextUsage?.();
      const pct = cu?.percent ?? null;
      ctx.ui.notify(
        `🦜 Whisperer: ${state.enabled ? "on" : "off"} | Compactions: ${state.compactedCount} | Context: ${pct != null ? pct(pct) : "?"} | Warn: ${state.warnThreshold}% | Auto: ${state.autoThreshold}%`,
        "info",
      );
    },
  });

  pi.registerCommand({
    name: "whisper-config",
    description: "Set Context Whisperer thresholds. Usage: /whisper-config <warnPct> <autoPct>",
    async handler(_args: string[], ctx: any) {
      const warnPct = parseInt(_args[0]);
      const autoPct = parseInt(_args[1]);

      if (isNaN(warnPct) || warnPct < 30 || warnPct > 95) {
        ctx.ui.notify("Warn threshold must be between 30 and 95", "error");
        return;
      }
      if (isNaN(autoPct) || autoPct < 40 || autoPct > 98) {
        ctx.ui.notify("Auto threshold must be between 40 and 98", "error");
        return;
      }
      if (autoPct <= warnPct) {
        ctx.ui.notify("Auto threshold must be higher than warn threshold", "error");
        return;
      }

      state.warnThreshold = warnPct;
      state.autoThreshold = autoPct;
      persistState(ctx);
      tuiRef?.requestRender();
      ctx.ui.notify(`🦜 Whisperer: warn at ${warnPct}%, auto-compact at ${autoPct}%`, "success");
    },
  });

  // ---- LLM Tools ----

  pi.registerTool({
    name: "context_health",
    description: "Check current context window usage percentage and token counts. Use when concerned about approaching limits.",
    parameters: { type: "object", properties: {} },
    async execute(_toolCallId: any, _args: any, _signal: any, _onUpdate: any, ctx: any) {
      const cu = (ctx as any).getContextUsage?.();
      if (!cu || cu.percent == null) return "Context usage data not available yet.";
      const status =
        cu.percent >= state.autoThreshold ? "CRITICAL — compaction recommended" :
        cu.percent >= state.warnThreshold ? "WARNING — approaching limit" :
        "HEALTHY";
      return `Context: ${fmtTokens(cu.tokens)}/${fmtTokens(cu.contextWindow)} (${pct(cu.percent)}) — ${status}. Whisperer: ${state.enabled ? "on" : "off"} (${state.compactedCount} compactions this session).`;
    },
  });

  // ---- Keyboard shortcut ----
  // Ctrl+Shift+C: force compact now
  pi.registerShortcut("c", { ctrl: true, shift: true }, (_event: any, ctx: any) => {
    if (!ctx.hasUI || !state.enabled || inContextLock) return;
    inContextLock = true;
    ctx.compact({
      customInstructions: "Summarize the conversation so far concisely.",
      onComplete: () => {
        state.compactedCount++;
        state.lastWarningAt = 0;
        persistState(ctx);
        inContextLock = false;
        tuiRef?.requestRender();
      },
      onError: () => {
        inContextLock = false;
      },
    });
  });
}

// ---- Persistence ----

function persistState(ctx: any) {
  try {
    ctx.sessionManager.appendEntry?.({
      type: "custom",
      customType: STORAGE_KEY,
      data: { ...state },
    });
  } catch {
    // Ignore persistence errors
  }
}