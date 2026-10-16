# Easy play: Racing Ground, Forest, City

These are **new, untimed, spoken mini-game modes**, available from the main menu
without finishing the story or gesture tutorial. The existing Three.js simulation
races, opponents, garage and story remain available and keep their existing
controls. The easy areas use a simplified endless route and a high-contrast 2D
visual companion, not a new full 3D open-world engine.

## One menu rule, everywhere

- Swipe up, down, left or right to move the cursor.
- **Single tap anywhere confirms and speaks the current cursor item.** It never
  moves selection to a different item under the finger and never activates.
- Double tap anywhere activates the cursor item.
- Down-left opens the local menu; up-left (or up then left promptly) goes back.
- In an area's menu, back resumes play. From play, back returns to the main menu.
- Keyboard: Tab moves menu focus; Enter activates; Escape goes back; P opens the
  area menu. W holds, S stops/strikes, A/D select left/right, Space sits/stands,
  R heals. Touch also offers up to aim at a monster ahead.

Choose **Start** after hearing the introduction. **How to play** in each local
menu reads that area's controls. There is no time limit or tutorial gate.

## Easy Racing Ground

- The car starts driving automatically at a gentle speed.
- Hold **more than three seconds** to accelerate; release and it keeps driving.
- Single tap, or hold one/two seconds and release, to stop and stay stopped.
- Directions use current rounded metres, paced every 3–5 seconds while moving.
- Swipe the announced direction to select the upcoming turn, even before reaching
  it. The actual turn happens automatically at the junction, not at the swipe.
- A wrong-direction swipe is explained so it can be corrected. Missing a junction
  causes a barrier crash, an out announcement, and an automatic restart after
  three seconds. Earned coins are kept.
- One coin every 25 metres, with no finite limit on the route. Pickup sounds play
  for every coin; speech counts groups of five to leave room for directions.
- Petrol burns with distance, not while paused or stationary. Low fuel is spoken.
  When empty, the car stops and the local menu opens **with Petrol selected**.
  Single tap anywhere still says Petrol; double tap refills it.
- A refill costs five coins. A player with fewer than five gets an explicitly
  announced free emergency refill, preventing a dead end. A full tank is never
  charged twice. Return to play, then hold over three seconds to drive again.

## Forest Adventure

- Hold to walk, release to stop. Double tap to sit/stand; holding stands up again.
- Select announced left/right paths with swipes. At an unselected junction, stop
  safely and hear the direction again rather than falling into a hazard.
- Monsters appear ahead, left or right and stop walking. Swipe up for ahead,
  or left/right to aim at that side; single tap strikes with the sword.
- Each monster takes two hits. Its health and the player's health are spoken.
  Every five seconds an undefeated monster inflicts eight health damage.
- Triple tap heals up to 50 health using one potion. Start with three; at full
  health no potion is wasted. Triple tap does not also trigger the double-tap sit
  action: this play surface defers double tap until the third-tap window closes.
- Defeating a monster gives five coins. Walking also gives coins. At zero health,
  restart safely at the entrance after three seconds; keep the wallet.

## City Walk

- Hold/release to walk/stop; double tap to sit/stand; swipe to select paths.
- Collect coins while walking. No monsters or combat in the city.
- The menu sells healing potions for three coins, and one city coin shop for 25.
  An owned shop earns one extra coin per 30 seconds of city walking, never while
  idle, paused or offline. Ownership cannot be bought twice.
- Menu links open the forest, easy ground, original racing events and garage.
- Optional easy quest: collect ten coins in one visit to any area, with no timer;
  receive ten bonus coins, once per save. Free exploration is never gated by it.

## Saving, sound and lifecycle

All areas share the existing saved coin wallet. Potion inventory, shop ownership
and the quest reward flag survive reloads. Current location, fuel and health are
session state; entering an area starts a fresh visit.

Only existing, credited recorded SFX are used: engine, brake, gear change, impacts,
footsteps and UI/pickup recordings. No generated or synthesized sound effects
were added. Spoken text uses the existing speech system.

Exit is mapped to silence, not the fallback menu theme. Backgrounding/pagehide
stops music, ambience, engine and one-shots, including pending/delayed audio.
Foregrounding a play area opens a safe menu instead of resuming movement
unexpectedly. Returning to the Exit screen remains silent. The input recognizer
is ticked every 25 ms so a delayed tap resolves even when no further touch comes.

Tests: `tests/easyWorld.test.mjs` (pure model and recognizer),
`tests/easyWorld.dom.test.mjs` (real application routing, cursor, purchases and
lifecycle), plus audio/music regressions in their existing test files. These are
automated tests, **not a claim of hands-on Android/TalkBack verification**.
