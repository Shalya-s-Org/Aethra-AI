# Dashboard Page Overrides

> **PROJECT:** Aethra AI
> **Curated:** 2026-08-08
> **Page Type:** Dashboard / Data View (autonomous agent telemetry)

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/aethra-ai/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout

- **Full-width, 12-column responsive grid** for data flexibility (no max-width cap on the content area).
- Fixed sidebar (240px) + top status header (56px); content area scrolls independently.
- Content density: **high** — 8–16px gaps; micro-labels at 10px `font-mono` uppercase are acceptable for telemetry labels but not for body copy.

### Color Overrides

- Status semantics are load-bearing on this page: **running → emerald, queued → amber, failed → red, healthy/idle → cyan**. Use the semantic tokens (`cyber-emerald` / `cyber-amber` / `cyber-red` / `cyber-cyan`), never ad-hoc hex.
- Pulsing/active states use the accent at 10–15% fill with a glow shadow; rejected items use red at 10–15% fill.

### Typography Overrides

- Telemetry numbers and ids: `font-mono` (JetBrains Mono).
- Section headings: Orbitron uppercase, `text-xs`–`text-sm`, tracking-wider.

### Effects

- Live pipeline progress uses cyan glow + `animate-pulse` only on the active node; respect reduced-motion (see Master).
- Chart hover tooltips with row-highlight on hover; no decorative infinite animations (loading indicators only).

### Components

- **Skeleton (first load):** until the first live snapshot (`hasLoadedSnapshot`), the content area renders an `aria-busy` pulsing placeholder (header line + 4 stat cards + 2 panels). Do not render empty zeros in its place.
- **StatusBadge:** driven by engine `status`; idle/scanning/filtering/reasoning/memory_check/writing/publishing/learning each map to a status color.
- **Charts (AnalyticsView):** Recharts. Trends → Area/Line (SVG, <1000 pts). KPI-vs-target → bullet-style with target marker. Streaming/telemetry → area with **pause/resume** control. All values must be visible as text (not hover-only); differentiate series by line style (solid/dashed), not color alone.

### AI Interaction

- Clearly label AI-generated content (publications, decisions, timeline) as agent output.
- Never present the agent as human; keep the "Dr. Nova" persona framing but attribute all publications as autonomous output.

---

## Page-Specific Anti-Patterns

- ❌ Empty/default state flashing before the first telemetry snapshot (use the skeleton)
- ❌ Status indicated by color alone (always pair with text: "PUBLISH", "REJECTED", "NOMINAL")
- ❌ Infinite decorative animations (pulse/glow reserved for active pipeline stages)
