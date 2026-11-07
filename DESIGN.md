---
name: journey-lab viewer
description: A loan statement of evidence for an LLM agent's customer-service journey at fictional Northwind Lending.
colors:
  teal: "#0e6b5f"
  teal-ink: "#0a5047"
  teal-wash: "#dfeee9"
  teal-wash-2: "#eef6f3"
  red: "#a3302a"
  red-ink: "#7d231f"
  red-wash: "#f7e7e4"
  paper: "#fbfbf9"
  paper-2: "#f2f3f0"
  paper-3: "#e9ebe7"
  ink: "#16191d"
  ink-2: "#3d4753"
  ink-3: "#5f6a76"
  rule: "#d4d8dc"
  rule-soft: "#e4e7e9"
  tint-facts: "#eff5f3"
  tint-gate: "#f5f4ef"
  tint-judge: "#f1f3f7"
  tint-incident: "#f6f2ef"
  tint-fine: "#f2f3f0"
typography:
  display:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "2.625rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  section:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.2
  body-read:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.62
  body:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "\"kern\", \"liga\""
  body-sm:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.02em"
  mark:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.08em"
  mono:
    fontFamily: "Red Hat Mono Variable, Red Hat Mono, ui-monospace, SF Mono, monospace"
    fontSize: "0.92em"
    fontWeight: 500
    fontFeature: "\"zero\""
rounded:
  mark: "2px"
  paper: "3px"
spacing:
  s-1: "0.25rem"
  s-2: "0.5rem"
  s-3: "0.75rem"
  s-4: "1rem"
  s-5: "1.5rem"
  s-6: "2rem"
  s-7: "3rem"
  s-8: "4.5rem"
  s-9: "7rem"
  measure: "68ch"
  page: "76rem"
  nav-h: "3.5rem"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.paper}"
    padding: "0 1rem"
    height: "2.5rem"
  button-hover:
    backgroundColor: "{colors.paper-2}"
  button-active:
    backgroundColor: "{colors.paper-3}"
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.paper}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.paper}"
    padding: "0 1rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "{colors.teal-ink}"
  button-disabled:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink-3}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.paper}"
    padding: "0 0.75rem"
    height: "2.5rem"
  input-disabled:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink-3}"
  nav-link:
    textColor: "{colors.ink-2}"
    typography: "{typography.body-sm}"
    padding: "0 0.75rem"
    height: "{spacing.nav-h}"
  nav-link-current:
    textColor: "{colors.ink}"
  state-ok:
    textColor: "{colors.teal-ink}"
    typography: "{typography.label}"
  mark-fail:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.red-ink}"
    typography: "{typography.mark}"
    rounded: "{rounded.mark}"
  mark-neutral:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.mark}"
    rounded: "{rounded.mark}"
  mark-perf:
    backgroundColor: "{colors.teal-wash-2}"
    textColor: "{colors.teal-ink}"
    typography: "{typography.mark}"
    rounded: "{rounded.mark}"
  due-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    padding: "0.5rem 1rem"
  statement-band:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.paper}"
    padding: "0.75rem 1rem"
  ledger-panel:
    backgroundColor: "{colors.paper-2}"
    rounded: "{rounded.paper}"
    padding: "0.5rem"
  ledger-entry:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.paper}"
    padding: "0.75rem"
  gate-stub:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.paper}"
    padding: "1rem"
    width: "15.5rem"
  segmented-item:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.body-sm}"
    padding: "0 1rem"
    height: "2.25rem"
  segmented-item-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
---

# Design System: journey-lab viewer

## Overview

**Creative North Star: "The Statement of Evidence"**

The viewer is a printed loan statement, not a monitoring console. Northwind Lending's paper carries one teal band across its head, a heavy ink rule under the title, an Amount Due box on the right, and an account summary set with leader dots. Below the sheet, each chapter is one page of the activity ledger. Every figure is a line item with a source. The honest limits are set as fine print. The way forward is a detachable remittance stub. Calls, Gate runs, and Live call are tool pages printed on the same paper. They are denser and calmer, and they have no scroll choreography.

