# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/aethra-ai/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Aethra AI
**Curated:** 2026-08-08 (persisted from ui-ux-pro-max `--design-system`, corrected to the shipped dark system)
**Category:** Cybersecurity / Autonomous-AI ops dashboard

---

## Global Rules

### Color Palette

Dark-only cyberpunk. The generated light-mode palette was rejected at persistence time — the app ships dark-only and its anti-patterns forbid light mode.

| Role | Hex | App CSS Variable | Usage |
|------|-----|------------------|-------|
| Background | `#050816` | `--color-cyber-bg` | Page canvas |
| Surface / Secondary | `#0f172a` | `--color-cyber-secondary` | Panels, wells |
| Card | `#111827` (70% + blur) | `--color-cyber-card` | GlassCard base |
| Foreground | `#ffffff` | `--color-cyber-text` | Primary text |
| Muted text | `#94a3b8` | `--color-cyber-muted` | Secondary text (~7:1 on bg) |
| Dark gray / border | `#1e293b` | `--color-cyber-dark-gray` | Divider/border baseline |
| Primary accent | `#00f0ff` | `--color-cyber-cyan` | Signature neon: CTAs, focus, live indicators |
| Secondary accent | `#a855f7` | `--color-cyber-purple` | Secondary CTAs, persona accents |
| Success | `#10b981` | `--color-cyber-emerald` | Nominal/running status |
| Destructive | `#dc2626` | `--color-cyber-red` | Reset/destructive actions (additive token) |
| Queued / warn | `#f59e0b` | `--color-cyber-amber` | Queued/pending status (additive token) |

**Status semantics (dashboard):** running → emerald · queued → amber · failed → red · healthy/idle → cyan. Contrast: primary text ≥ 4.5:1; secondary/muted ≥ 3:1 — both checked against `#050816`.

### Typography

| Role | Font | Notes |
|------|------|-------|
| Display / headings | Orbitron | Cyber/HUD mood; `font-display` |
| Body | Inter | `font-sans` |
| Mono / data | JetBrains Mono | `font-mono`; telemetry, timestamps, ids |

Skill's generic dashboard pairing (Fira Code / Fira Sans) was considered; Orbitron + Inter + JetBrains Mono match the Cyberpunk style better and are the shipped stack. Fira Code remains the fallback if mono legibility at <10px in dense tables becomes a problem.

### Spacing

4/8px rhythm (Tailwind default scale). Dense dashboard views may use 8–16px gaps; marketing/landing sections 24–64px.

### Effects

- Neon glow: `box-shadow` / `text-shadow` with the accent at low alpha (e.g. `0 0 15px rgba(0,240,255,0.15)`)
- Glass: `bg-[rgba(17,24,39,0.7)]` + `backdrop-blur-md` (GlassCard)
- Scanlines / grid overlay: `.cyber-grid` 40px grid at 3% cyan
- Hover transitions 150–300ms; `active:scale-95` press state (no layout shift)

### Page Pattern

**Real-Time / Operations Landing** — hero with live status → key metrics → how it works → CTA (primary in nav + after metrics). Trust signals: demo/sandbox link, live status.

---

## Component Specs

### GlowButton
Transparent fill + colored border + glow shadow; hover fills with the accent and darkens text. Variants: `cyan` (primary), `purple`, `emerald`, `ghost`. Font: Orbitron, uppercase, `text-xs`, tracking-wider. **Focus: `focus-visible:ring-2 ring-cyber-cyan/70 ring-offset-2`.**

### GlassCard
`bg-[rgba(17,24,39,0.7)] backdrop-blur-md rounded-xl border` with optional glow color and hover lift. **Focus-within: `focus-within:border-cyber-cyan/30`** so an inner focused control is visible.

### StatusBadge
Status-colored pill (cyan/emerald/purple) with dot indicator; `font-mono` micro-label.

### Modals
Overlay `bg-black/80 backdrop-blur-md`; panel is a GlassCard with cyan glow. Micro-interactions 150–300ms, exit faster than enter.

---

## UX Rules (shipped — do not regress)

- **prefers-reduced-motion**: global `@media (prefers-reduced-motion: reduce)` collapses animation/transition durations; Framer Motion wrapped in `<MotionConfig reducedMotion="user">`.
- **Focus states**: global `:focus-visible { outline: 2px solid var(--color-cyber-cyan) }`; interactive elements must never remove focus styling without a replacement.
- **First-load skeleton**: dashboard shows an `aria-busy` pulsing placeholder until the first live engine snapshot lands (context flag `hasLoadedSnapshot`).
- **Loading feedback**: any async operation >300ms shows a spinner/skeleton; submit buttons disable during activation.
- **No emojis as icons** — Lucide only (shipped), consistent stroke.
- **cursor-pointer** on all clickable elements; hover states smooth 150–300ms.

---

## Anti-Patterns (Do NOT Use)

- ❌ Light mode — the app is dark-only by design
- ❌ Poor data viz — every chart needs a text-visible fallback
- ❌ Emojis as icons — Lucide SVG only
- ❌ Missing `cursor:pointer` on clickable elements
- ❌ Layout-shifting hovers / instant state changes (no transitions)
- ❌ Low-contrast text (< 4.5:1 body, < 3:1 secondary)
- ❌ Invisible focus states — keyboard focus must always be visible
- ❌ Ignoring `prefers-reduced-motion`

---

## Pre-Delivery Checklist

- [ ] No emojis used as icons (Lucide SVG only)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150–300ms)
- [ ] Text contrast ≥ 4.5:1 (body), ≥ 3:1 (secondary) on `#050816`
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected (CSS + Framer MotionConfig)
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars / no horizontal scroll on mobile
- [ ] Charts have non-visual value fallbacks (text/table)
