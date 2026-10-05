"use client";
import { useEffect, useState } from "react";
import { PlusIcon, TrashIcon } from "@/components/icons/icons";
import { Sheet } from "@/components/sheets/Sheet";
import { Dropdown } from "@/components/settings/Dropdown";
import { Alert, Button, CheckboxField, IconButton, Switch, TextInput, Textarea } from "@/components/ui";
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

const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
  { value: "custom", label: "Custom (cron)" },
];

const WEEKDAY_OPTIONS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, i) => ({
  value: String(i),
  label,
}));

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
    let cancelled = false;
    api
      .load()
      .then((rows) => !cancelled && setItems(rows))
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setItems((prev) => prev ?? []);
      });
    return () => {
      cancelled = true;
    };
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
      {error && <Alert>{error}</Alert>}
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
              <Switch
                checked={s.enabled}
                label={s.enabled ? "Pause schedule" : "Resume schedule"}
                data-testid="schedule-toggle"
                disabled={busyId === s.id}
                onChange={(on) => void act(s.id, () => api.setEnabled(s.id, on))}
              />
            </div>
            <div className="text-[12px] text-text-2 mt-2 line-clamp-2 whitespace-pre-wrap">{s.prompt}</div>
            <div className="flex items-center gap-2 mt-2.5">
              <span className="flex-1 text-[11px] text-text-3">
                {s.last_run_at ? `Last ran ${timeAgo(s.last_run_at)}` : "Never run"}
              </span>
              <Button
                variant="subtle"
                size="xs"
                data-testid="schedule-run"
                disabled={busyId === s.id}
                onClick={() =>
                  void act(s.id, async () => {
                    onRan?.(await api.runNow(s));
                  })
                }
              >
                Run now
              </Button>
              <IconButton
                size={28}
                tone="danger"
                data-testid="schedule-delete"
                aria-label="Delete schedule"
                disabled={busyId === s.id}
                onClick={() => {
                  if (confirm(`Delete schedule "${s.name}"?`)) void act(s.id, () => api.remove(s.id));
                }}
              >
                <TrashIcon className="w-[14px] h-[14px]" />
              </IconButton>
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-panel-border-soft flex-none">
        <Button
          variant="tinted"
          size="xl"
          className="w-full flex items-center justify-center gap-2"
          data-testid="schedule-new"
          onClick={() => setComposing(true)}
        >
          <PlusIcon className="w-4 h-4" />
          New schedule
        </Button>
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
        <TextInput
          fieldSize="lg"
          className="w-full"
          data-testid="schedule-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name, e.g. Morning PR check"
        />
        <Textarea
          data-testid="schedule-prompt"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should it do each time? Written like a goal, e.g. Review open PRs in nanovest-rn and summarize what needs attention."
        />
        <div data-testid="schedule-freq">
          <Dropdown value={freq} options={FREQUENCY_OPTIONS} onChange={(v) => setFreq(v as Frequency)} />
        </div>
        {freq !== "custom" && (
          <div className="flex gap-2">
            {freq === "weekly" && (
              <div className="flex-1 min-w-0" data-testid="schedule-weekday">
                <Dropdown value={String(weekday)} options={WEEKDAY_OPTIONS} onChange={(v) => setWeekday(Number(v))} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <TextInput
                fieldSize="lg"
                className="w-full"
                data-testid="schedule-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                aria-label={freq === "hourly" ? "Minute past the hour (the hour part is ignored)" : "Time of day"}
              />
            </div>
          </div>
        )}
        {freq === "custom" && (
          <TextInput
            fieldSize="lg"
            className="w-full font-mono"
            data-testid="schedule-cron"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="minute hour day month weekday, e.g. 30 8 * * 1-5"
          />
        )}
        <TextInput
          fieldSize="lg"
          className="w-full"
          data-testid="schedule-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Timezone, e.g. Asia/Jakarta"
        />
        <div className="text-[12px] text-text-3" data-testid="schedule-summary">
          Runs: <span className="text-text-2">{cron ? describeCron(cron) : "…"}</span> ({timezone || "…"}). If the previous run is still going, the next one is skipped.
        </div>
        <CheckboxField
          checked={work}
          onChange={setWork}
          label="Work goal"
          description={<>Uses Claude Haiku · runs only on devices tagged &quot;work&quot;</>}
        />
        {error && (
          <div role="alert" data-testid="schedule-error" className="text-[12px] text-danger">
            {error}
          </div>
        )}
        <Button size="lg" className="w-full" data-testid="schedule-submit" onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? "Saving…" : "Create schedule"}
        </Button>
      </div>
    </Sheet>
  );
}
