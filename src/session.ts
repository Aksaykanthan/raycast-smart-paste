import { readFileSync, unlinkSync, writeFileSync } from "fs";

export const PID_FILE = "/tmp/raycast-fp.pid";
export const STOP_FILE = "/tmp/raycast-fp.stop";

export type StopRequestResult = "stopped" | "not-running" | "failed";

export function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // ignore — file may not exist
  }
}

/** Returns the smart-force-paste process PID only when it still exists. */
export function readRunningPid(): number | undefined {
  let pid: number;
  try {
    pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    if (!isFinite(pid) || pid <= 0) return undefined;
  } catch {
    return undefined;
  }
  try {
    process.kill(pid, 0); // existence check — no signal sent
    return pid;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") return pid; // exists but not killable
    tryUnlink(PID_FILE);
    return undefined;
  }
}

/** Writes the stop-file sentinel. The typing loop checks this before every
 *  character and exits gracefully — no signal needed.
 *  Returns "not-running" if no session was active, "stopped" otherwise. */
export function requestStop(): StopRequestResult {
  writeFileSync(STOP_FILE, "stop", "utf8");
  return readRunningPid() === undefined ? "not-running" : "stopped";
}
