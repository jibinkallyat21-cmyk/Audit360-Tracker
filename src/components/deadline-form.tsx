import { setDeadline } from "@/app/(app)/actions";
import { ActionForm } from "./client";

const ZONES = [
  ["Asia/Riyadh", "Riyadh (KSA)"],
  ["Asia/Kolkata", "India"],
  ["Asia/Dubai", "Dubai"],
  ["UTC", "UTC"],
];

/** Dashboard Lead only. The database rejects anyone else. */
export function DeadlineForm({ current }: { current: string | null }) {
  return (
    <ActionForm
      action={setDeadline}
      fields={{}}
      label={current ? "Change deadline" : "Set deadline"}
      className="deadline-form"
    >
      <label>
        <span>Date and time</span>
        <input type="datetime-local" name="when" required />
      </label>
      <label>
        <span>Timezone</span>
        <select name="zone" defaultValue="Asia/Riyadh">
          {ZONES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
    </ActionForm>
  );
}
