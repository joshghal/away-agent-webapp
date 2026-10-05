import { supabase } from "./supabase";
import { useGoalsStore, type Goal, type GoalMessage, type Task } from "@/store/goalsStore";

// The coordinator is the `coordinator` Edge Function. The browser only writes the
// owner's words into goal_messages and pokes the function; the function plans and
// queues tasks, devices run them. Everything shown here comes from the tables,
// kept live by Realtime.

const GOAL_COLUMNS = "id, title, status, work, cost_usd, created_at, updated_at";
const TASK_COLUMNS =
  "id, ref, goal_id, task_type, instructions, acceptance, repo, target_engine, required_capability, depends_on, permission_mode, status, needs_approval, engine_id, project_path, worktree, branch, pushed, session_id, result, error, created_at, finished_at";

export async function loadGoals(): Promise<void> {
  const { data, error } = await supabase.from("goals").select(GOAL_COLUMNS).order("updated_at", { ascending: false }).limit(100);
  if (error) return useGoalsStore.getState().setError(error.message);
  useGoalsStore.getState().setGoals(data as Goal[]);
}

export async function loadGoal(goalId: string): Promise<void> {
  const [msgs, tasks] = await Promise.all([
    supabase.from("goal_messages").select("id, goal_id, role, content, created_at").eq("goal_id", goalId).order("id").limit(1000),
    supabase.from("tasks").select(TASK_COLUMNS).eq("goal_id", goalId).order("created_at"),
  ]);
  if (msgs.error || tasks.error) return useGoalsStore.getState().setError((msgs.error ?? tasks.error)!.message);
  useGoalsStore.getState().setThread(goalId, msgs.data as GoalMessage[], tasks.data as Task[]);
}

export async function wake(goalId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("coordinator", { body: { goal_id: goalId } });
  if (!error) return;
  let message = error.message;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    message = (await ctx.json().catch(() => null))?.error ?? message;
  }
  useGoalsStore.getState().setError(`Coordinator: ${message}`);
}

export async function createGoal(title: string, work: boolean): Promise<string | null> {
  const { data, error } = await supabase.from("goals").insert({ title, work }).select(GOAL_COLUMNS).single();
  if (error) {
    useGoalsStore.getState().setError(error.message);
    return null;
  }
  useGoalsStore.getState().upsertGoal(data as Goal);
  const { error: msgError } = await supabase.from("goal_messages").insert({ goal_id: data.id, role: "user", content: { text: title } });
  if (msgError) useGoalsStore.getState().setError(msgError.message);
  else void wake(data.id);
  return data.id as string;
}

export async function postMessage(goal: Goal, text: string): Promise<void> {
  if (goal.status !== "active") await supabase.from("goals").update({ status: "active" }).eq("id", goal.id);
  const { error } = await supabase.from("goal_messages").insert({ goal_id: goal.id, role: "user", content: { text } });
  if (error) return useGoalsStore.getState().setError(error.message);
  void wake(goal.id);
}

export async function cancelTask(task: Task): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "cancelled", finished_at: new Date().toISOString(), error: "cancelled by you" })
    .eq("id", task.id)
    .in("status", ["queued", "running"]);
  if (error) return useGoalsStore.getState().setError(error.message);
  await supabase.from("goal_messages").insert({ goal_id: task.goal_id, role: "user", content: { text: `I cancelled ${task.ref}.` } });
  void wake(task.goal_id);
}

export async function setGoalStatus(goal: Goal, status: Goal["status"]): Promise<void> {
  const { error } = await supabase.from("goals").update({ status }).eq("id", goal.id);
  if (error) return useGoalsStore.getState().setError(error.message);
  if (status === "cancelled") {
    await supabase
      .from("tasks")
      .update({ status: "cancelled", finished_at: new Date().toISOString(), error: "goal cancelled" })
      .eq("goal_id", goal.id)
      .in("status", ["queued", "running"]);
  }
}

let subscribed = false;
export function subscribeCoordinator(): void {
  if (subscribed) return;
  subscribed = true;
  supabase
    .channel("coordinator")
    .on("postgres_changes", { event: "*", schema: "public", table: "goals" }, (p) => {
      if (p.eventType === "DELETE") return;
      useGoalsStore.getState().upsertGoal(p.new as Goal);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "goal_messages" }, (p) => {
      useGoalsStore.getState().addMessage(p.new as GoalMessage);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (p) => {
      if (p.eventType === "DELETE") return;
      useGoalsStore.getState().upsertTask(p.new as Task);
    })
    .subscribe();
}
