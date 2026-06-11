import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { writeFileSync } from "fs";
import { STOP_FILE } from "./session";

const MONITOR_SCRIPT = "/tmp/raycast-fp-monitor.py";

// Polls hardware key state via CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, 53).
// kCGEventSourceStateHIDSystemState = 1 reflects only physical hardware events — synthetic
// keystrokes sent by osascript do NOT appear here, so this never false-fires on typed chars.
// CGEventSourceKeyState requires no permissions (reads accumulated state, not an event tap).
const PYTHON_SCRIPT = `
import ctypes, ctypes.util, time, sys
STOP = ${JSON.stringify(STOP_FILE)}
lib = ctypes.util.find_library('CoreGraphics')
if not lib:
    sys.exit(1)
CG = ctypes.CDLL(lib)
CG.CGEventSourceKeyState.restype = ctypes.c_bool
CG.CGEventSourceKeyState.argtypes = [ctypes.c_int, ctypes.c_uint16]
HID = 1   # kCGEventSourceStateHIDSystemState
ESC = 53  # kVK_Escape
while True:
    if CG.CGEventSourceKeyState(HID, ESC):
        open(STOP, 'w').write('stop')
        break
    time.sleep(0.05)
`.trim();

/**
 * Spawns a background Python3 process that watches for the Escape key using
 * CGEventSourceKeyState (hardware state only). When Esc is pressed, it writes
 * the stop-file sentinel so the typing loop exits on the next character.
 *
 * Returns null if python3 is not available; the caller treats that as a no-op
 * and the existing Raycast-command stop mechanism continues to work.
 */
export function spawnEscapeMonitor(): ChildProcess | null {
  try {
    writeFileSync(MONITOR_SCRIPT, PYTHON_SCRIPT, "utf8");
    return spawn("/usr/bin/python3", [MONITOR_SCRIPT], {
      detached: false,
      stdio: "ignore",
    });
  } catch {
    return null;
  }
}
