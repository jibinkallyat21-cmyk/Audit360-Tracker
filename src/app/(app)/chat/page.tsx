import { ChatLayout, type ChatRow } from "@/components/chat-layout";
import { listAssignments, listSubprocesses } from "@/lib/data";
import { ASSIGNMENT_LABEL_PLURAL } from "@/lib/chat";
import { createClient } from "@/lib/supabase/server";
import { openDirect } from "./actions";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  await supabase.rpc("chat_ensure_groups");
  const [overview, people] = await Promise.all([
    supabase.rpc("chat_overview"),
    supabase.rpc("chat_people"),
  ]);
  const peopleList = (people.data ?? []) as { profile_id: string; display_name: string }[];
  const rows = ((overview.data ?? []) as ChatRow[]).slice().sort((a, b) => {
    if (a.kind !== b.kind)
      return (
        ["common", "direct", "process"].indexOf(a.kind) -
        ["common", "direct", "process"].indexOf(b.kind)
      );
    if (a.kind === "process") {
      return (a.process_code ?? "").localeCompare(b.process_code ?? "", undefined, {
        numeric: true,
      });
    }
    return (b.last_at ?? "").localeCompare(a.last_at ?? "");
  });
  const current =
    rows.find((r) => r.conversation_id === sp.c) ?? rows.find((r) => r.kind === "common");

  // The people in a process group, so everyone sees who is in the room.
  let members = "";
  if (current?.kind === "process") {
    const [subs, assignments] = await Promise.all([listSubprocesses(), listAssignments()]);
    const processId = subs.find((s) => s.processCode === current.process_code)?.processId;
    members = Object.entries(
      assignments
        .filter((a) => a.processId === processId)
        .reduce<Record<string, string[]>>((acc, a) => {
          (acc[a.type] ??= []).push(a.personName);
          return acc;
        }, {}),
    )
      .map(([type, names]) => `${ASSIGNMENT_LABEL_PLURAL[type] ?? type}: ${names.join(", ")}`)
      .join(" · ");
    members += " · Also in every group: Administrator, Project Lead, Project Head";
  }

  return (
    <ChatLayout
      rows={rows}
      current={current}
      members={members}
      people={peopleList}
      error={sp.error}
      openDirect={openDirect}
    />
  );
}
