import { supabase } from "./supabase";
import { wake } from "./coordinator";

export type Schedule = {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  work: boolean;
  enabled: boolean;
  skip_if_running: boolean;
  last_run_at: string | null;
  created_at: string;
};

const COLUMNS = "id, name, prompt, cron, timezone, work, enabled, skip_if_running, last_run_at, created_at";

export async function loadSchedules(): Promise<Schedule[]> {
  const { data, error } = await supabase.from("schedules").select(COLUMNS).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as Schedule[];
}

export async function createSchedule(s: Pick<Schedule, "name" | "prompt" | "cron" | "timezone" | "work">): Promise<void> {
  const { error } = await supabase.from("schedules").insert(s);
  if (error) throw new Error(error.message);
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from("schedules").update({ enabled }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSchedule(id: string): Promise<void> {
  const { error } = await supabase.from("schedules").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// Starts the schedule's goal right now, the same way the timer would.
export async function runScheduleNow(s: Schedule): Promise<string> {
  const stamp = new Date().toLocaleString("sv-SE", { timeZone: s.timezone }).slice(0, 16);
  const { data, error } = await supabase
    .from("goals")
    .insert({ title: `${s.name} · ${stamp} (manual)`, work: s.work, schedule_id: s.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const { error: msgError } = await supabase.from("goal_messages").insert({ goal_id: data.id, role: "user", content: { text: s.prompt } });
  if (msgError) throw new Error(msgError.message);
  void wake(data.id);
  return data.id as string;
}

// ---- cron helpers (the database owns the real matching; these build and describe) ----
export type Frequency = "hourly" | "daily" | "weekdays" | "weekly" | "custom";

export function buildCron(freq: Exclude<Frequency, "custom">, time: string, weekday: number): string {
  const [h, m] = time.split(":").map((n) => Number(n));
  switch (freq) {
    case "hourly":
      return `${m} * * * *`;
    case "daily":
      return `${m} ${h} * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${weekday}`;
  }
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function describeCron(cron: string): string {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return cron;
  const [m, h, dom, mon, dow] = f;
  const num = /^\d+$/;
  const clock = num.test(m) && num.test(h) ? `${h.padStart(2, "0")}:${m.padStart(2, "0")}` : null;
  if (dom === "*" && mon === "*") {
    if (h === "*" && num.test(m) && dow === "*") return `Every hour at :${m.padStart(2, "0")}`;
    if (clock && dow === "*") return `Every day at ${clock}`;
    if (clock && dow === "1-5") return `Weekdays at ${clock}`;
    if (clock && num.test(dow)) return `${DAYS[Number(dow) % 7]}s at ${clock}`;
  }
  return cron;
}
