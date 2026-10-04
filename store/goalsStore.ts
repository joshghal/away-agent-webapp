import { create } from "zustand";

export type Goal = {
  id: string;
  title: string;
  status: "active" | "done" | "cancelled";
  work: boolean;
  cost_usd: number;
  created_at: string;
  updated_at: string;
};

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type GoalMessage = {
  id: number;
  goal_id: string;
  role: "user" | "assistant" | "tool" | "event";
  content: { text?: string; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string; model?: string };
  created_at: string;
};

export type Task = {
  id: string;
  ref: string;
  goal_id: string;
  task_type: string;
  instructions: string;
  acceptance: string;
  repo: string;
  target_engine: string | null;
  required_capability: string | null;
  depends_on: string[];
  permission_mode: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  needs_approval: boolean;
  engine_id: string | null;
  project_path: string | null;
  worktree: string | null;
  branch: string | null;
  pushed: boolean;
  session_id: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

type GoalsState = {
  goals: Goal[];
  loaded: boolean;
  selectedId: string | null;
  messages: Record<string, GoalMessage[]>;
  tasks: Record<string, Task[]>;
  error: string | null;
  setGoals: (goals: Goal[]) => void;
  upsertGoal: (goal: Goal) => void;
  select: (id: string | null) => void;
  setThread: (goalId: string, messages: GoalMessage[], tasks: Task[]) => void;
  addMessage: (m: GoalMessage) => void;
  upsertTask: (t: Task) => void;
  setError: (e: string | null) => void;
};

export const useGoalsStore = create<GoalsState>((set) => ({
  goals: [],
  loaded: false,
  selectedId: null,
  messages: {},
  tasks: {},
  error: null,
  setGoals: (goals) => set({ goals, loaded: true }),
  upsertGoal: (goal) =>
    set((s) => {
      const rest = s.goals.filter((g) => g.id !== goal.id);
      const prev = s.goals.find((g) => g.id === goal.id);
      // Realtime UPDATEs can omit large unchanged columns; merge instead of replacing.
      return { goals: [{ ...prev, ...goal }, ...rest].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)) };
    }),
  select: (selectedId) => set({ selectedId, error: null }),
  setThread: (goalId, messages, tasks) => set((s) => ({ messages: { ...s.messages, [goalId]: messages }, tasks: { ...s.tasks, [goalId]: tasks } })),
  addMessage: (m) =>
    set((s) => {
      const list = s.messages[m.goal_id];
      if (!list || list.some((x) => x.id === m.id)) return s;
      return { messages: { ...s.messages, [m.goal_id]: [...list, m] } };
    }),
  upsertTask: (t) =>
    set((s) => {
      const list = s.tasks[t.goal_id];
      if (!list) return s;
      const i = list.findIndex((x) => x.id === t.id);
      const next = i >= 0 ? list.map((x, j) => (j === i ? { ...x, ...t } : x)) : [...list, t];
      return { tasks: { ...s.tasks, [t.goal_id]: next } };
    }),
  setError: (error) => set({ error }),
}));