Ink is rationed by role. Teal marks what code owns: tool-built facts, the release, the one statement band, and the primary action. Ink black carries model language and structure. Red appears only on a blocked or failed claim. State is never a hue alone. A passing result is quiet teal text with a drawn check. An exception is an outlined, uppercase mark. A release is a perforated mark. A blocked gate run is overprinted VOID at its foot. Depth is paper and rule, not shadow. Hairlines divide; a 3px ink rule closes a header; a 2px ink border holds the box that matters.

The world is light only. The use scene is a daytime screen share through a compressed video stream, so the system prefers high contrast and solid, legible marks. The fictional company and the honesty line ("Modeled on public descriptions of agent platforms. Not built on Sierra. Fictional company and data.") are fixed elements of every page: the colophon prints the line on all routes, and the Statement prints it again in bold in the fine print.

**Key Characteristics:**
- Statement paper, ink, ledger slate, hairline rules, one Northwind teal.
- State as a mark and a word: drawn check, double-bordered fail mark, perforated release mark, VOID band.
- Provenance drawn in type: teal underline for tool-built text, an ink box for fixed text, plain for the model's own words, superscript references to a numbered tool ledger, leaders in the gutter.
- Tabular numerals everywhere a number is compared.
- Scroll motion only on the Statement; tool routes move only to show state.
- Square paper corners (3px), no decorative shadow, no dark mode.

## Colors

One code-owned teal and one exception red on warm-white statement paper, with three inks and two rules doing all the structural work.

### Primary
- **Northwind Teal** (`teal`): the statement band, the wordmark band, the primary button, the focus ring, the tool-text underline, a lit leader, the scroll-progress rule, the full part of a meter. It means "code owns this."
- **Deep Ledger Teal** (`teal-ink`): teal used as text. Links, passing state text, superscript references, the ledger entry's spoken line, primary button hover. It meets text contrast where `teal` is a fill or line.
- **Teal Wash** (`teal-wash`): text selection and a lit tool span.
- **Pale Teal Wash** (`teal-wash-2`): the fill of the proving line and of the perforated release mark.

### Tertiary
- **Void Red** (`red`): borders and fills for exceptions only. The fail mark's double border, a failed verdict box, a blocked ledger entry (mixed 40% into `rule`), the low part of a meter, the VOID stroke (mixed to 55%).
- **Void Red Ink** (`red-ink`): exception text. Failed scenarios, safety-critical counts, a falling change, error notices.
- **Void Red Wash** (`red-wash`): the fill behind a fail mark and an error notice.

### Neutral
- **Statement Paper** (`paper`): the page, every card face, every input.
- **Ledger Slate** (`paper-2`): the second layer. The tool ledger panel, the live call side panel, notices, hovered rows and buttons, skeleton lines.
- **Ledger Slate Deep** (`paper-3`): pressed buttons and the skeleton shimmer peak.
- **Ink** (`ink`): headings, body, the 3px header rule, the Amount Due border and bar, the fixed-text box, table header underline, the current nav underline.
- **Ink Secondary** (`ink-2`): ledes, caller turns, secondary text (9:1 on paper).
- **Ink Tertiary** (`ink-3`): labels, captions, column heads, timestamps (5.3:1 on paper).
- **Rule** (`rule`): borders of cards, inputs, and panels; leader lines at rest; leader dots.
- **Soft Rule** (`rule-soft`): row dividers inside tables, transcripts, and lists.
- **Chapter Tints** (`tint-facts`, `tint-gate`, `tint-judge`, `tint-incident`, `tint-fine`): each Statement chapter mixes its tint 45–55% into paper as a background. They map territory only.

### Named Rules
**The Rationed Ink Rule.** Teal means code-owned or released. Red means blocked or failed. Ink means everything else. No colour is used for decoration or emphasis outside its role.

**The Mark And Word Rule.** A state always has a shape and a word: a check plus "Passed", a double border plus "BLOCKED", a dotted edge plus "RELEASED". Remove the colour and the state must still read.

**The Tint Is Territory Rule.** Chapter tints say where the reader is in the statement. They never say whether something passed.

## Typography

**Body Font:** Public Sans Variable (self-hosted through `@fontsource-variable/public-sans`, falling back to Public Sans and system-ui)
**Label/Mono Font:** Red Hat Mono Variable (self-hosted through `@fontsource-variable/red-hat-mono`, falling back to ui-monospace and SF Mono)

