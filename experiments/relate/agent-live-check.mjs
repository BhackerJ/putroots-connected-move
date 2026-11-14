import assert from 'node:assert/strict';
import { runAgent } from './agent.mjs';
import { EXCEPTION_EMAIL } from './move-fixtures.mjs';
import { createMoveGraph } from './move-graph.mjs';

const graph = createMoveGraph();

const question = 'Can my current reservation go ahead? Check the actual reservation and tell me the primary conflict.';
const current = await runAgent(graph, { question });
assert.ok(current.tools.some(tool => tool.name === 'find_conflicts'));
assert.match(current.answer, /\[S03\]/);

const monday = await runAgent(graph, {
  question: 'How about moving on Monday, December 7, 2026?',
  history: [{ role: 'user', content: question }, { role: 'assistant', content: current.answer }],
});
assert.ok(monday.tools.some(tool => tool.name === 'find_conflicts' && tool.input?.date === '2026-12-07'));
assert.match(monday.answer, /\[S05\]/);

const before = graph.findConflicts();
const proposal = await runAgent(graph, { question: 'Review this exact email and prepare it for my confirmation: ' + EXCEPTION_EMAIL });
const candidate = proposal.tools.find(tool => tool.name === 'prepare_source')?.result;
assert.ok(candidate?.candidateId);
assert.equal(graph.findConflicts().caseVersion, before.caseVersion);
const committed = graph.applySource({ candidateId: candidate.candidateId });
assert.ok(committed.after.caseVersion > before.caseVersion);
assert.equal(committed.after.checks.find(check => check.id === 'unloading').status, 'satisfied');
console.log('Live Claude tool calls verified for the current reservation, Monday preview, and separately confirmed source update.');

