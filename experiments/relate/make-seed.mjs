// Rebuild seed.rl, the inspectable starting graph, from the source fixtures.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMoveGraph } from './move-graph.mjs';

const file = fileURLToPath(new URL('./seed.rl', import.meta.url));
rmSync(file, { force: true });
createMoveGraph(file).checkpoint();
console.log('Wrote ' + file);
