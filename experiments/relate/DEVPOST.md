# Put Roots — Connected Move

Everything is booked. Can I actually move in?

Put Roots checks a moving plan against the documents that govern it. In the
sample, the mover is booked for Saturday but the building allows unloading only
on weekdays. Moving on Monday misses the old home's key return deadline.
Friday options bring different costs, insurance requirements and deadlines.

Relate connects each booking to requirements and supporting source excerpts.
The demo traverses those relationships, compares candidate dates without
changing the booking, and reruns the checks after the user confirms a new
property reply. A scoped Saturday exception clears the unloading conflict.
The freight elevator reservation still needs attention.

The inspectable starting graph is a Relate single-file store at
`experiments/relate/seed.rl`. The local demo works on a temporary copy of that
file, so each run can be reset and the committed store stays unchanged. The README
explains how to run the demo and enable live Claude tool calls. REUSE.md
documents existing Put Roots code and AI assistance.
