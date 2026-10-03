import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname, platform } from "node:os";

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

// The OS's permanent per-machine ID: survives renames and app reinstalls.
function hardwareId(): string {
  switch (platform()) {
    case "darwin":
      return run("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]).match(/"IOPlatformUUID" = "([^"]+)"/)?.[1] ?? "";
    case "linux":
      try {
        return readFileSync("/etc/machine-id", "utf8").trim();
      } catch {
        return "";
      }
    case "win32":
      return run("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]).match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] ?? "";
    default:
      return "";
  }
}

// "MacBook Pro · Apple M1 Pro" rather than the internal identifier "MacBookPro18,3".
function macModel(): string | null {
  const name = run("system_profiler", ["SPHardwareDataType"]).match(/Model Name:\s*(.+)/)?.[1]?.trim();
  const chip = run("sysctl", ["-n", "machdep.cpu.brand_string"]);
  return [name, chip].filter(Boolean).join(" · ") || run("sysctl", ["-n", "hw.model"]) || null;
}

export type DeviceInfo ={ fingerprint: string; device_name: string; model: string | null; platform: string };

export function deviceInfo(): DeviceInfo {
  const id = hardwareId() || `host:${hostname()}`;
  // Salted one-way hash: identifies the machine without publishing its real hardware ID.
  const fingerprint = createHash("sha256").update(`awayagent:${id}`).digest("hex").slice(0, 16);
  const isMac = platform() === "darwin";
  return {
    fingerprint,
    device_name: (isMac && run("scutil", ["--get", "ComputerName"])) || hostname().replace(/\.local$/, ""),
    model: isMac ? macModel() : null,
    platform: platform(),
  };
}
