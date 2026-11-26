# Put Roots — Connected Move

**Elevator pitch**
Review a property email offline, confirm the rule it changes, and see whether your moving appointment still works.

**Platform** · Web (desktop Chrome)
**Built with** · Firebase AI Logic, Gemini Nano 4, Gemini 3.5 Flash-Lite, Firebase App Check, Relate, JavaScript, Node.js

## Inspiration

The freight elevator is booked for Saturday, 11:30 to 13:30. Then the building manager writes, “All unloading must be wrapped up by noon every Saturday.” You have an elevator for two hours and permission to unload for only the first thirty minutes. A resident coordinating a move needs to see both facts before calling the mover.

## What it does

Paste a property reply into Connected Move. In Chrome, the app extracts a proposed rule and shows the exact words that support it. You can read the two side by side before deciding whether to save the change.

Confirm the noon deadline and the move plan flags a 90-minute overrun. Confirm a second email reserving the elevator and the elevator turns green. The deadline conflict stays visible beside it. If management later cancels the lift, the reservation goes back to pending. A tentative reply such as “We might be able to offer a different unloading slot” leaves the plan untouched.

## How we built it

Firebase AI Logic runs Gemini Nano 4 in on-device-only mode to interpret free-form English replies. After the page and model are loaded, review works offline. The app checks that the proposed decision fits a supported rule and that its quoted evidence appears verbatim in the email. The resident checks the meaning and scope.

After confirmation, the local Relate graph saves the evidence and recomputes the plan. A separate Firebase AI Logic call uses cloud-only inference with Gemini 3.5 Flash-Lite and Firebase App Check. For an elevator cancellation, the case data consists of the reservation type and state, the booking date, and the unloading start and end times. Gemini can suggest asking management to reinstate or reschedule the lift. The email, greeting, signature and supporting quote stay on the device throughout this flow.

## What we built for #BuildHybridAI

We started with our earlier Put Roots — Connected Move submission to the Relate hackathon. That version already compared moving dates, traced rules to source excerpts, and recomputed conflicts after a user confirmed a property reply in a supported fixed format. We reused its graph, transaction and review flow, synthetic moving case, and interface. The original Put Roots product supplied the rules-card renderer and styling. The earlier demo also included an optional Claude tool bridge.

For this event we added free-form, on-device email extraction; a review pairing the normalized decision with a checked verbatim quote; recurring weekday unloading deadlines; and a field-limited cloud explanation through Firebase AI Logic. We also changed the confirmation view so the property’s decision and any remaining unloading deadline conflict can be read together. Claude Code and Codex assisted development of the earlier demo; Codex assisted with this update.

## What we learned and verified

A cloud model given only the elevator decision can correctly confirm the lift and still give the resident too much confidence about the move. We now put the local schedule conflict beside the confirmation and label the expandable Gemini explanation with its narrower scope.

We tested four synthetic replies on a Mac with desktop Chrome. The deadline, elevator confirmation and cancellation each produced a real HTTP 200 Gemini response on Firebase Spark. The tentative reply produced no confirmation button, no graph change and zero Gemini requests. These are four demonstrated cases; the current workflow handles one supported decision per email.