**Character:** Public Sans is a plain, civic sans with a full variable weight axis, so headings sit at 650–700 and nav at 550 without a second family. Red Hat Mono, with a slashed zero, prints identifiers the way a statement prints account and reference numbers: call ids, gate run ids, versions, tool names, the OCR scan line.

### Hierarchy
- **Display** (700, 2.625rem, 1.2, -0.025em): the Statement title only. It drops to 2rem under 720px.
- **Headline** (700, 2rem, 1.2): chapter titles, tool page titles, call titles, the Amount Due figure and gate stub figures.
- **Title** (650, 1.25rem, 1.2): the remittance stub title, empty-state headings. A run title on Gate runs uses 1.5rem.
- **Section** (700, 1rem): table and column headings, always over a 1px ink rule.
- **Body Read** (400, 1.0625rem, 1.62): transcript turns and ledes, held to a 68ch measure.
- **Body** (400, 1rem, 1.55): default text; kerning and ligatures on.
- **Body Small** (400, 0.875rem): table cells, controls, fine print, notices.
- **Label** (600, 0.8125rem, 0.02em): column heads, field labels, the running head, captions, in Ink Tertiary.
- **Mark** (700, 0.75rem, 0.08em, uppercase): state marks and the ink header bars of boxes.
- **Mono** (500, 0.92em of its context, slashed zero): identifiers and code.

### Named Rules
**The Tabular Figures Rule.** Every compared number uses tabular numerals and right alignment (`.num`). Tables are set with `font-variant-numeric: tabular-nums` by default.

**The Identifier Is Mono Rule.** Anything a reader could paste into a query (ids, versions, tool names, file paths) is set in Red Hat Mono. Prose is never mono.

## Layout

A fixed statement page: a 76rem column centred with 1.5rem gutters (1rem under 720px), and 68ch for any running text. Tool routes widen to 90rem for tables. The sticky nav is 3.5rem tall. On the Statement a running head sticks directly under it.

Page 1 is a two-column sheet: title and sub-copy on the left, the Amount Due box on the right (18–22rem), then the account summary and the activity table in a 0.9fr / 1.1fr split. The sheet collapses to one column at 960px.

Chapters are full-bleed tinted bands with 4.5rem vertical padding (3rem under 720px). Inside, content stacks in a single grid with 2rem gaps.

The trace is a three-area grid: transcript, a 4.5rem gutter for leaders, and the tool ledger (min 17rem, 0.72fr). Under 880px it stacks to transcript, ledger, legend and the leaders are removed.

Spacing follows one scale (`s-1` 0.25rem through `s-9` 7rem). Dense tool screens stay on `s-2`–`s-5`; the Statement opens out to `s-6`–`s-8` between chapters.

Breakpoints as built: 1100px (four-up grids to two), 960px (statement sheet to one column), 900px (gate pin off), 880px (trace stacks), 860px (live call pane stacks), 720px (nav short labels, tighter gutters), 560px (single column everywhere), 420px (smallest nav).

### Named Rules
**The Fixed Measure Rule.** Running text never exceeds 68ch, even on the 90rem tool pages.

## Elevation & Depth

