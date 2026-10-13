# Story, characters and branching

All original writing for this game. The city, the circuit, the company, the cars
and every character are invented. No commercial game's story, map or characters
are reproduced.

---

## Setting

**Anandapur** — a harbour city with a port, a fish market, salt flats beyond the
port road, and harbour cranes that run all night.

**Vettaru International Circuit** ("the Vettaru Ring") — 3,312 m, out past the
port. See [README.md](../README.md#the-circuit) for the full layout.

---

## Characters

| Character | Role | Notes |
| --- | --- | --- |
| **{hero}** (default **Aarav**) | The player | **Name is configurable** and used by every other character |
| **Sudha** | Mother | Gives interview advice if asked; relationship tracked |
| **Ramesh** | Father | Thirty years of being hired badly; gives different advice |
| **Divya** | Sister, 13 | The school term fee is the deadline that drives chapter 1 |
| **Mr. Nadar** | Landlord | The rent letter |
| **Ms. Farida Qureshi** | Workshop manager, Kalpesh Motors | Conducts the interview and the negotiation |
| **Mr. Deepak Rao** | Manager | Referenced in the workplace chapters |
| **Joseph** | Colleague | **Separate character.** Loud, direct, invites you racing |
| **Mithin** | Colleague | **Separate character.** Quiet, measuring, lends a helmet he denies buying |
| **Rehan Saxena** | Mentor / opponent | Races at level 2 and 3 |
| **Ms. Leela Varma** | Race official | Runs club days; explains the controls in chapter 5 |
| **Kabir Anand** | Rival | Level 3 and 4 |

**Joseph and Mithin are never conflated.** They have separate scene nodes
(`ch4_joseph`, `ch4_mithin`), separate `relationships` counters, separate
speakers, and separate dialogue voices. Joseph is the one who greets the hero and
asks their name; the hero answers with the configured name. A test asserts they
are distinct.

### Sponsors (original, on the ad boards)

Nexora Fuel · Brightline Tyres · Kalpesh Motors · Sunridge Bank · Volt & Vine ·
Meraki Coffee · AeroGrip · Trident Logistics · Vettaru Marine · Anandapur Port

Board artwork is generated at runtime from this list by `makeSponsorTexture()` in
`src/world/trackside.js`. No real company's branding is reproduced.

---

## Chapters

### 1 — The Weight of the City
City intro. A market walk with three choices (help a stranger, hurry, listen to
an argument about onions). Home. Mr. Nadar's rent letter: 400 rupees more a
month. An argument between Sudha and Ramesh with **four** choices — side with
father, side with mother, offer to find work, or say nothing — each recording a
different relationship delta and a different flag. Divya and the term fee. A
night awake doing the arithmetic.

### 2 — The Interview
Job search (Kalpesh Motors, or the certain-but-dead-end tea stall). Preparation:
ask your mother, ask your father, or prepare alone — three different pieces of
advice. Travel: the 7:50 bus (early), the 8:20 bus (late, sets `late_arrival`
which *reduces* your negotiating leverage in chapter 3), or walk (free, two
hours, arrive sweaty). Then the interview itself.

### 3 — The Number
Salary negotiation. See below.

### 4 — The First Day
The workshop floor. Joseph asks your name and you tell him. Mithin chalks a
square for you to stand in, or doesn't, depending on how you answer. Lunch on
upturned crates: sit with them, eat alone, or keep working to look keen — and
Joseph's answer to the last one is the one you remember. Ms. Qureshi at the gate
about the paid training day.

### 5 — An Invitation
**"Do you like car racing?"** Three answers, all of which lead somewhere. A Sunday
club day at the circuit. Ms. Leela Varma explains Game TalkBack, every gesture,
both routes into the settings, and what happens if you leave the track — **in
dialogue**, as the brief requires, before any race can start.

### 6 — Learning the Car
A forgiving first driving experience on an empty circuit. No opponents, nothing
timed, nothing penalised. The lesson runs in small steps and **chapter 7 stays
locked until the controls are understood** — and "understood" means the player
actually demonstrated each gesture, not that they tapped Finish.

### 7 — The First Race
The paddock at six in the morning. Joseph's advice, Mithin's helmet and the entry
form. The driver briefing with a real question you can ask. The grid, six painted
staggered positions, you third on the left. The five-light gantry. Two laps, two
opponents, and a **real result** taken from where your car actually crosses the
line. Three different endings — win, second, last — each written as its own scene.

### 8, 9, 10 — declared, not implemented
*The Second Season*, *Away From Home*, *The Vettaru Championship*. They exist in
`CHAPTERS` with `playable: false`, are listed in the chapter menu labelled
**"Not yet playable"**, are `disabled`, and route to a placeholder node that says
so honestly. **There are no fake buttons.** Save files and chapter gating already
account for them, so adding chapter 8 is a content change, not an architecture
change.

---

## Interview scoring

`src/story/interview.js`. Five questions, each with one strong (3), one middling
(1 or 2) and one weak (0) answer. Maximum 15.

| Ratio | Band | Outcome |
| --- | --- | --- |
| ≥ 0.78 | **pass** | An offer is made; chapter 3 opens |
| ≥ 0.50 | **mixed** | **Follow-up questions** (two more, scored the same way), then pass or fail |
| < 0.50 | **fail** | Retry the interview now, **or** take the Saturday workshop route, **or** go to the tea stall |

**Every option carries its own written explanation of why it landed the way it
did**, spoken immediately after you choose, and available again as a full
per-question review. The feedback explains consequences and employer reasoning,
not just "good answer".

Follow-up results are **merged** with the original score rather than replacing it
(`mergeInterviewResults`), so doing well under pressure actually rescues a mixed
interview.

The fail branch is a genuine alternative route, not a dead end: working the
Saturday sets `workshop_saturday`, which raises your negotiating goodwill in
chapter 3 and changes what Ms. Qureshi says to you.

---

## Salary negotiation

`src/story/negotiation.js`. A deterministic state machine — **nothing random**.

**The opening offer depends on:**

- the interview **band** (pass / mixed / fail sets the base)
- the interview **ratio** (fine-tunes within the band)
- whether you already have another offer (forces the opening up)

**The employer's ceiling depends on recorded story state**, via `LEVERAGE_SOURCES`.
Each source has a value *and a spoken reason*, so the player understands their own
position:

| Source | Value | Why |
| --- | --- | --- |
| `interview_pass` | +0.22 | They already decided they want you |
| `interview_mixed` | +0.06 | Less certain about you |
| `interview_fail` | −0.08 | Only reconsidered after a second attempt |
| `workshop_saturday` | +0.18 | They have seen you work |
| `joseph_recommendation` | +0.12 | Cost him something, so it counts |
| `mithin_recommendation` | +0.10 | Vouched for you to the supervisor |
| `family_pressure` | −0.14 | They can tell you need this quickly |
| `other_offer` | +0.20 | The strongest position anyone can negotiate from |
| `late_arrival` | −0.10 | You were late to this meeting |

**Three rounds**, then the last figure stands. Choices each round: ask modestly,
ask boldly, ask about hours and training instead, accept, or (from round two)
walk away.

- Asking **within** the ceiling is granted; a bold ask still costs goodwill.
- Asking **above** it gets a counter at the ceiling.
- Asking boldly **above** it with no goodwill left **reduces the offer** — pushing
  too hard has a real cost.
- Asking about **conditions rather than money** raises goodwill *and* the figure,
  because you asked about the work.
- **Walking away** withdraws the offer and routes the story to the Saturday
  workshop branch, where a higher figure is eventually offered because you came
  back.

**The accepted salary is recorded** in story state and reused: chapter 3's
contract scene, the recap screen and the save file all quote the same number.
Money is spoken as words ("nine thousand five hundred rupees"), never digits.

Market band: floor 7,500 / typical 9,500 / good 11,500 / ceiling 15,000 per month.
Tests assert no outcome escapes that band.

---

## Branching and state

`src/story/storyEngine.js` walks a scene graph of **~90 nodes**. Node kinds:
`scene`, `dialogue`, `action`, `interview`, `negotiation`, `tutorial`, `race`,
`chapter_end`.

- **Choices** carry `effects` (flags, relationships, top-level fields) and an
  optional `requires(state)` predicate, so options can appear or disappear based
  on what you did.
- **`next` may be a function of state**, which is how the interview result, the
  negotiation outcome and the race result route to different nodes.
- **Relationships** are per-character counters that change later dialogue.
- `{hero}` and other placeholders resolve from state, so the configured name
  flows through all seven chapters without duplicated strings.
- `applyEffects` never mutates the previous state.

### Chapter 7's result comes from the race, not from a script

`ch7_race` hands control to the real race screen. When the race ends, the genuine
finishing position is written into story state and `ch7_result` routes to
`ch7_won`, `ch7_podium` or `ch7_lost` accordingly. If no result was recorded —
the race was abandoned, or the page was reloaded mid-race — the story routes to
`ch7_result_none` and offers to run the race again rather than inventing a
finishing position.

---

## What is recorded in the save

Hero name, chapters completed, current node, visited nodes, all flags, all
relationship counters, the interview result, the salary, employment status and
route, whether the controls are understood, tutorial steps demonstrated, the last
race result, best lap times, XP, coins, level, achievements, unlocked cars,
selected car, and all accessibility settings.

Everything read back is validated by `coerceSave()` — see
[TESTING.md](TESTING.md#saving-and-validation).
