"use client";
import { useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { useEngineStore } from "@/store/engineStore";
import { send } from "@/lib/client/hub";

export function AuthPanel() {
  const { status: lastStatus, loginUrl, loginMessage, engineId, deviceName } = useAuthStore();
  // Each device reports its own `claude` login to its engines row.
  const status = useEngineStore((s) => (engineId ? s.engines[engineId]?.claude_auth : null)) ?? lastStatus;
  // Logging in runs `claude auth login` on the device itself, through its engine.
  const deviceOnline = useEngineStore((s) => !!engineId && s.online.includes(engineId));
  const [code, setCode] = useState("");

  function startLogin() {
    useAuthStore.getState().clearLoginFlow();
    send({ type: "login_start" }, engineId);
  }

  function submitCode() {
    if (!code.trim()) return;
    send({ type: "login_code", code: code.trim() }, engineId);
    useAuthStore.getState().setVerifying(true);
  }

  return (
    <>
      <div className="text-[12px] text-text-3 mb-3 leading-relaxed">
        The Claude account <span className="text-text-1 font-medium">{deviceName ?? "this device"}</span> uses to run your
        sessions. Each device has its own — changing it here only affects this device, but it does change Claude Code
        everywhere on that machine (VS Code, terminal).
      </div>
      {status?.state === "ready" ? (
        <div className="text-[13px] text-text-2 mb-3">
          {[
            ["Account", status.email || "unknown"],
            ["Organization", status.orgName || "—"],
            ["Plan", status.subscriptionType || "unknown"],
            ["Auth method", status.authMethod || "unknown"],
            [
              "Billing",
              status.apiProvider === "firstParty" ? "Subscription (not per-token API billing)" : status.apiProvider || "unknown",
            ],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 text-[12.5px] py-1.5 border-b border-panel-border-soft last:border-0">
              <span className="text-text-3 flex-none">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-text-2 mb-3">
          {status?.state === "cli_missing" ? (
            <>
              Claude Code isn&apos;t installed on this device, so it can&apos;t run sessions. On that machine run{" "}
              <code className="text-text-1">brew install --cask claude-code</code>, then{" "}
              <code className="text-text-1">claude auth login</code>, then restart its engine. (The copy inside the VS Code
              extension doesn&apos;t count.)
            </>
          ) : status?.state === "needs_reauth"
            ? "Your login has expired and needs to be renewed."
            : status
              ? "Claude Code hasn't been logged in yet on this machine."
              : "Checking…"}
        </div>
      )}

      {loginUrl && (
        <div className="mb-3">
          <a href={loginUrl} target="_blank" rel="noopener" className="block break-all text-accent-2 text-xs mb-3">
            {loginUrl}
          </a>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste the code here"
              className="flex-1 min-w-0 bg-black/22 border border-panel-border-soft rounded-lg py-2.5 px-2.5 text-[13px] text-text-1 outline-none focus:border-accent-soft-border"
            />
            <button onClick={submitCode} className="flex-none bg-success text-[#06281d] rounded-lg py-2.5 px-4 text-[13px] font-semibold">
              Submit
            </button>
          </div>
        </div>
      )}
      {loginMessage && <div className="text-[13px] text-danger mb-3">{loginMessage}</div>}

      {!deviceOnline && (
        <div className="text-[12.5px] text-warn mb-3">
          {deviceName ?? "This device"} is offline. Changing its Claude login needs its engine running — start it on that
          machine with <code>npm run engine:service -- start</code>.
        </div>
      )}
      {!loginUrl && (
        <button
          onClick={startLogin}
          disabled={!deviceOnline || status?.state === "cli_missing"}
          className="bg-gradient-to-br from-accent-2 to-accent-strong border-none rounded-lg py-2.5 px-4 text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Start login
        </button>
      )}
    </>
  );
}
