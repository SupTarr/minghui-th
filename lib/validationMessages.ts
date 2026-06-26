// Single source of truth for content-validation rule config + message text.
//
// The rule registry (thresholds, severity, message templates) lives in the
// repo-root `validation.json`. This module loads it and renders human-readable
// messages from a stored failure's `{id, variant?, vars?}` — so NO message text
// or threshold is ever persisted in a per-article / index record; only the
// dynamic facts are. Both the validator (lib/contentValidation.ts) and the UI
// (components/ArchiveList.tsx) import from here; keeping it free of validator
// logic means the client bundle doesn't pull in the whole validator.
//
// The JSON import attribute (`with { type: "json" }`) is REQUIRED by native
// Node ESM (the backfill CLI runs under `node`), and accepted by Turbopack and
// Vite (vitest) — so the one import form works across all three runtimes.
import validationConfig from "../validation.json" with { type: "json" };

export interface RuleConfig {
  severity: "error" | "warn";
  label: string;
  /** Single message template (mutually exclusive with `messages`). */
  message?: string;
  /** Variant → template map, for checks with branching messages. */
  messages?: Record<string, string>;
  /** Tunable thresholds; also merged into the message interpolation map. */
  params?: Record<string, number | string>;
}

export interface ValidationConfig {
  version: number;
  rules: Record<string, RuleConfig>;
}

// JSON widens `severity` to `string`; narrow to the hand-written union shape.
export const CONFIG = validationConfig as unknown as ValidationConfig;

/** Bumped whenever rules/thresholds change; gates the backfill re-validation. */
export const CONFIG_VERSION = CONFIG.version;

/** The dynamic part of one failed check — the only validation data persisted. */
export interface StoredFailure {
  id: string;
  /** Which template variant fired (for rules with a `messages` map). */
  variant?: string;
  /** Measured values interpolated into the template (no thresholds). */
  vars?: Record<string, string | number>;
}

/**
 * Render one rule's message from config. Interpolates `{token}` from a merged
 * map of the rule's `params` (thresholds) and the failure's `vars` (measured
 * values), so templates can reference either without storing thresholds.
 */
export function renderMessage(
  id: string,
  variant?: string,
  vars: Record<string, string | number> = {},
): string {
  const rule = CONFIG.rules[id];
  if (!rule) return "";
  const tmpl =
    rule.message ?? (variant ? rule.messages?.[variant] : undefined) ?? "";
  const map = { ...(rule.params ?? {}), ...vars };
  return tmpl.replace(/\{(\w+)\}/g, (_, key) => String(map[key] ?? ""));
}

/**
 * Join a stored failure list into one human-readable string, errors first
 * (mirrors the validator's finalize ordering). Severity is config-sourced, so
 * the record itself never carries it.
 */
export function renderFailures(failures: StoredFailure[]): string {
  const sevOf = (f: StoredFailure) => CONFIG.rules[f.id]?.severity;
  return [
    ...failures.filter((f) => sevOf(f) === "error"),
    ...failures.filter((f) => sevOf(f) === "warn"),
  ]
    .map((f) => renderMessage(f.id, f.variant, f.vars))
    .filter(Boolean)
    .join(" | ");
}
