import { Database } from '@relate/relate';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MOVE_RULES_CSS, renderMoveRulesCard } from '../../src/move-rules-card.mjs';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const directory = mkdtempSync(join(tmpdir(), 'putroots-relate-'));
const connection = Database.open(join(directory, 'move.rl')).connect();
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));

connection.query(`CREATE (:Move {id:'sample', day:'Saturday'})-[:REQUIRES]->(:Rule {day:'Weekdays'})-[:FROM]->(:Source {quote:'Unloading is allowed Monday through Friday only.', receipt:'PR-7319'})`);
const cypher = `MATCH (m:Move {id:$id})-[:REQUIRES]->(r:Rule)-[:FROM]->(s:Source)
WHERE m.day = 'Saturday' AND r.day = 'Weekdays'
RETURN m.day AS booking, s.quote AS evidence, s.receipt AS receipt`;
const check = () => connection.query(cypher, { id: 'sample' }).rows[0];

if (process.argv.includes('--mcp')) {
  for await (const line of createInterface({ input: process.stdin })) {
    const { id, method, params } = JSON.parse(line);
    if (id === undefined) continue;
    let result;
    if (method === 'initialize') {
      result = { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'putroots-probe', version: '1.0.0' } };
    } else if (method === 'tools/list') {
      result = { tools: [{ name: 'find_conflicts', description: 'Query the current Put Roots sample move and return its conflict evidence and receipt.', inputSchema: { type: 'object', properties: {} } }] };
    } else if (method === 'tools/call' && params.name === 'find_conflicts') {
      if (process.env.PROBE_TRACE) writeFileSync(process.env.PROBE_TRACE, JSON.stringify({ tool: params.name, result: check() }));
      result = { content: [{ type: 'text', text: JSON.stringify(check()) }] };
    } else {
      console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown method' } }));
      continue;
    }
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }
} else {
  const row = check();
  assert.equal(row.receipt, 'PR-7319');
  connection.begin();
  connection.query("MATCH (m:Move) SET m.day = 'Monday'");
  assert.equal(check(), undefined);
  connection.rollback();
  assert.equal(check().receipt, row.receipt);
  const html = renderMoveRulesCard('move', {
    rows: [{ label: 'Move-in window', value: row.booking, src: row.evidence }],
  }, true);
  assert.ok(html.includes(row.evidence) && MOVE_RULES_CSS.includes('.mvrulesrc'));
  writeFileSync(join(tmpdir(), 'putroots-relate-card.html'), '<!doctype html><meta charset="utf-8"><style>' + MOVE_RULES_CSS + '</style>' + html);
  console.log(JSON.stringify(row));
}
