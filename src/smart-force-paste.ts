import { Clipboard, getPreferenceValues, showHUD } from "@raycast/api";
import { execFile } from "child_process";
import { existsSync, writeFileSync } from "fs";
import {
  PID_FILE,
  readRunningPid,
  requestStop,
  STOP_FILE,
  tryUnlink,
} from "./session";
import { spawnEscapeMonitor } from "./keyboard-monitor";

interface Preferences {
  wpm: string;
  minDelay: string;
  maxDelay: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

// Sends one keystroke via a short-lived osascript process.
// Using `character id N` avoids any string-escaping issues with arbitrary Unicode.
// Each process lives for ~20-40 ms and exits; no long-running IPC to block signals.
function fireKeystroke(code: number): Promise<void> {
  const script =
    code === 10
      ? 'tell application "System Events" to key code 36'
      : code === 9
        ? 'tell application "System Events" to key code 48'
        : `tell application "System Events" to keystroke (character id ${code})`;
  return new Promise<void>((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-e", script], (err) => {
      if (!err) {
        resolve();
        return;
      }
      const ex = err as NodeJS.ErrnoException & {
        signal?: string;
        killed?: boolean;
      };
      if (ex.signal || ex.killed)
        resolve(); // killed externally — treat as success
      else reject(err);
    });
  });
}

// Node.js owns the loop: stop flag is checked before every character, so the
// process is never stuck waiting for a signal inside a Mach IPC call.
async function typeText(
  chars: string[],
  lo: number,
  hi: number,
): Promise<"done" | "stopped"> {
  for (const c of chars) {
    if (existsSync(STOP_FILE)) return "stopped";
    const code = c.codePointAt(0)!;
    if (code === 0 || code === 13) continue; // null / bare CR
    await fireKeystroke(code);
    await sleep(lo + Math.random() * (hi - lo));
  }
  return existsSync(STOP_FILE) ? "stopped" : "done";
}

export default async function main() {
  if (readRunningPid() !== undefined) {
    const result = requestStop();
    await showHUD(
      result === "not-running" ? "Nothing is running" : "⏹ Stopped",
    );
    return;
  }

  tryUnlink(PID_FILE);
  tryUnlink(STOP_FILE);

  const prefs = getPreferenceValues<Preferences>();
  const wpm = Math.max(1, parseInt(prefs.wpm) || 60);
  const prefMin = Math.max(0, parseInt(prefs.minDelay) || 0);
  const prefMax = Math.max(0, parseInt(prefs.maxDelay) || 0);

  // ms per character: 60 000 / (wpm × 5 chars/word)
  const baseDelay = 60_000 / (wpm * 5);
  const rawMin =
    prefMin > 0 ? prefMin : Math.max(10, Math.round(baseDelay * 0.8));
  const rawMax = prefMax > 0 ? prefMax : Math.round(baseDelay * 1.2);
  const lo = Math.min(rawMin, rawMax);
  const hi = Math.max(rawMin, rawMax);

  const text = await Clipboard.readText();
  if (!text) {
    await showHUD("❌ Clipboard is empty");
    return;
  }

  const chars = [...text]; // spread gives Unicode code points
  const charCount = chars.length;
  const estimatedMs = charCount * ((lo + hi) / 2);

  // Track own PID so the stop command (or re-run toggle) can detect this session.
  writeFileSync(PID_FILE, String(process.pid), "utf8");
  const escMonitor = spawnEscapeMonitor();

  await showHUD(
    `⌨️ Typing ${charCount} chars (~${formatDuration(estimatedMs)}) · Esc to stop`,
  );
  await sleep(400);

  try {
    const result = await typeText(chars, lo, hi);
    await showHUD(result === "stopped" ? "⏹ Stopped" : "✅ Done");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.toLowerCase().includes("not allowed") ||
      msg.toLowerCase().includes("accessibility")
    ) {
      await showHUD(
        "❌ Grant Accessibility access: System Settings → Privacy & Security → Accessibility",
      );
    } else {
      await showHUD("❌ " + msg.slice(0, 80));
    }
  } finally {
    escMonitor?.kill();
    tryUnlink(PID_FILE);
    tryUnlink(STOP_FILE);
  }
}