The system is flat. Depth comes from paper layers (`paper` on `paper-2`), hairline rules, and ink weight: 1px rules divide, a 2px ink border holds the important box, and a 3px ink rule closes a page header. One soft shadow exists, and it only answers state.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 1px 2px rgb(22 25 29 / 0.06), 0 6px 18px -6px rgb(22 25 29 / 0.14)`): a lit tool ledger entry and a hovered live-call recipe card. Nothing rests with a shadow.

### Named Rules
**The Flat Paper Rule.** Surfaces are flat at rest. A shadow appears only when the reader points at something that answers back.

**The Heavy Rule Rule.** Weight of line is the hierarchy: 1px soft rule between rows, 1px ink rule under a table head or section title, 2px ink around the Amount Due box, 3px ink under a page title.

## Shapes

Paper corners are barely there (3px). Marks and small ref boxes use 2px. The wordmark band uses 1px. The live dot is the only circle.

Statement devices are drawn with borders, not images:
- **Perforation:** a 2px dashed top edge. It marks the remittance stub (with a scissors icon and "Detach and keep" sitting on the cut), each gate stub's top, and each live-call recipe card. A perforated edge squares off its top corners (`0 0 3px 3px`).
- **Leader dots:** a 1.5px dotted rule between a label and its figure in the account summary.
- **Leaders:** SVG paths in the trace gutter from a tool-built sentence to its ledger entry.
- **VOID overprint:** outlined 2.75rem letters with a 1.5px red stroke and no fill, on a dashed band at the stub's foot.
- **Icons:** authored SVG on a 20px grid with one 1.6 stroke weight, round caps and joins.

## Components

### Buttons
Square, printed, and confident.
- **Shape:** paper corners (3px), 2.5rem tall, 1px ink border, 600 weight at 0.875rem.
- **Default:** paper face, ink text and border. Hover moves to Ledger Slate; active to Ledger Slate Deep.
- **Primary:** Northwind Teal face and border, paper text. Hover to Deep Ledger Teal. One primary per view.
- **Quiet:** the default with a Rule border.
- **Disabled:** Ledger Slate face, Rule border, Ink Tertiary text, not-allowed cursor.
- **Focus:** a 2px teal outline offset 2px, on every focusable element.
- **Link button:** teal-ink underlined text with no box, for in-table actions.

### State marks
- **Passing (`state-ok`):** no box. Deep Ledger Teal text at 0.8125rem/600 with a drawn check icon. Passing is the expected case, so it stays quiet.
- **Fail (`mark--fail`):** uppercase Mark type in Void Red Ink on Void Red Wash, inside a 3px double red border. Used for Blocked, tool errors, and guardrail events.
- **Neutral (`mark--neutral`):** uppercase Mark type in Ink Secondary on paper, 1px Rule border. Used for non-resolved outcomes, "In progress", and "Transcript only".
- **Release (`mark--perf`):** uppercase Mark type at 0.12em tracking in Deep Ledger Teal on Pale Teal Wash, with a 2px dotted teal edge like a PAID perforation. Used only for a release.

### Inputs / Fields
- **Style:** paper face, 1px Rule border, 3px corners, 2.5rem tall, 0.875rem text. A label above in Label type.
- **Hover:** border darkens to Ink Tertiary.
- **Focus:** border and a 2px outline both turn teal, no offset.
- **Disabled:** Ledger Slate face, Ink Tertiary text.
- **Checkbox and radio:** native controls with a teal accent colour.
- **Segmented control:** an ink-bordered row of 2.25rem buttons split by ink rules. The selected item inverts to ink with paper text.

### Navigation
- **Style:** a sticky 3.5rem bar on paper with a 1px rule under it. Left: the wordmark (a teal band, "Northwind Lending" in 700, "journey-lab" in mono). Right: Statement, Calls, Gate runs, Live call.
- **States:** links in Ink Secondary at 550; hover to ink; the current page goes to ink at 650 with a 2px ink underline on the bar's bottom edge.
- **Mobile:** under 720px the product name hides and "Gate runs"/"Live call" shorten to "Gate"/"Live".
- **Running head (Statement only):** a second sticky bar under the nav with the document name, the current chapter, "Page n of 6" in tabular figures, and a 2px teal progress rule scaled by scroll position.

### Tables
Statement ledgers, not data grids. A 1px ink rule under the head, soft rules between rows, a 1px ink rule closing the last row of a ledger table. Rows on tool pages are whole-row links that take Ledger Slate on hover.

### Amount Due box
The heavy box on page 1: 2px ink border, an ink bar with an uppercase paper label, a Headline figure, supporting lines, and the perforated release mark in the top right corner. The transfer slip on a call page uses the same ink-bar construction at 1px.

### Provenance trace (signature)
The transcript, a leader gutter, and a numbered tool ledger, read side by side.
- **Tool-built text:** a 2px teal underline drawn as a background, followed by a superscript mono reference number in Deep Ledger Teal. Pointing at it lights the span (Teal Wash), its leader (teal, 2px), and its ledger entry (teal border plus Lift).
- **Fixed text said by code:** the whole turn is boxed in a 1px ink border with an uppercase line name above it.
- **Model words:** plain text, no treatment.
- **Proving line:** the one turn that proves the chapter's claim sits on Pale Teal Wash between teal hairlines, with a teal-ink note under it.
- **Ledger entry:** paper card on the Ledger Slate panel, a teal-bordered number box, the tool name in mono, "ok · n ms" or a fail mark, the input in mono, the spoken line behind a teal left rule, and a disclosure for the raw result.
- **Legend:** three swatches under the trace: teal underline, ink box, plain rule.

### Gate stub (signature)
A 15.5rem paper stub with a dashed perforation on top, a timestamp, a Headline figure "n of N", the pass rate and cost, a state mark, up to three failed scenarios with cross icons in red ink, and the run id. A blocked stub takes a red-tinted border and the VOID band at its foot. The first stub of each version carries a mono version label above it. On the Statement the stubs run as a horizontal track; on narrow screens and with reduced motion the track is a native sideways scroll.

### Remittance stub
The last element of the Statement: a box with a dashed ink top edge, "Detach and keep" with a scissors icon on the cut, a title and the two actions (primary "Start a live call", default "Browse calls"), and an OCR-style scan line in mono at 0.08em tracking printing journey, version, hash, gate run, and score.

### Notices, empty, and loading
- **Notice:** Ledger Slate box, 1px Rule border, Body Small. The error variant uses Void Red border, wash, and ink, and has `role="alert"`.
- **Empty:** a dashed Rule box, centred text, a Title heading.
- **Loading:** ruled skeleton lines like an unprinted form, with a slow shimmer that stops under reduced motion.

### Motion
- **Tokens:** ease-out `cubic-bezier(0.16, 1, 0.3, 1)`; fast 140ms for hover and lit states, base 220ms, slow 420ms for posting, focal 720ms for the trace.
- **Statement only:** the scroll-linked page counter and teal progress rule; the sticky running head; summary and activity rows posting with a left-to-right clip reveal staggered 70ms per row; blocks settling 10px into place; the trace posting as the focal moment (tool underlines run in left to right, then leaders draw to their source, staggered 140ms); gate runs as a pinned horizontal track driven by vertical scroll (on at 900px and wider); the VOID band clip-revealing as each blocked stub enters; the system map on page 1 drawing the current step's route hop by hop on a click (240ms per hop, never on a loop), with the Tier mark stamping when the tier changes.
- **Tool routes:** state motion only. Hover colour changes, the disclosure chevron rotating, the busy live dot pulsing.
- **Reduced motion:** the motion class is never applied, so all content is present at once; the trace shows final underlines and leaders; the gate pin is off; the system map shows each step's final route at once and opens its list of steps as text; the shimmer and pulse stop.

## Do's and Don'ts

### Do:
- **Do** carry every state with a mark and a word: `state-ok` with a check for passing, `mark--fail` (3px double border) for blocked or failed, `mark--neutral` for other outcomes, `mark--perf` (2px dotted edge) only for a release.
- **Do** mark tool-built text with the 2px teal underline and a superscript reference to its numbered ledger entry; box fixed text in 1px ink; leave model words plain.
- **Do** set ids, versions, tool names, and paths in Red Hat Mono, and every compared number in tabular figures.
- **Do** keep running text at or under 68ch.
- **Do** close page headers with a 3px ink rule and section titles with a 1px ink rule.
- **Do** keep the honesty line ("Modeled on public descriptions of agent platforms. Not built on Sierra. Fictional company and data.") in the colophon of every route.
- **Do** keep scroll-driven motion on the Statement route and state-only motion on tool routes, and make every animation optional under `prefers-reduced-motion`.
- **Do** put a VOID band at the foot of a blocked gate run, on its own dashed band, never under text.

### Don't:
- **Don't** use teal or red for emphasis or decoration. Teal is code-owned or released; red is blocked or failed.
- **Don't** let a chapter tint signal state.
- **Don't** add a dark theme or dark console surfaces. The world is light paper for a daytime screen share.
- **Don't** put a shadow on anything at rest. Lift is a response to pointing.
- **Don't** round corners beyond 3px or introduce pill shapes; the live dot is the only circle.
- **Don't** use metric cards with large coloured numbers. Figures sit in ledgers, stubs, and the Amount Due box.
- **Don't** use a real company's name, branding, or data. Northwind Lending is fictional.
- **Don't** use icon fonts or library icons. Draw icons as SVG on the 20px grid at a 1.6 stroke.
