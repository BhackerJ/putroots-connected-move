# Put Roots — Connected Move

Everything is booked. Can I actually move in? Connected Move checks a moving
plan against the documents that govern it and shows which arrangements break
when the date changes.

## Use case

A move is a dozen separate promises: a mover's time slot, a building's
unloading hours, a freight elevator, a key-return deadline, a parking permit,
an internet appointment. Each lives in a different email. Nothing tells you
that the Saturday the mover confirmed is a day the building does not allow.

The relationships that matter:

- Each requirement is anchored to the move, so changing the move date reaches
  every one of them.
- Requirements depend on each other. The elevator can only be reserved after
  the mover's insurance certificate (COI) is accepted. Keys go back after
  cleaning, and the cleaners need power.
- Every booking, requirement, approval and exception points to the source text
  that supports it, so each answer can be traced to a sentence.
- A building reply can add an exception to one rule for one date without
  replacing the rule.

The sample is synthetic. The case date is fixed at November 30, 2026, in San
Francisco.

## How it uses Relate

- Mode: single file.
- Why this mode: one move is one small graph. A single `.rl` file can be
  committed, copied and inspected, and the app needs exactly one writer.
- What the graph models:

  | Node | Count in `seed.rl` | Meaning |
  | --- | --- | --- |
  | Move, Task | 1, 1 | The move and its date-bearing task |
  | Booking | 3 | The confirmed Saturday booking and two quoted Friday options |
  | Requirement | 9 | Rules and appointments the move must satisfy |
  | Approval | 1 | Management's decision on a mover's COI |
  | Source | 12 | The text each fact came from |

  Relationships: `HAS_TASK`, `HAS_BOOKING`, `ANCHORED_TO`, `DEPENDS_ON`,
  `SUPPORTED_BY`, `HAS_APPROVAL`. Confirmed replies add `Exception` nodes with
  `EXCEPTION_TO`, and `ElevatorUpdate` nodes with `HAS_ELEVATOR_UPDATE`.

What Relate does, in `experiments/relate/move-graph.mjs`:

- One Cypher query (`VERDICTS`) judges every requirement against a booking or
  a hypothetical date: weekday rule, time windows, deadlines, overlap between
  two appointments, the latest COI decision, and whether an active exception
  covers the slot.
- A variable-length query (`PATHS`) returns the path from the move through each
  requirement and along its `DEPENDS_ON` chain. The interface shows that path
  and marks a requirement as held up when something further along is unsettled.
- Source updates are written in an explicit transaction and bump a case
  version. A failed write rolls back.
- The graph view under **Move check** draws every node and relationship in the
  store (`graphView`). Requirements are coloured by verdict, and each
  conflict's path and source excerpts light up.

JavaScript words the verdicts and computes lead-time deadlines (48 hours before
unloading, 72 hours before loading) in Pacific time.

## Setup and run

Prerequisites: Node.js 18 or later with npm. Bun also works.

```sh
cd experiments/relate
npm ci
npm start
```

Open http://127.0.0.1:3210.

1. **Current booking** shows the Saturday conflict. Open **Relationship path**
   and **Source excerpts** on any row.
2. **What about Monday?** re-runs the same queries for December 7. Three
   arrangements break; in the graph the chain from the key return through
   cleaning to power turns red.
3. **Compare Friday options** checks both quotes. Mover B's elevator
   reservation waits on its COI.
4. Open **Add a property reply**, choose **Load sample reply**, then **Review
   update** and **Confirm update**. The new `Exception` node and its source
   appear in the graph. The unloading conflict clears for that date only. The
   elevator reservation is still needed.
5. **Reset sample** restores the starting graph.

Run the tests with `npm test`.

**Ask agent** is optional. It runs a signed-in Claude Code CLI against the same
graph through four tools. Set `PUTROOTS_CLAUDE_BIN` if the CLI is not on the
default path. Everything in the steps above works without it.

Property replies are read with strict patterns, so only statements in the
sample's wording are accepted. Anything else is returned as needing review and
is never written.

## Where the data lives

`experiments/relate/seed.rl` is the persistent Relate store. The server copies
it to a temporary file at startup and works on the copy, so the committed store
stays as shipped. The copy's path is printed when the server starts.

Inspect the store from `experiments/relate` after `npm ci`:

```sh
node -e 'const {Database}=require("@relate/relate");const c=Database.open("seed.rl",{readOnly:true}).connect();console.table(c.query("MATCH p=(:Move)-[:HAS_TASK]->(:Task)<-[:ANCHORED_TO]-(r:Requirement)-[:DEPENDS_ON*0..4]->(u:Requirement) RETURN r.label AS requirement, [n IN nodes(p) | n.id] AS path").rows.map(r=>({...r,path:r.path.join(" > ")})))'
```

Rebuild it from `move-fixtures.mjs` with `npm run seed`.

## Verified

On November 13, 2026, on macOS arm64: `npm ci`, the tests under Node 24.21 and
Bun 1.4.4, and the demo routes from a freshly packaged copy. An earlier
single-query probe (`probe.mjs`) also ran on Linux arm64 with Node 22 in a
clean container. The full demo has not been re-run on Linux.

## Reuse, tools and license

`REUSE.md` lists the code taken from the existing Put Roots product and the AI
tools used. The demo video was recorded inside the Put Roots map interface,
which is not part of this repository; the page served here is the same panel
on its own. Licensed under MIT.
