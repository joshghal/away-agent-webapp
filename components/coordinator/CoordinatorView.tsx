"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGoalsStore, type Goal, type GoalMessage, type Task } from "@/store/goalsStore";
import { useEngineStore } from "@/store/engineStore";
import { useUiStore } from "@/store/uiStore";
import { loadGoals, loadGoal, createGoal, postMessage, cancelTask, setGoalStatus, subscribeCoordinator } from "@/lib/client/coordinator";
import { switchProject } from "@/lib/client/switchProject";
import { renderMarkdown } from "@/lib/client/renderMarkdown";
import { timeAgo } from "@/lib/client/timeAgo";
import { SendIcon, PlusIcon, ChevronRightIcon } from "@/components/icons/icons";
import { Sheet } from "@/components/sheets/Sheet";
import { SchedulesPanel } from "./SchedulesPanel";
import { Alert, Button, CheckboxField, IconButton, Textarea } from "@/components/ui";

// ---- Status helpers ----

const DOT_CLASS: Record<string, string> = {
  queued:   "bg-text-3",
  running:  "bg-accent-2 animate-turn-pulse",
  approval: "bg-warn animate-turn-pulse",
  done:     "bg-success",
  failed:   "bg-danger",
  cancelled:"bg-text-3/40",
  active:   "bg-accent-2 animate-turn-pulse",
};
const TEXT_CLASS: Record<string, string> = {
  queued:   "text-text-3",
  running:  "text-accent-2",
  approval: "text-warn",
  done:     "text-success",
  failed:   "text-danger",
  cancelled:"text-text-3",
  active:   "text-accent-2",
};
const PILL_CLASS: Record<string, string> = {
  queued:   "border-panel-border-soft text-text-2",
  running:  "border-accent-soft-border text-accent-2 bg-accent-soft",
  approval: "border-warn/50 text-warn bg-warn-soft",
  done:     "border-success/30 text-success bg-success-soft",
  failed:   "border-danger/30 text-danger bg-danger-soft",
  cancelled:"border-panel-border-soft text-text-3",
};

function taskKind(t: Task): string {
  return t.needs_approval && t.status === "running" ? "approval" : t.status;
}

function Dot({ status }: { status: string }) {
  return <span className={`inline-block w-2 h-2 rounded-full flex-none ${DOT_CLASS[status] ?? DOT_CLASS.queued}`} />;
}

function useDeviceName() {
  const engines = useEngineStore((s) => s.engines);
  return (id: string | null | undefined) => id ? (engines[id]?.device_name || id) : "any device";
}

// ---- Root ----

