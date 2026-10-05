"use client";
import { AlertIcon } from "@/components/icons/icons";
import { Button } from "@/components/ui";
import { send } from "@/lib/client/hub";
import { useChatStore } from "@/store/chatStore";
import { useSessionStore } from "@/store/sessionStore";

export function ApprovalCard({
  requestId,
  toolName,
  input,
  description,
  resolved,
}: {
  requestId: string;
  toolName: string;
  input: unknown;
  description?: string;
  resolved: "pending" | "allowed" | "denied";
}) {
  function respond(allow: boolean) {
    send({ type: "approval_response", request_id: requestId, allow, input });
    useChatStore.getState().resolveApproval(requestId, allow);
    useSessionStore.getState().setTurnState("processing");
  }

  return (
    <div className="bg-warn-soft border border-warn/32 rounded-xl py-3 px-3.5 my-1 mb-4 ml-[38px]">
      <span className="flex items-center gap-1.5 text-warn font-semibold text-[13px]">
        <AlertIcon className="w-3.5 h-3.5 flex-none" />
        Wants to use: {toolName}
      </span>
      {description && <div className="text-text-2 text-[13px] mt-1">{description}</div>}
      <pre className="my-2 whitespace-pre-wrap break-words text-[10.5px] bg-black/20 py-2 px-2.5 rounded-lg text-text-2 overflow-x-auto">
        {JSON.stringify(input, null, 2)}
      </pre>
      {resolved === "pending" ? (
        <div className="flex gap-2 mt-2.5">
          <Button variant="success" size="block" className="flex-1" onClick={() => respond(true)}>
            Allow
          </Button>
          <Button variant="danger" size="block" className="flex-1" onClick={() => respond(false)}>
            Deny
          </Button>
        </div>
      ) : (
        <div className={`mt-2.5 text-[13px] ${resolved === "allowed" ? "text-success" : "text-danger"}`}>
          {resolved === "allowed" ? "Allowed" : "Denied"}
        </div>
      )}
    </div>
  );
}
