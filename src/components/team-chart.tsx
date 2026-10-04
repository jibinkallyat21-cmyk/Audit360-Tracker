"use client";

import Link from "next/link";
import { useState } from "react";
import { toneForLead } from "@/lib/brand";

export interface ChartPerson {
  id: string;
  name: string;
  /** Org-level role tags (display only). */
  tags: string[];
}
export interface ChartTeam {
  id: string;
  name: string;
  leadId: string;
  memberIds: string[];
}
export interface PersonProcess {
  code: string;
  title: string;
  types: string[];
}

const TAG_LABEL: Record<string, string> = {
  project_head: "Project Head",
  project_lead: "Project Lead",
  dashboard_lead: "Dashboard Lead",
  system_admin: "System Administrator",
  production_lead: "Production Lead",
  reviewer: "Reviewer",
  supporting_role: "Supporting role",
};
const TYPE_LABEL: Record<string, string> = {
  production_lead: "Production Lead",
  team_member: "Team member",
  reviewer: "Reviewer",
  supporting_role: "Supporting role",
};

function PersonChip({
  p,
  selected,
  onSelect,
  tone,
}: {
  p: ChartPerson;
  selected: string | null;
  onSelect: (id: string | null) => void;
  tone?: string;
}) {
  const on = p.id === selected;
  return (
    <button
      type="button"
      className={`${on ? "chip selected" : "chip"}${tone ? ` tone-${tone}` : ""}`}
      aria-pressed={on}
      onClick={() => onSelect(on ? null : p.id)}
    >
      {p.name}
    </button>
  );
}

function PeopleGroup({
  title,
  list,
  selected,
  onSelect,
  tone,
  top,
}: {
  title: string;
  list: ChartPerson[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  tone?: string;
  top?: boolean;
}) {
  if (list.length === 0) return null;
  if (top) {
    return (
      <section className="org-node" aria-label={title}>
        <span className="eyebrow">{title}</span>
        <div className="chips">
          {list.map((p) => (
            <PersonChip key={p.id} p={p} selected={selected} onSelect={onSelect} tone={tone} />
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="chips">
        {list.map((p) => (
          <PersonChip key={p.id} p={p} selected={selected} onSelect={onSelect} tone={tone} />
        ))}
      </div>
    </section>
  );
}

/**
 * Interactive organisation chart. People, roles and teams come from the database.
 * The process list for a selected person is limited to what the viewer may see.
 */
export function TeamChart({
  people,
  teams,
  processesByPerson,
  fullView,
}: {
  people: ChartPerson[];
  teams: ChartTeam[];
  processesByPerson: Record<string, PersonProcess[]>;
  fullView: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const byId = new Map(people.map((p) => [p.id, p]));
  const withTag = (tag: string) => people.filter((p) => p.tags.includes(tag));
  const inTeams = new Set(teams.flatMap((t) => [t.leadId, ...t.memberIds]));
  const person = selected ? byId.get(selected) : undefined;

  const processes = person ? (processesByPerson[person.id] ?? []) : [];
  const team = person
    ? teams.find((t) => t.leadId === person.id || t.memberIds.includes(person.id))
    : undefined;

  return (
    <div className="team-layout">
      <div className="stack-lg">
        <div className="org-top">
          <PeopleGroup
            top
            title="Project Head"
            list={withTag("project_head")}
            selected={selected}
            onSelect={setSelected}
          />
          <PeopleGroup
            top
            title="Project Lead"
            list={withTag("project_lead")}
            selected={selected}
            onSelect={setSelected}
          />
          <PeopleGroup
            top
            title="Dashboard Lead"
            list={withTag("dashboard_lead")}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        <div className="grid">
          {teams.map((t) => {
            const lead = byId.get(t.leadId);
            const members = t.memberIds
              .map((id) => byId.get(id))
              .filter((p): p is ChartPerson => !!p);
            const tone = toneForLead(lead?.name);
            return (
              <section key={t.id} className={`panel team-card tone-${tone}`}>
                <h2>{t.name}</h2>
                {lead && (
                  <p>
                    <span className="muted">Production Lead </span>
                    <PersonChip p={lead} selected={selected} onSelect={setSelected} tone={tone} />
                  </p>
                )}
                <div className="chips">
                  {members
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => (
                      <PersonChip
                        key={p.id}
                        p={p}
                        selected={selected}
                        onSelect={setSelected}
                        tone={tone}
                      />
                    ))}
                </div>
              </section>
            );
          })}
        </div>

        <div className="grid">
          <PeopleGroup
            title="Reviewers"
            tone="amber"
            list={withTag("reviewer")}
            selected={selected}
            onSelect={setSelected}
          />
          <PeopleGroup
            title="Supporting roles"
            list={withTag("supporting_role").filter((p) => !inTeams.has(p.id))}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
      </div>

      <aside className="panel detail" aria-live="polite">
        {person ? (
          <>
            <h2>{person.name}</h2>
            <p className="muted">
              {[
                ...new Set([
                  ...person.tags.map((t) => TAG_LABEL[t] ?? t),
                  ...(team ? ["Team member"] : []),
                ]),
              ]
                .filter((x) => !(x === "Team member" && person.tags.includes("production_lead")))
                .join(" · ") || "Team member"}
              {team ? ` · ${team.name}` : ""}
            </p>
            <h3>Processes</h3>
            {processes.length === 0 ? (
              <p className="empty">
                {fullView ? "No process assignments." : "None that you are able to see."}
              </p>
            ) : (
              <ul className="list">
                {processes.map((p) => (
                  <li key={p.code}>
                    <Link href={`/processes/${p.code}`}>
                      <strong>{p.code}</strong> {p.title}
                    </Link>
                    <br />
                    <span className="muted">
                      {p.types.map((t) => TYPE_LABEL[t] ?? t).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!fullView && (
              <p className="muted">You see only the assignments on processes you can access.</p>
            )}
          </>
        ) : (
          <p className="empty">Select a person to see their role and processes.</p>
        )}
      </aside>
    </div>
  );
}
