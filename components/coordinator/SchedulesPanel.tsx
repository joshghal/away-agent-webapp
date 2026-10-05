"use client";
import { useEffect, useState } from "react";
import { PlusIcon, TrashIcon } from "@/components/icons/icons";
import { Sheet } from "@/components/sheets/Sheet";
import { timeAgo } from "@/lib/client/timeAgo";
import * as realApi from "@/lib/client/schedules";
import { buildCron, describeCron, type Frequency, type Schedule } from "@/lib/client/schedules";

export type ScheduleApi = {
  load: () => Promise<Schedule[]>;
  create: (s: Pick<Schedule, "name" | "prompt" | "cron" | "timezone" | "work">) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  runNow: (s: Schedule) => Promise<string>;
};

const defaultApi: ScheduleApi = {
  load: realApi.loadSchedules,
  create: realApi.createSchedule,
  setEnabled: realApi.setScheduleEnabled,
  remove: realApi.deleteSchedule,
  runNow: realApi.runScheduleNow,
};

const field =
  "w-full bg-black/22 border border-panel-border-soft rounded-xl px-3 py-2.5 text-[14px] text-text-1 outline-none focus:border-accent-soft-border placeholder:text-text-3";

export function SchedulesPanel({ api = defaultApi, onRan }: { api?: ScheduleApi; onRan?: (goalId: string) => void }) {
  const [items, setItems] = useState<Schedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    try {
      setItems(await api.load());
    } catch (e) {
      setError((e as Error).message);
      setItems((prev) => prev ?? []);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {error && (
        <div role="alert" className="mx-3 mt-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger flex-none">
          {error}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto p-2" data-testid="schedule-list">
        {items === null && <div className="text-[13px] text-text-3 text-center py-10">Loading…</div>}
        {items?.length === 0 && !error && (
          <div className="text-[13px] text-text-3 text-center py-10 leading-relaxed px-4">
            No schedules yet.
            <div className="mt-1 text-text-2">A schedule starts a goal for you on a timer, like a morning briefing.</div>
          </div>
        )}
        {items?.map((s) => (
          <div
            key={s.id}
            data-testid="schedule-row"
            className={`rounded-xl px-3 py-3 mb-1 border border-panel-border-soft ${s.enabled ? "" : "opacity-55"}`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium text-text-1 truncate">{s.name}</div>
                <div className="text-[11px] text-accent-2 mt-0.5">
                  {describeCron(s.cron)} <span className="text-text-3">· {s.timezone}</span>
                  {s.work && <span className="text-accent-2/70"> · work</span>}
                </div>
              </div>
              <button
                role="switch"
                aria-checked={s.enabled}
                aria-label={s.enabled ? "Pause schedule" : "Resume schedule"}
                data-testid="schedule-toggle"
                disabled={busyId === s.id}
                onClick={() => void act(s.id, () => api.setEnabled(s.id, !s.enabled))}
                className={`relative w-9 h-5 rounded-full flex-none transition-colors ${s.enabled ? "bg-accent-strong" : "bg-white/15"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${s.enabled ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </div>
            <div className="text-[12px] text-text-2 mt-2 line-clamp-2 whitespace-pre-wrap">{s.prompt}</div>
            <div className="flex items-center gap-2 mt-2.5">
              <span className="flex-1 text-[11px] text-text-3">
                {s.last_run_at ? `Last ran ${timeAgo(s.last_run_at)}` : "Never run"}
              </span>
              <button
                data-testid="schedule-run"
                disabled={busyId === s.id}
                onClick={() =>
                  void act(s.id, async () => {
                    onRan?.(await api.runNow(s));
                  })
                }
                className="text-[12px] px-2.5 py-1 rounded-lg border border-panel-border-soft text-text-2 hover:text-text-1 hover:bg-hover disabled:opacity-50"
              >
                Run now
              </button>
              <button
                data-testid="schedule-delete"
                aria-label="Delete schedule"
                disabled={busyId === s.id}
                onClick={() => {
                  if (confirm(`Delete schedule "${s.name}"?`)) void act(s.id, () => api.remove(s.id));
                }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-3 hover:text-danger hover:bg-danger-soft disabled:opacity-50"
              >
                <TrashIcon className="w-[14px] h-[14px]" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-panel-border-soft flex-none">
        <button
          data-testid="schedule-new"
          onClick={() => setComposing(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent-soft border border-accent-soft-border text-[13.5px] font-semibold text-accent-2 hover:bg-accent/20 transition-colors active:scale-[0.98]"
        >
          <PlusIcon className="w-4 h-4" />
          New schedule
        </button>
      </div>
      <NewScheduleSheet
        open={composing}
        api={api}
        onClose={() => setComposing(false)}
        onCreated={() => {
          setComposing(false);
          void reload();
        }}
      />
    </>
  );
}

function NewScheduleSheet({ open, api, onClose, onCreated }: { open: boolean; api: ScheduleApi; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [freq, setFreq] = useState<Frequency>("daily");
  const [time, setTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  const [custom, setCustom] = useState("");
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });
  const [work, setWork] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cron = freq === "custom" ? custom.trim() : buildCron(freq, time, weekday);
  const ready = name.trim() && prompt.trim() && cron && timezone.trim();

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.create({ name: name.trim(), prompt: prompt.trim(), cron, timezone: timezone.trim(), work });
      setName("");
      setPrompt("");
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New schedule">
      <div className="space-y-3.5">
        <input data-testid="schedule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Morning PR check" className={field} />
        <textarea
          data-testid="schedule-prompt"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should it do each time? Written like a goal, e.g. Review open PRs in nanovest-rn and summarize what needs attention."
          className={`${field} resize-none leading-relaxed`}
        />
        <div className="flex gap-2">
          <select data-testid="schedule-freq" value={freq} onChange={(e) => setFreq(e.target.value as Frequency)} className={field}>
            <option value="hourly">Every hour</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekly">Every week</option>
            <option value="custom">Custom (cron)</option>
          </select>
          {freq === "weekly" && (
            <select data-testid="schedule-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={field}>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          )}
          {freq !== "custom" && freq !== "hourly" && (
            <input data-testid="schedule-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} />
          )}
          {freq === "hourly" && (
            <input
              data-testid="schedule-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Minute past the hour (the hour part is ignored)"
              className={field}
            />
          )}
        </div>
        {freq === "custom" && (
          <input
            data-testid="schedule-cron"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="minute hour day month weekday, e.g. 30 8 * * 1-5"
            className={`${field} font-mono text-[13px]`}
          />
        )}
        <input data-testid="schedule-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Timezone, e.g. Asia/Jakarta" className={field} />
        <div className="text-[12px] text-text-3" data-testid="schedule-summary">
          Runs: <span className="text-text-2">{cron ? describeCron(cron) : "…"}</span> ({timezone || "…"}). If the previous run is still going, the next one is skipped.
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={work} onChange={(e) => setWork(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[var(--color-accent)] flex-none" />
          <div>
            <div className="text-[13px] text-text-1 font-medium">Work goal</div>
            <div className="text-[11.5px] text-text-3 mt-0.5">Uses Claude Haiku · runs only on devices tagged &quot;work&quot;</div>
          </div>
        </label>
        {error && (
          <div role="alert" data-testid="schedule-error" className="text-[12px] text-danger">
            {error}
          </div>
        )}
        <button
          data-testid="schedule-submit"
          onClick={() => void submit()}
          disabled={!ready || busy}
          className="w-full py-3.5 rounded-xl font-semibold text-[14px] text-white bg-gradient-to-br from-accent-2 to-accent-strong disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {busy ? "Saving…" : "Create schedule"}
        </button>
      </div>
    </Sheet>
  );
}
