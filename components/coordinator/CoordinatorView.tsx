"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGoalsStore, type Goal, type GoalMessage, type Task, type ToolCall } from "@/store/goalsStore";
import { useEngineStore } from "@/store/engineStore";
import { useUiStore } from "@/store/uiStore";
import { loadGoals, loadGoal, createGoal, postMessage, cancelTask, setGoalStatus, subscribeCoordinator } from "@/lib/client/coordinator";
import { switchProject } from "@/lib/client/switchProject";
import { renderMarkdown } from "@/lib/client/renderMarkdown";
import { timeAgo } from "@/lib/client/timeAgo";
import { SendIcon, PlusIcon, ChevronRightIcon } from "@/components/icons/icons";

// Goals you hand to the coordinator, its conversation with you, and the tasks it
// delegated to your devices. Tasks run as ordinary sessions on the device: "Open
// session" jumps to one (to watch it or approve a tool).

const STATUS_STYLE: Record<string, string> = {
  queued: "text-text-2 border-panel-border",
  running: "text-accent-2 border-accent-soft-border",
  approval: "text-warn border-warn/40",
  done: "text-success border-success/40",
  failed: "text-danger border-danger/40",
  cancelled: "text-text-3 border-panel-border-soft",
  active: "text-accent-2 border-accent-soft-border",
};