export function CoordinatorView() {
  const { goals, loaded, selectedId, select, error, setError } = useGoalsStore();
  const selected = goals.find((g) => g.id === selectedId) ?? null;
  const [tab, setTab] = useState<"goals" | "schedules">("goals");

  useEffect(() => { subscribeCoordinator(); void loadGoals(); }, []);
  useEffect(() => { if (selectedId) void loadGoal(selectedId); }, [selectedId]);

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* Goal list — full screen on mobile when nothing selected, left panel on desktop */}
      <div className={`${selected ? "hidden md:flex" : "flex"} w-full md:w-72 flex-none flex-col min-h-0 border-r border-panel-border-soft`}>
        <div role="tablist" className="flex gap-1 px-2 pt-2 pb-1.5 border-b border-panel-border-soft flex-none">
          {(["goals", "schedules"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              data-testid={`tab-${t}`}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold uppercase tracking-wider transition-colors ${
                tab === t ? "bg-active text-text-1" : "text-text-3 hover:text-text-2"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "goals" ? (
          <GoalList
            goals={goals}
            loaded={loaded}
            selectedId={selectedId}
            onSelect={select}
            onCreated={(id) => select(id)}
          />
        ) : (
          <SchedulesPanel
            onRan={(id) => {
              void loadGoals();
              select(id);
              setTab("goals");
            }}
          />
        )}
      </div>

      {/* Detail — full screen on mobile when selected, right panel on desktop */}
      <div className={`${selected ? "flex" : "hidden md:flex"} flex-1 min-w-0 flex-col min-h-0 overflow-hidden`}>
        {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
        {selected
          ? <GoalDetail goal={selected} onBack={() => select(null)} />
          : <EmptyState />}
      </div>
    </div>
  );
}

// ---- Goal list ----

function GoalList({ goals, loaded, selectedId, onSelect, onCreated }: {
  goals: Goal[]; loaded: boolean; selectedId: string | null;
  onSelect: (id: string) => void; onCreated: (id: string) => void;
}) {
  const [composing, setComposing] = useState(false);
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {!loaded && <div className="text-[13px] text-text-3 text-center py-10">Loading…</div>}
        {loaded && !goals.length && (
          <div className="text-[13px] text-text-3 text-center py-10 leading-relaxed px-4">
            No goals yet.
            <div className="mt-1 text-text-2">Tap <b>New goal</b> to describe something you want done.</div>
          </div>
        )}
        {goals.map((g) => <GoalRow key={g.id} goal={g} selected={g.id === selectedId} onClick={() => onSelect(g.id)} />)}
      </div>
      <div className="p-3 border-t border-panel-border-soft flex-none">
        <Button variant="tinted" size="xl" className="w-full flex items-center justify-center gap-2" onClick={() => setComposing(true)}>
          <PlusIcon className="w-4 h-4" />
          New goal
        </Button>
      </div>
      <NewGoalSheet
        open={composing}
        onClose={() => setComposing(false)}
        onCreated={(id) => { setComposing(false); onCreated(id); }}
      />
    </>
  );
}

function GoalRow({ goal, selected, onClick }: { goal: Goal; selected: boolean; onClick: () => void }) {
  const kind = goal.status === "active" ? "active" : goal.status;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl px-3 py-3 mb-0.5 flex items-start gap-3 transition-colors ${selected ? "bg-active" : "hover:bg-hover active:bg-active"}`}
    >
      <Dot status={kind} />
      <div className="flex-1 min-w-0 -mt-px">
        <div className="text-[13.5px] text-text-1 line-clamp-2 leading-snug">{goal.title}</div>
        <div className={`text-[11px] mt-1 ${TEXT_CLASS[kind]}`}>
          {goal.status}
          {goal.work && <span className="text-accent-2/70 ml-2">· work</span>}
          <span className="text-text-3 ml-2">· {timeAgo(goal.updated_at)}</span>
        </div>
      </div>
      <ChevronRightIcon className="w-3.5 h-3.5 text-text-3 flex-none mt-1" />
    </button>
  );
}

// ---- New goal sheet ----

function NewGoalSheet({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [work, setWork] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    const id = await createGoal(title, work);
    setBusy(false);
    if (id) { setText(""); setWork(false); onCreated(id); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New goal">
      <div className="space-y-4">
        <Textarea
          rows={5}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }}
          placeholder={'Describe what you want done — e.g. "Add a dark-mode toggle, get it reviewed, then open a PR."'}
        />
        <CheckboxField
          checked={work}
          onChange={setWork}
          label="Work goal"
          description={<>Uses Claude Haiku · runs only on devices tagged &quot;work&quot;</>}
        />
        <Button size="lg" className="w-full" onClick={() => void submit()} disabled={!text.trim() || busy}>
          {busy ? "Starting…" : "Start goal"}
        </Button>
      </div>
    </Sheet>
  );
}

// ---- Goal detail ----

function GoalDetail({ goal, onBack }: { goal: Goal; onBack: () => void }) {
  const messages = useGoalsStore((s) => s.messages[goal.id]);
  const tasks = useGoalsStore((s) => s.tasks[goal.id]) ?? [];
  const setView = useUiStore((s) => s.setView);
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages?.length]);

  const toolResults = useMemo(() => {
    const m = new Map<string, string>();
    for (const msg of messages ?? []) {
      if (msg.role === "tool" && msg.content.tool_call_id) m.set(msg.content.tool_call_id, msg.content.text ?? "");
    }
    return m;
  }, [messages]);

  function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    void postMessage(goal, t);
  }

  const activeTasks = tasks.filter((t) => t.status === "running" || t.status === "queued");
  const approvalTask = tasks.find((t) => t.needs_approval && t.status === "running");
  const needsApproval = !!approvalTask;
  const shortTitle = goal.title.length > 45 ? goal.title.slice(0, 43) + "…" : goal.title;

  return (
    <>
      {/* Header */}
      <div className="flex-none px-3 py-2.5 border-b border-panel-border-soft flex items-center gap-2">
        <IconButton size={32} className="md:hidden -ml-1.5" onClick={onBack} aria-label="Back">
          <ChevronRightIcon className="w-4 h-4 rotate-180" />
        </IconButton>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-medium text-text-1 truncate leading-snug">{shortTitle}</div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px]">
            <Dot status={goal.status === "active" ? "active" : goal.status} />
            <span className={TEXT_CLASS[goal.status]}>{goal.status}</span>
            {goal.work && <span className="text-accent-2/70">work</span>}
            {activeTasks.length > 0 && !needsApproval && (
              <span className="text-text-3">{activeTasks.length} running</span>
            )}
            {needsApproval && (
              <button
                onClick={() => setActiveTask(approvalTask!)}
                className="text-warn font-semibold underline underline-offset-2 decoration-warn/50"
              >
                needs your approval ↗
              </button>
            )}
            {Number(goal.cost_usd) > 0 && (
              <span className="text-text-3">${Number(goal.cost_usd).toFixed(4)}</span>
            )}
          </div>
        </div>

        {/* ··· menu */}
        <div className="relative flex-none">
          <IconButton size={36} radius="xl" onClick={() => setMenuOpen(!menuOpen)} aria-label="More actions">
            <span className="text-[18px] leading-none tracking-tighter">···</span>
          </IconButton>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-10 z-30 min-w-[160px] bg-sheet-bg border border-panel-border rounded-2xl shadow-2xl overflow-hidden">
                {goal.status === "active" ? (
                  <>
                    <button
                      onClick={() => { void setGoalStatus(goal, "done"); setMenuOpen(false); }}
                      className="w-full text-left px-4 py-3 text-[13.5px] text-success hover:bg-hover"
                    >
                      Mark done
                    </button>
                    <div className="mx-3 border-t border-panel-border-soft" />
                    <button
                      onClick={() => { void setGoalStatus(goal, "cancelled"); setMenuOpen(false); }}
                      className="w-full text-left px-4 py-3 text-[13.5px] text-danger hover:bg-hover"
                    >
                      Cancel goal
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { void setGoalStatus(goal, "active"); setMenuOpen(false); }}
                    className="w-full text-left px-4 py-3 text-[13.5px] text-text-1 hover:bg-hover"
                  >
                    Reopen
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Task pills strip */}
      {tasks.length > 0 && (
        <div className="flex-none border-b border-panel-border-soft px-3 py-2 flex gap-1.5 overflow-x-auto">
          {tasks.map((t) => {
            const k = taskKind(t);
            return (
              <button
                key={t.id}
                onClick={() => setActiveTask(t)}
                className={`flex-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11.5px] font-medium transition-colors hover:opacity-80 active:scale-95 ${PILL_CLASS[k] ?? PILL_CLASS.queued}`}
              >
                <Dot status={k} />
                <span className="font-bold">{t.ref}</span>
                <span className="opacity-60 text-[10px]">{t.task_type}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Thread */}
      <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {!messages && <div className="text-[12.5px] text-text-3 text-center py-8">Loading…</div>}
        {messages?.map((m) => (
          <ThreadItem key={m.id} msg={m} toolResults={toolResults} />
        ))}
      </div>

      {/* Approval banner */}
      {approvalTask && (
        <div className="flex-none mx-3 mb-2 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-warn animate-turn-pulse flex-none" />
          <span className="flex-1 text-[13px] text-warn leading-snug">
            <strong>{approvalTask.ref}</strong> is waiting for your approval
          </span>
          <button
            onClick={() => {
              if (approvalTask.session_id && approvalTask.engine_id && (approvalTask.worktree || approvalTask.project_path)) {
                switchProject((approvalTask.worktree || approvalTask.project_path)!, {
                  sessionId: approvalTask.session_id!,
                  engineId: approvalTask.engine_id!,
                  title: `${approvalTask.ref} ${approvalTask.task_type}`,
                });
                setView("chat");
              } else {
                setActiveTask(approvalTask);
              }
            }}
            className="flex-none text-[12.5px] font-semibold text-warn border border-warn/40 rounded-xl px-3 py-1.5 hover:bg-warn/10 active:scale-95 transition-transform"
          >
            {approvalTask.session_id ? "Open →" : "Details"}
          </button>
        </div>
      )}

      {/* Reply bar */}
      <div className="flex-none px-3 pt-2 pb-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-panel-border-soft">
        <div className="flex items-center gap-2 bg-panel-strong border border-panel-border rounded-2xl px-3 py-2">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={goal.status === "active" ? "Reply to the coordinator…" : "Write to reopen this goal…"}
            className="flex-1 resize-none bg-transparent outline-none text-[14.5px] text-text-1 py-1 max-h-32 placeholder:text-text-3"
          />
          <IconButton size={36} radius="full" tone="primary" onClick={send} disabled={!text.trim()} aria-label="Send">
            <SendIcon className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      <TaskSheet task={activeTask} tasks={tasks} onClose={() => setActiveTask(null)} />
    </>
  );
}

// ---- Task detail sheet ----

function TaskSheet({ task, tasks, onClose }: { task: Task | null; tasks: Task[]; onClose: () => void }) {
  const name = useDeviceName();
  const setView = useUiStore((s) => s.setView);
  if (!task) return null;
  const k = taskKind(task);
  const deps = task.depends_on.map((d) => tasks.find((t) => t.id === d)?.ref ?? "?");
  const where = task.engine_id ?? task.target_engine;
  const canOpen = !!(task.session_id && task.engine_id && (task.worktree || task.project_path));

  return (
    <Sheet open onClose={onClose} title={`${task.ref} · ${task.task_type}`}>
      <div className="space-y-5">
        {/* Status row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[12px] font-semibold ${PILL_CLASS[k] ?? PILL_CLASS.queued}`}>
            <Dot status={k} />
            {k === "approval" ? "needs your approval" : task.status}
          </span>
          <span className="text-[12.5px] text-text-3">{task.repo}</span>
          {where && <span className="text-[12.5px] text-text-3">on {name(where)}</span>}
          {deps.length > 0 && <span className="text-[12.5px] text-text-3">after {deps.join(", ")}</span>}
        </div>

        {/* Instructions */}
        <div>
          <Label>Instructions</Label>
          <div className="text-[13.5px] text-text-2 whitespace-pre-wrap leading-relaxed">{task.instructions}</div>
        </div>

        {/* Done when */}
        <div>
          <Label>Done when</Label>
          <div className="text-[13.5px] text-text-2 leading-relaxed">{task.acceptance}</div>
        </div>

        {/* Branch */}
        {task.branch && (
          <div className="text-[12.5px] text-text-3">
            Branch: <code className="text-accent-2 font-mono">{task.branch}</code>
            <span className="ml-2">{task.pushed ? "(pushed to origin)" : "(local only)"}</span>
          </div>
        )}

        {/* Result */}
        {(task.result || task.error) && (
          <div>
            <Label>{task.error ? "Error" : "Result"}</Label>
            <div className={`text-[13px] whitespace-pre-wrap leading-relaxed ${task.error ? "text-danger" : "text-text-1"}`}>
              {task.result ?? task.error}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {canOpen && (
            <Button
              variant="outline"
              size="xl"
              className="flex-1"
              onClick={() => {
                switchProject((task.worktree || task.project_path)!, {
                  sessionId: task.session_id!,
                  engineId: task.engine_id!,
                  title: `${task.ref} ${task.task_type}`,
                });
                setView("chat");
                onClose();
              }}
            >
              Open session
            </Button>
          )}
          {(task.status === "queued" || task.status === "running") && (
            <Button variant="outlineDanger" size="xl" className="flex-1" onClick={() => { void cancelTask(task); onClose(); }}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] font-bold uppercase tracking-wider text-text-3 mb-1.5">{children}</div>;
}

// ---- Thread items ----

function ThreadItem({ msg, toolResults }: { msg: GoalMessage; toolResults: Map<string, string> }) {
  const name = useDeviceName();
  if (msg.role === "tool") return null;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[85%] whitespace-pre-wrap text-[14px] text-text-1 px-3.5 py-2.5 rounded-[16px_16px_4px_16px] bg-gradient-to-b from-accent/32 to-accent-strong/22 border border-accent/28 leading-relaxed">
          {msg.content.text}
        </div>
      </div>
    );
  }

  if (msg.role === "event") {
    const text = msg.content.text ?? "";
    const failed = / FAILED /.test(text);
    const done = / DONE /.test(text);
    return (
      <div className={`mb-3 flex items-start gap-2 text-[12px] rounded-xl border px-3 py-2.5 leading-relaxed ${
        failed ? "border-danger/20 bg-danger/5 text-danger/80" :
        done   ? "border-success/20 bg-success/5 text-success/80" :
                 "border-panel-border-soft text-text-3"
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-none ${failed ? "bg-danger" : done ? "bg-success" : "bg-text-3"}`} />
        <span className="whitespace-pre-wrap break-words">{text.replace(/^\[event\]\s*/, "")}</span>
      </div>
    );
  }

  // assistant
  const calls = msg.content.tool_calls ?? [];
  return (
    <div className="mb-4">
      {calls.map((c) => {
        let a: Record<string, unknown> = {};
        try { a = JSON.parse(c.function.arguments || "{}"); } catch {}
        const out = toolResults.get(c.id) ?? "";
        const failed = out.startsWith("error:");
        switch (c.function.name) {
          case "ask_user":
            return (
              <div key={c.id} className="mb-3 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3.5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-warn mb-2">Coordinator asks</div>
                <div className="text-[14px] text-text-1 whitespace-pre-wrap leading-relaxed">{String(a.message ?? "")}</div>
              </div>
            );
          case "complete_goal":
            return (
              <div key={c.id} className="mb-3 rounded-2xl border border-success/40 bg-success-soft px-4 py-3.5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-success mb-2">Goal complete</div>
                <div className="text-[14px] text-text-1 whitespace-pre-wrap leading-relaxed">{String(a.summary ?? "")}</div>
              </div>
            );
          case "delegate_task":
            return (
              <div key={c.id} className={`mb-1.5 flex items-center gap-2 text-[12px] ${failed ? "text-danger" : "text-text-3"}`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-none ${failed ? "bg-danger" : "bg-accent-2/60"}`} />
                {failed
                  ? `Couldn't queue: ${out.replace(/^error:\s*/, "")}`
                  : <>Queued {out.replace(/^queued as /, "")} &middot; {String(a.task_type ?? "")} in {String(a.repo ?? "")} &rarr; {a.target_device ? name(String(a.target_device)) : "any device"}</>}
              </div>
            );
          case "cancel_task":
            return (
              <div key={c.id} className="mb-1.5 flex items-center gap-2 text-[12px] text-text-3">
                <span className="w-1.5 h-1.5 rounded-full flex-none bg-danger/60" />
                {failed ? out : `Cancelled ${String(a.ref ?? "")}`}
              </div>
            );
          case "remember":
            return (
              <div key={c.id} className="mb-1.5 text-[11.5px] text-text-3 italic">
                Remembered: {String(a.fact ?? "")}
              </div>
            );
          default:
            return null;
        }
      })}
      {msg.content.text && (
        <div className="text-[14px] text-text-1 leading-relaxed prose-chat" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content.text) }} />
      )}
    </div>
  );
}

// ---- Empty state ----

function EmptyState() {
  const engines = useEngineStore((s) => s.engines);
  const accepting = Object.values(engines).filter((e) => e.tasks_enabled);
  return (
    <div className="flex-1 flex items-center justify-center px-8 text-center">
      <div>
        <div className="text-[14px] text-text-2 font-medium mb-2">Select a goal</div>
        <div className="text-[12.5px] text-text-3 leading-relaxed max-w-[280px]">
          {accepting.length
            ? `${accepting.map((e) => e.device_name || e.id).join(" & ")} ${accepting.length === 1 ? "is" : "are"} taking tasks.`
            : "No device is taking tasks yet. Restart each device's engine to enable task support."}
        </div>
      </div>
    </div>
  );
}
