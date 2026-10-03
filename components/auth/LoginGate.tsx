"use client";
import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/client/supabase";
import { claimSlot, startSlotHeartbeat, KICKED_NOTICE_KEY, type SlotResult } from "@/lib/client/loginSlot";
import { timeAgo } from "@/lib/client/timeAgo";

// Owners need a 2FA-verified session (aal2): the database itself refuses data
// otherwise (see the require_mfa migration), this screen just guides you there.
type GateState = "loading" | "signedOut" | "notMember" | "mfaEnroll" | "mfaVerify" | "slotTaken" | "ready";

const inputClass =
  "bg-black/22 border border-panel-border-soft rounded-lg py-2.5 px-3 text-[13.5px] text-text-1 placeholder:text-text-3 outline-none focus:border-accent-soft-border";
const primaryClass =
  "mt-1 rounded-lg py-2.5 text-[13.5px] font-semibold text-white bg-gradient-to-br from-accent-2 to-accent-strong disabled:opacity-60 flex items-center justify-center gap-2";

function Spinner() {
  return <span className="w-[13px] h-[13px] rounded-full border-2 border-white/25 border-t-white animate-spin-slow" />;
}

export function LoginGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<GateState>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<{ qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingText, setLoadingText] = useState("Loading…");
  const [holder, setHolder] = useState<SlotResult | null>(null);

  async function startEnrollment(): Promise<void> {
    // An abandoned earlier attempt leaves an unverified factor that blocks a new one.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const f of factors?.all ?? []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "AwayAgent" });
    if (error || !data) {
      setError(error?.message ?? "Couldn't start 2FA setup");
      return;
    }
    setFactorId(data.id);
    setEnrollment({ qr: data.totp.qr_code, secret: data.totp.secret });
    setGate("mfaEnroll");
  }

  async function check(session: Session | null): Promise<void> {
    try {
      await resolveGate(session);
    } catch (e) {
      setError(`Couldn't finish signing in: ${(e as Error).message}`);
      setGate("signedOut");
    }
  }

  async function resolveGate(session: Session | null): Promise<void> {
    if (!session) return setGate("signedOut");
    const { data: member, error: memberError } = await supabase.from("members").select("role").maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!member) return setGate("notMember");

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") {
      // One active login per account, first wins: the database refuses data to
      // any other session until this slot is released or goes idle.
      const slot = await claimSlot();
      if (!slot.granted) {
        setHolder(slot);
        return setGate("slotTaken");
      }
      // Realtime holds its own copy of the token; hand it the upgraded (aal2) one.
      await supabase.realtime.setAuth();
      return setGate("ready");
    }
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp.find((f) => f.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setGate("mfaVerify");
    } else {
      await startEnrollment();
    }
  }

  // While inside the app, keep renewing the slot. Losing it (this device sat idle
  // 10+ minutes and another one signed in) signs this device out.
  useEffect(() => {
    if (gate !== "ready") return;
    return startSlotHeartbeat(async (taken) => {
      sessionStorage.setItem(
        KICKED_NOTICE_KEY,
        `Signed out: your account is now active on ${taken.holderDevice ?? "another device"}.`
      );
      await supabase.auth.signOut({ scope: "local" });
      location.reload(); // drops hub channels and in-memory state in one go
    });
  }, [gate]);

  useEffect(() => {
    const kicked = sessionStorage.getItem(KICKED_NOTICE_KEY);
    if (kicked) {
      sessionStorage.removeItem(KICKED_NOTICE_KEY);
      setError(kicked);
    }
    void supabase.auth.getSession().then(({ data }) => check(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Deferred: awaiting Supabase calls inside this callback can deadlock the auth client.
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => void check(session), 0);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // The SIGNED_IN listener resolves the next step (2FA setup/code); keep the
    // form from looking idle and re-submittable while that runs.
    setLoadingText("Signing in…");
    setGate("loading");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    setCode("");
    setBusy(false);
    setLoadingText("Verifying…");
    setGate("loading");
    const { data } = await supabase.auth.getSession();
    await check(data.session);
  }

  if (gate === "ready") return <>{children}</>;

  const codeForm = (
    <form onSubmit={verifyCode} className="flex flex-col gap-2.5">
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        placeholder="6-digit code"
        required
        autoFocus
        className={`${inputClass} tracking-[0.3em] text-center`}
      />
      {error && <div className="text-[12px] text-danger">{error}</div>}
      <button type="submit" disabled={busy || code.length !== 6} className={primaryClass}>
        {busy && <Spinner />}
        {busy ? "Verifying…" : "Verify"}
      </button>
    </form>
  );

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-[360px] bg-panel-strong border border-panel-border rounded-xl shadow-2xl p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <Image src="/logo-gem-v4.png" alt="" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" />
          <span className="text-[28px] leading-none" style={{ fontFamily: "var(--font-brand)" }}>
            AwayAgent
          </span>
        </div>

        {gate === "loading" && (
          <div className="flex items-center gap-2.5 py-6 justify-center text-[13px] text-text-2" role="status" aria-live="polite">
            <span className="w-[15px] h-[15px] rounded-full border-2 border-white/15 border-t-text-1 animate-spin-slow" />
            {loadingText}
          </div>
        )}

        {gate === "signedOut" && (
          <form onSubmit={signIn} className="flex flex-col gap-2.5">
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className={inputClass}
            />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className={inputClass}
            />
            {error && <div className="text-[12px] text-danger">{error}</div>}
            <button type="submit" disabled={busy} className={primaryClass}>
              {busy && <Spinner />}
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {gate === "notMember" && (
          <p className="text-[13px] text-text-2 mb-4">
            This account isn&apos;t authorized for AwayAgent.
          </p>
        )}

        {gate === "mfaEnroll" && enrollment && (
          <>
            <p className="text-[13px] text-text-2 mb-3">
              Two-factor login is required. Scan this with an authenticator app (Google Authenticator, 1Password, Authy…),
              then enter the 6-digit code it shows.
            </p>
            <div className="bg-white rounded-lg p-3 mb-3 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI from Supabase */}
              <img src={enrollment.qr} alt="2FA QR code" className="w-[180px] h-[180px]" />
            </div>
            <p className="text-[11px] text-text-3 mb-3 break-all">
              Can&apos;t scan? Enter this key manually: <span className="text-text-2 font-mono">{enrollment.secret}</span>
            </p>
            {codeForm}
          </>
        )}

        {gate === "slotTaken" && (
          <>
            <p className="text-[13px] text-text-2 mb-2">
              Your account is already signed in on <span className="text-text-1 font-medium">{holder?.holderDevice ?? "another device"}</span>
              {holder?.holderLastSeen ? ` (active ${timeAgo(holder.holderLastSeen)})` : ""}.
            </p>
            <p className="text-[12px] text-text-3 mb-3 leading-relaxed">
              Only one device can be signed in at a time. Sign out there first — or if that device is closed or lost, this
              frees up automatically after 10 minutes of inactivity.
            </p>
            <button
              onClick={async () => {
                setBusy(true);
                const { data } = await supabase.auth.getSession();
                await check(data.session);
                setBusy(false);
              }}
              disabled={busy}
              className={`w-full ${primaryClass}`}
            >
              {busy && <Spinner />}
              {busy ? "Checking…" : "Try again"}
            </button>
          </>
        )}

        {gate === "mfaVerify" && (
          <>
            <p className="text-[13px] text-text-2 mb-3">Enter the 6-digit code from your authenticator app.</p>
            {codeForm}
          </>
        )}

        {gate !== "signedOut" && gate !== "loading" && (
          <button
            onClick={() => supabase.auth.signOut({ scope: "local" })}
            className="w-full mt-3 text-[12px] text-text-3 hover:text-text-1 transition-colors"
          >
            Use a different account
          </button>
        )}
      </div>
    </div>
  );
}