function Pill({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center px-2 py-px rounded-full border text-[10.5px] font-semibold whitespace-nowrap ${STATUS_STYLE[kind] ?? STATUS_STYLE.queued}`}>{children}</span>;
}

function useDeviceName() {
  const engines = useEngineStore((s) => s.engines);
  return (id: string | null | undefined) => (id ? engines[id]?.device_name || id : "any device");
}

export function CoordinatorView() {
  const { goals, loaded, selectedId, select, error, setError } = useGoalsStore();
  const selected = goals.find((g) => g.id === selectedId) ?? null;

  useEffect(() => {
    subscribeCoordinator();
    void loadGoals();
  }, []);
  useEffect(() => {
    if (selectedId) void loadGoal(selectedId);
  }, [selectedId]);

  return (
    <div className="flex-1 min-h-0 flex">
      <div className={`${selected ? "hidden md:flex" : "flex"} w-full md:w-[280px] flex-none flex-col border-r border-panel-border-soft min-h-0`}>
        <NewGoal onCreated={(id) => select(id)} />
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
          {!loaded && <div className="text-[12.5px] text-text-3 px-2 py-4">Loading goals…</div>}
          {loaded && !goals.length && (
            <div className="text-[12.5px] text-text-3 px-2 py-4 leading-relaxed">
              No goals yet. Describe something you want done; the coordinator splits it into tasks and sends them to your devices.
            </div>
          )}
          {goals.map((g) => (
            <button
              key={g.id}
              onClick={() => select(g.id)}
              className={`w-full text-left rounded-lg px-2.5 py-2 mb-1 transition-colors ${g.id === selectedId ? "bg-active" : "hover:bg-hover"}`}
            >
              <div className="text-[13px] text-text-1 line-clamp-2">{g.title}</div>
              <div className="flex items-center gap-1.5 mt-1 text-[10.5px] text-text-3">
                <Pill kind={g.status}>{g.status}</Pill>
                {g.work && <Pill kind="approval">work</Pill>}
                <span>{timeAgo(g.updated_at)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className={`${selected ? "flex" : "hidden md:flex"} flex-1 min-w-0 flex-col min-h-0`}>
        {error && (
          <div role="alert" className="mx-4 mt-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger flex gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-text-2 hover:text-text-1">Dismiss</button>
          </div>
        )}
        {selected ? <GoalDetail goal={selected} onBack={() => select(null)} /> : <EmptyDetail />}
      </div>
    </div>
  );
}

function EmptyDetail() {
  const engines = useEngineStore((s) => s.engines);
  const accepting = Object.values(engines).filter((e) => e.tasks_enabled);
  return (
    <div className="flex-1 flex items-center justify-center px-8 text-center text-[13px] text-text-3 leading-relaxed">
      <div className="max-w-[420px]">
        Pick a goal, or start one on the left.
        <div className="mt-3 text-[12px]">
          {accepting.length
            ? `Devices taking tasks: ${accepting.map((e) => e.device_name || e.id).join(", ")}.`
            : "No device takes tasks yet: restart each device's engine after updating it."}
        </div>
      </div>
    </div>
  );
}

function NewGoal({ onCreated }: { onCreated: (id: string) => void }) {
  const [text, setText] = useState("");
  const [work, setWork] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit() {
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    const id = await createGoal(title, work);
    setBusy(false);
    if (id) {
      setText("");
      setWork(false);
      onCreated(id);
    }
  }
  return (
    <div className="p-3">
      <div className="bg-panel-strong border border-panel-border rounded-xl p-2">
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder="New goal, e.g. “Add a dark-mode toggle to agent-webapp-next, review it, open a PR”"
          className="w-full resize-none bg-transparent outline-none text-[13px] text-text-1 placeholder:text-text-3"
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-text-2 cursor-pointer" title="Work goals use Claude Haiku and only run on devices tagged “work”.">
            <input type="checkbox" checked={work} onChange={(e) => setWork(e.target.checked)} className="accent-[var(--color-accent)]" />
            Work goal
          </label>
          <div className="flex-1" />
          <button
            onClick={() => void submit()}
            disabled={!text.trim() || busy}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white bg-gradient-to-br from-accent-2 to-accent-strong disabled:opacity-40"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GoalDetail({ goal, onBack }: { goal: Goal; onBack: () => void }) {
  const messages = useGoalsStore((s) => s.messages[goal.id]);
  const tasks = useGoalsStore((s) => s.tasks[goal.id]);
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages?.length]);

  const toolResults = useMemo(() => {
    const m = new Map<string, string>();
    for (const msg of messages ?? []) if (msg.role === "tool" && msg.content.tool_call_id) m.set(msg.content.tool_call_id, msg.content.text ?? "");
    return m;
  }, [messages]);

  function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    void postMessage(goal, t);
  }

  const busy = (tasks ?? []).filter((t) => t.status === "running" || t.status === "queued").length;
  return (
    <>
      <div className="px-4 pt-1 pb-3 border-b border-panel-border-soft flex-none">
        <div className="flex items-start gap-2">
          <button onClick={onBack} className="md:hidden mt-0.5 text-text-2 hover:text-text-1 rotate-180" aria-label="Back to goals">
            <ChevronRightIcon className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[14.5px] text-text-1 leading-snug">{goal.title}</div>
            <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-text-3 flex-wrap">
              <Pill kind={goal.status}>{goal.status}</Pill>
              {goal.work && <Pill kind="approval">work · Claude Haiku · work devices only</Pill>}
              <span>{busy ? `${busy} task${busy > 1 ? "s" : ""} in progress` : `${tasks?.length ?? 0} tasks`}</span>
              <span>· planning cost ${Number(goal.cost_usd).toFixed(4)}</span>
            </div>
          </div>
          <div className="flex gap-1.5 flex-none">
            {goal.status === "active" ? (
              <>
                <SmallButton onClick={() => void setGoalStatus(goal, "done")}>Mark done</SmallButton>
                <SmallButton danger onClick={() => void setGoalStatus(goal, "cancelled")}>Cancel goal</SmallButton>
              </>
            ) : (
              <SmallButton onClick={() => void setGoalStatus(goal, "active")}>Reopen</SmallButton>
            )}
          </div>
        </div>
        {!!tasks?.length && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {tasks.map((t) => (
              <TaskCard key={t.id} task={t} tasks={tasks} />
            ))}
          </div>
        )}
      </div>
      <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="max-w-[720px] mx-auto">
          {!messages && <div className="text-[12.5px] text-text-3">Loading…</div>}
          {messages?.map((m) => <ThreadItem key={m.id} msg={m} toolResults={toolResults} />)}
        </div>
      </div>
      <div className="px-4 pb-4 pt-2 flex-none">
        <div className="max-w-[720px] mx-auto bg-panel-strong border border-panel-border rounded-2xl p-2 flex items-end gap-2">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={goal.status === "active" ? "Reply to the coordinator…" : "Write to reopen this goal…"}
            className="flex-1 resize-none bg-transparent outline-none text-[14.5px] text-text-1 py-1.5 px-1.5 max-h-40 placeholder:text-text-3"
          />
          <button
            onClick={send}
            disabled={!text.trim()}
            aria-label="Send"
            className="w-[34px] h-[34px] rounded-full flex-none flex items-center justify-center text-white bg-gradient-to-br from-accent-2 to-accent-strong disabled:bg-none disabled:bg-white/8 disabled:text-text-3"
          >
            <SendIcon className="w-[15px] h-[15px]" />
          </button>
        </div>
      </div>
    </>
  );
}

function SmallButton({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`border rounded-md px-2 py-0.5 text-[11px] transition-colors ${danger ? "border-danger/30 text-danger hover:border-danger/60" : "border-panel-border-soft text-text-2 hover:text-text-1 hover:bg-active"}`}
    >
      {children}
    </button>
  );
}

function TaskCard({ task, tasks }: { task: Task; tasks: Task[] }) {
  const name = useDeviceName();
  const setView = useUiStore((s) => s.setView);
  const [open, setOpen] = useState(false);
  const kind = task.needs_approval && task.status === "running" ? "approval" : task.status;
  const label = kind === "approval" ? "needs your approval" : task.status;
  const deps = task.depends_on.map((d) => tasks.find((t) => t.id === d)?.ref ?? "?");
  const where = task.engine_id ?? task.target_engine;
  const canOpen = !!(task.session_id && task.engine_id && (task.worktree || task.project_path));

  return (
    <div className={`flex-none w-[250px] rounded-xl border bg-black/20 p-2.5 text-[11.5px] ${kind === "approval" ? "border-warn/50" : "border-panel-border-soft"}`}>
      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-text-1">{task.ref}</span>
        <span className="text-text-2">{task.task_type}</span>
        <div className="flex-1" />
        <Pill kind={kind}>{label}</Pill>
      </div>
      <div className="mt-1 text-text-3 truncate">
        {task.repo} · {where ? name(where) : task.required_capability ? `any with ${task.required_capability}` : "any device"}
        {deps.length ? ` · after ${deps.join(", ")}` : ""}
      </div>
      <button onClick={() => setOpen(!open)} className="mt-1.5 text-left text-text-2 line-clamp-2 hover:text-text-1">
        {task.instructions}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 text-text-2 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
          <div><span className="text-text-3">Instructions:</span> {task.instructions}</div>
          <div><span className="text-text-3">Done when:</span> {task.acceptance}</div>
          {(task.result || task.error) && <div><span className="text-text-3">Report:</span> {task.result ?? task.error}</div>}
        </div>
      )}
      {task.branch && <div className="mt-1 text-text-3 truncate">branch {task.branch}{task.pushed ? " (pushed)" : ""}</div>}
      {!open && (task.result || task.error) && <div className="mt-1 text-text-3 line-clamp-2">{task.result ?? task.error}</div>}
      <div className="mt-2 flex gap-1.5">
        {canOpen && (
          <SmallButton
            onClick={() => {
              switchProject((task.worktree || task.project_path)!, { sessionId: task.session_id!, engineId: task.engine_id!, title: `${task.ref} ${task.task_type}` });
              setView("chat");
            }}
          >
            Open session
          </SmallButton>
        )}
        {(task.status === "queued" || task.status === "running") && (
          <SmallButton danger onClick={() => void cancelTask(task)}>
            Cancel
          </SmallButton>
        )}
      </div>
    </div>
  );
}

function argsOf(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.function.arguments || "{}");
  } catch {
    return {};
  }
}

function ThreadItem({ msg, toolResults }: { msg: GoalMessage; toolResults: Map<string, string> }) {
  const name = useDeviceName();
  if (msg.role === "tool") return null;
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[82%] whitespace-pre-wrap text-[14px] text-text-1 px-3.5 py-2.5 rounded-[16px_16px_4px_16px] bg-gradient-to-b from-accent/32 to-accent-strong/22 border border-accent/28">
          {msg.content.text}
        </div>
      </div>
    );
  }
  if (msg.role === "event") {
    const text = msg.content.text ?? "";
    const failed = / FAILED /.test(text);
    return (
      <div className={`mb-3 text-[12px] font-mono whitespace-pre-wrap break-words rounded-lg border px-2.5 py-1.5 ${failed ? "border-danger/30 text-danger/90" : "border-success/25 text-success/90"}`}>
        {text.replace(/^\[event\]\s*/, "")}
      </div>
    );
  }
  const calls = msg.content.tool_calls ?? [];
  return (
    <div className="mb-4">
      {calls.map((c) => {
        const a = argsOf(c);
        const out = toolResults.get(c.id) ?? "";
        const failed = out.startsWith("error:");
        switch (c.function.name) {
          case "ask_user":
            return (
              <div key={c.id} className="mb-2 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2.5 text-[13.5px] text-text-1 whitespace-pre-wrap">
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-warn mb-1">Coordinator asks</div>
                {String(a.message ?? "")}
              </div>
            );
          case "complete_goal":
            return (
              <div key={c.id} className="mb-2 rounded-xl border border-success/40 bg-success-soft px-3 py-2.5 text-[13.5px] text-text-1 whitespace-pre-wrap">
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-success mb-1">Goal complete</div>
                {String(a.summary ?? "")}
              </div>
            );
          case "delegate_task":
            return (
              <div key={c.id} className={`mb-1.5 text-[12px] ${failed ? "text-danger" : "text-text-2"}`}>
                {failed ? "Couldn't queue" : `Queued ${out.replace(/^queued as /, "")}`}: {String(a.task_type ?? "")} in {String(a.repo ?? "")} →{" "}
                {a.target_device ? name(String(a.target_device)) : a.required_capability ? `any with ${a.required_capability}` : "any device"}
                {failed && <span className="text-text-3"> ({out.replace(/^error:\s*/, "")})</span>}
              </div>
            );
          case "cancel_task":
            return <div key={c.id} className="mb-1.5 text-[12px] text-text-2">{failed ? out : `Cancelled ${String(a.ref ?? "")}`}</div>;
          case "remember":
            return <div key={c.id} className="mb-1.5 text-[12px] text-text-3">Remembered: {String(a.fact ?? "")}</div>;
          default:
            return null;
        }
      })}
      {msg.content.text && <div className="text-[14px] text-text-1 prose-chat" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content.text) }} />}
    </div>
  );
}
