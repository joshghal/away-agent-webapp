import { spawn } from "node:child_process";

export type CliModel = { value: string; label: string; description: string };

// Asks this device's own `claude` CLI which models it offers (the same list its
// /model picker shows) via the stream-json control protocol, then exits it.
export function listCliModels(timeoutMs = 15_000): Promise<CliModel[] | null> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let buf = "";
    let done = false;
    const finish = (models: CliModel[] | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(models);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.on("error", () => finish(null));
    child.on("close", () => finish(null));
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.type === "control_response" && msg.response?.request_id === "models") {
            const list = msg.response.response?.models;
            finish(
              Array.isArray(list)
                ? list.map((m: { value: string; displayName?: string; description?: string }) => ({
                    value: m.value,
                    label: m.displayName || m.value,
                    description: m.description || "",
                  }))
                : null
            );
          }
        } catch {
          // not JSON — ignore
        }
      }
    });
    child.stdin.write(JSON.stringify({ type: "control_request", request_id: "models", request: { subtype: "initialize" } }) + "\n");
  });
}
