// src/skill/prebuilt.ts
// M3.4 — Prebuilt skill kütüphanesi (gbrain'in 55 curated skill'ine karşılık).
// Bunlar BEYİNDEN türetilmez (skill_export öyle yapar); ajana Vitrus'u DOĞRU kullanmayı
// öğreten operasyonel SKILL.md'lerdir. Hepsi açık Agent Skills standardına uyar
// (validateSkillFile gate'i `test/prebuilt-skills.test.ts`'te koşar → bozuk skill shiplenmez).
// tools referansları tam-nitelikli (Vitrus:<mcp_tool>) ve gerçek MCP araçlarıdır (TOOL_DEFS).

import type { SkillFile } from "../core/types.js";

const V = "0.1.0";

function skill(s: Omit<SkillFile, "version" | "provenance"> & Partial<Pick<SkillFile, "provenance">>): SkillFile {
  return { version: V, provenance: [], ...s };
}

export const PREBUILT_SKILLS: SkillFile[] = [
  skill({
    name: "answer-with-sources",
    description:
      "Answers a question from the company brain with cited sources and an honest list of what is not documented yet. Use when someone asks a factual question about the company, its systems, people, decisions or incidents.",
    triggers: ["what is", "who owns", "how do we", "explain", "summarize what we know about"],
    tools: ["Vitrus:think", "Vitrus:provenance"],
    body: `# Answer with sources

Never answer company questions from memory. Pull the answer from the brain so every claim is cited and every gap is visible.

## Steps
1. Call \`Vitrus:think\` with the user's question. It returns a synthesized answer, numbered \`[n]\` citations, a confidence score, and a list of gaps.
2. Relay the answer **with its citations**. Keep the \`[n]\` markers — they map to real sources.
3. If \`gaps\` is non-empty, state plainly what the brain does **not** know instead of guessing.
4. To show where a claim came from, call \`Vitrus:provenance\` with the source slug (connector, link, captured-at).

## Glass-box rule
A claim without a source is not an answer. If confidence is low or a gap covers the question, say so — that honesty is the product.`,
  }),
  skill({
    name: "verify-before-claiming",
    description:
      "Checks a claim against the company brain before stating it, returning grounded, stale, contradicted or unsupported with the supporting sources. Use before asserting any non-trivial fact about the company.",
    triggers: ["is it true that", "verify", "double-check", "are we sure"],
    tools: ["Vitrus:verify"],
    body: `# Verify before claiming

Before asserting something important, check it against the brain deterministically.

## Steps
1. Call \`Vitrus:verify\` with the claim as a single sentence.
2. Read the verdict:
   - **grounded** — supported by sources; safe to state (cite them).
   - **stale** — was true but superseded; flag the newer version.
   - **contradicted** — sources disagree; surface both sides, do not pick silently.
   - **unsupported** — the brain has nothing; do not assert it.
3. Always pass the supporting source slugs through to the user.

## Glass-box rule
Trust the verdict, not your prior. Unsupported means "we don't know", not "probably yes".`,
  }),
  skill({
    name: "find-the-owner",
    description:
      "Finds who owns or is responsible for a service, decision or area by traversing the typed knowledge graph and entity index. Use when someone needs to know who to talk to about X.",
    triggers: ["who owns", "who is responsible for", "who do I ask about", "who runs"],
    tools: ["Vitrus:graph_query", "Vitrus:entities", "Vitrus:search"],
    body: `# Find the owner

The graph already encodes ownership — read it instead of guessing.

## Steps
1. Locate the thing: \`Vitrus:search\` for the service/decision to get its slug.
2. Traverse ownership: \`Vitrus:graph_query\` with that slug and edgeType \`owns\` (or \`reports_to\` for people, \`depends_on\` for systems).
3. For a broader map, \`Vitrus:entities\` lists people/teams by mention frequency.

## Glass-box rule
If no owner edge exists, that is an **unowned** finding — report the gap and suggest assigning an owner, do not invent one.`,
  }),
  skill({
    name: "capture-decision",
    description:
      "Records a decision and its rationale back into the company brain after it is made, with sources, and detects supersede and contradiction effects. Use immediately after an architectural or process decision is reached.",
    triggers: ["we decided", "the decision is", "record this decision", "going forward we will"],
    tools: ["Vitrus:record_decision"],
    body: `# Capture a decision

The brain stays live only if decisions are written back. Do it the moment a decision is reached.

## Steps
1. Call \`Vitrus:record_decision\` with: the decision (one line), the rationale, any source slugs/URLs, and \`supersedes\`/\`contradicts\` if it replaces or conflicts with prior knowledge.
2. Read the response: it runs gap analysis and reports any **contradiction** the new decision creates and anything it marked **stale**.
3. If a contradiction is reported, resolve it (see resolve-conflicts) — do not leave the brain inconsistent.

## Glass-box rule
Write the *reasoning*, not just the outcome. A decision without its "why" cannot be re-evaluated later.`,
  }),
  skill({
    name: "quick-note",
    description:
      "Captures an ad-hoc note, idea or piece of context into the company brain in one step. Use when something worth remembering surfaces mid-task and should not be lost.",
    triggers: ["remember that", "note to self", "capture this", "jot down"],
    tools: ["Vitrus:remember"],
    body: `# Quick note

Lower the friction of capture to near zero, so context is never lost.

## Steps
1. Call \`Vitrus:remember\` with the note content and an optional title. It writes to the markdown source and indexes it.
2. From a terminal the same thing is one command: \`vitrus capture "the note"\` (or pipe: \`echo ... | vitrus capture\`).
3. Drop a file into the inbox folder and run \`vitrus ingest inbox <dir>\` to capture from mobile (iOS Shortcuts/iCloud).

## Glass-box rule
Notes are working-tier and decay over time. Promote anything durable into a proper decision or document.`,
  }),
  skill({
    name: "surface-gaps",
    description:
      "Surfaces what the company brain does not know: missing, stale, contradicted, single-point and uncited knowledge. Use before relying on the brain for a high-stakes task.",
    triggers: ["what don't we know", "what's missing", "gaps", "blind spots"],
    tools: ["Vitrus:gap_report"],
    body: `# Surface gaps

The brain's honesty is its edge: it states what it does not know, deterministically.

## Steps
1. Call \`Vitrus:gap_report\`. It returns gaps by kind:
   - **missing** — referenced but undocumented nodes.
   - **stale** — superseded knowledge still in use.
   - **contradiction** — conflicting edges.
   - **single_point** — bus-factor risk (one person/owner).
   - **uncited** — incidents/decisions without a source.
2. Triage by impact and turn each into an action (document it, assign an owner, resolve the conflict).

## Glass-box rule
A gap is not a failure — it is a to-do. Reporting it beats silently guessing.`,
  }),
  skill({
    name: "operations-review",
    description:
      "Reviews the company as a system and flags operational risks: unowned services, single-person bus-factor, bottlenecks, broken handoffs and redundant tools, each citing the real nodes behind it. Use for a health check or before reorganizing.",
    triggers: ["operational risks", "ops review", "bottlenecks", "bus factor", "what's fragile"],
    tools: ["Vitrus:ops_report"],
    body: `# Operations review

Read the org as a graph of people, services and dependencies — the inefficiencies fall out deterministically.

## Steps
1. Call \`Vitrus:ops_report\`. Findings are severity-ranked:
   - **unowned** — service with no owner.
   - **bus_factor** — service depending on a single person.
   - **bottleneck** — person/team with too many inbound dependencies.
   - **broken_handoff** — dependency on superseded/stale ground.
   - **redundant_tool** — two near-duplicate services to consolidate.
2. For each, follow the cited nodes and propose a concrete fix (assign owner, add backup, split load).

## Glass-box rule
Every finding cites real nodes. This is evidence, not an LLM hunch — present it that way.`,
  }),
  skill({
    name: "resolve-conflicts",
    description:
      "Surfaces sources that disagree and resolves the conflict by keeping one side and marking the other superseded and stale. Use when two documents or decisions contradict each other.",
    triggers: ["these disagree", "which is correct", "conflict", "contradiction"],
    tools: ["Vitrus:conflicts", "Vitrus:resolve_conflict"],
    body: `# Resolve conflicts

When sources disagree, surface both sides — then resolve cleanly without silent overwrites.

## Steps
1. Call \`Vitrus:conflicts\` to list contradictions with both sides (slug + title) and whether each is open or resolved.
2. Determine the winner from evidence (recency, authority, verification).
3. Call \`Vitrus:resolve_conflict\` with \`keep\` = winning slug and \`supersede\` = losing slug, plus a reason. The loser is marked stale and the conflict resolved in the markdown source.

## Glass-box rule
Never overwrite the loser silently. Supersede leaves an auditable trail of what changed and why.`,
  }),
  skill({
    name: "daily-attention",
    description:
      "Triages what needs human attention now: stale durable knowledge, unresolved incidents and aging gaps, ranked by severity and age. Use at the start of a work session or on-call shift.",
    triggers: ["what needs attention", "start of day", "triage", "what's aging"],
    tools: ["Vitrus:attention"],
    body: `# Daily attention

Start proactive, not reactive: let the brain tell you what is rotting.

## Steps
1. Call \`Vitrus:attention\` (optionally pass \`now\` as ISO). It returns severity-ranked items:
   - stale durable knowledge (not updated in a long time),
   - unresolved incidents (open too long, no resolution edge),
   - aging gaps (open and getting older).
2. Work top-down by severity. Close the loop: document, resolve, or escalate.

## Glass-box rule
Attention items are deterministic and time-aware — the same brain at the same time yields the same list.`,
  }),
  skill({
    name: "trace-provenance",
    description:
      "Traces where an answer came from, showing the source connector and link plus the exact passages that support it. Use when an answer must be audited, defended or fact-checked.",
    triggers: ["where did this come from", "show the source", "audit this answer", "which passage"],
    tools: ["Vitrus:provenance", "Vitrus:chunks", "Vitrus:supporting_chunks"],
    body: `# Trace provenance

Every answer should be defensible down to the passage.

## Steps
1. \`Vitrus:provenance\` with a slug → which connector fetched it, the back-link, and when it was captured.
2. \`Vitrus:supporting_chunks\` with a slug + the question → the exact passages that support the answer, scored.
3. \`Vitrus:chunks\` with a slug → the full ordered chunks for a deeper audit.

## Glass-box rule
"The model said so" is never the source. Cite the connector, the link, and the passage.`,
  }),
  skill({
    name: "onboard-area",
    description:
      "Helps a newcomer learn an unfamiliar area of the company or codebase by mapping its key entities, owners and decisions from the brain. Use in the first days on a new team, service or domain.",
    triggers: ["help me get up to speed", "onboard me on", "learn about this area", "new to this team"],
    tools: ["Vitrus:search", "Vitrus:graph_query", "Vitrus:entities", "Vitrus:think"],
    body: `# Onboard an area

Shorten the learning curve: read the company's own memory instead of interrupting senior people.

## Steps
1. Map the landscape: \`Vitrus:entities\` for the key people/services/decisions in the area.
2. For each important node, \`Vitrus:graph_query\` (\`owns\`, \`depends_on\`, \`reports_to\`) to learn structure and who to ask.
3. Ask concrete questions with \`Vitrus:think\` — read the cited sources to learn *where* knowledge lives, not just the answer.
4. Note every gap you hit: those are the undocumented, tribal parts — flag them so the next newcomer onboards faster.

## Glass-box rule
When the brain has a gap, that is the thing to ask a human — then capture their answer (quick-note / capture-decision) so it is written down once.`,
  }),
  skill({
    name: "read-before-act",
    description:
      "Reads the company brain before acting and writes the decision back afterward, keeping shared memory live. Use as the default loop for any agent doing real work in the codebase.",
    triggers: ["before you start", "default workflow", "read before acting", "agent loop"],
    tools: ["Vitrus:think", "Vitrus:gap_report", "Vitrus:record_decision"],
    body: `# Read before act, write after decide

The brain only compounds if agents read it first and write to it after.

## Before acting
1. \`Vitrus:think\` the task to pull relevant prior decisions, owners and constraints.
2. \`Vitrus:gap_report\` to see what is undocumented before you rely on it.

## After deciding
3. \`Vitrus:record_decision\` with the decision, rationale and sources. It flags any contradiction or staleness your decision created.

## Glass-box rule
Reading without writing back wastes the loop; the next agent (or you tomorrow) starts blind. Close it every time.`,
  }),
];

/** İsimle prebuilt skill bul (CLI `skills show`). */
export function findPrebuiltSkill(name: string): SkillFile | undefined {
  return PREBUILT_SKILLS.find((s) => s.name === name);
}
