import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createMoveGraph } from './move-graph.mjs';
import { EXCEPTION_EMAIL } from './move-fixtures.mjs';

const check = (report, id) => report.checks.find(item => item.id === id);
const option = optionId => ({ scenario:'optionId', optionId });

test('current, date-only and option scenarios use one graph without changing the booking', () => {
  const graph = createMoveGraph();
  const current = graph.findConflicts();
  const conflict = check(current,'unloading');
  assert.equal(conflict.status,'conflict');
  assert.deepEqual(conflict.evidence.map(x => x.id).sort(),['S02','S03']);

  const monday = graph.findConflicts({ scenario:'dateOnly',date:'2026-12-07' });
  assert.equal(check(monday,'keys').status,'conflict');
  assert.equal(check(monday,'parking').status,'unknown');
  assert.equal(check(monday,'elevator').deadline,undefined);

  const { options:[a,b] } = graph.compareOptions();
  assert.equal(check(a,'internet').overlapStart,'10:00');
  assert.equal(check(a,'internet').overlapEnd,'11:00');
  assert.equal(check(b,'internet').overlapEnd,'12:00');
  assert.equal(check(a,'parking').deadlineLocal,'2026-12-01 09:00');
  assert.equal(check(b,'parking').deadlineLocal,'2026-12-01 10:00');
  assert.equal(check(a,'elevator').deadlineLocal,'2026-12-02 12:00');
  assert.equal(check(b,'elevator').deadlineLocal,'2026-12-02 13:30');
  assert.equal(check(a,'coi').status,'satisfied');
  assert.equal(check(b,'coi').status,'pending');
  assert.ok(check(b,'elevator').path.includes('coi'));
  assert.deepEqual(check(b,'elevator').blockedBy,['coi']);
  assert.deepEqual(check(monday,'keys').path,['sample','move','keys','cleaning','power']);
  assert.deepEqual(check(monday,'keys').relations,['HAS_TASK','ANCHORED_TO','DEPENDS_ON','DEPENDS_ON']);
  assert.deepEqual(check(monday,'keys').blockedBy,['cleaning','power']);
  assert.equal(check(current,'keys').blockedBy,undefined);
  assert.deepEqual([a.incrementalCost,b.incrementalCost],[120,80]);
  assert.ok(b.unknownFees.includes('Mover A cancellation'));
  assert.deepEqual(graph.findConflicts(),current);
});

test('graph view returns every node and relationship in the store', () => {
  const graph = createMoveGraph();
  const { nodes, edges } = graph.graphView();
  assert.equal(nodes.length,27);
  assert.equal(edges.length,31);
  const key = id => nodes.find(node => node.props.id === id).key;
  assert.ok(edges.some(edge => edge.from === key('keys') && edge.to === key('cleaning') && edge.type === 'DEPENDS_ON'));
  assert.ok(edges.some(edge => edge.from === key('cleaning') && edge.to === key('power') && edge.type === 'DEPENDS_ON'));
});

test('source preparation is read-only and only a confirmed exact exception changes the graph', () => {
  const graph = createMoveGraph();
  const initial = graph.findConflicts();
  const bad = graph.applySource({ text:EXCEPTION_EMAIL.replace('Saturday','Monday') });
  assert.equal(bad.status,'needs_review');
  const candidate = graph.applySource({ text:EXCEPTION_EMAIL });
  assert.equal(candidate.status,'prepared');
  assert.deepEqual(graph.findConflicts(),initial);
  const result = graph.applySource({ candidateId:candidate.candidateId });
  assert.equal(result.caseVersion,initial.caseVersion + 1);
  assert.deepEqual(result.changes.map(x => x.id),['unloading']);
  assert.equal(check(result.after,'elevator').status,'pending');
  assert.equal(check(graph.findConflicts({ scenario:'dateOnly',date:'2026-12-12' }),'unloading').status,'conflict');
  assert.equal(graph.applySource({ candidateId:candidate.candidateId }).caseVersion,result.caseVersion);
  graph.reset();
  assert.equal(check(graph.findConflicts(),'unloading').status,'conflict');
  assert.throws(() => graph.applySource({ candidateId:candidate.candidateId }), /missing or stale/);
});

test('graph writes survive reopen, and impact responds to a changed relationship and lead time', () => {
  const dir = mkdtempSync(join(tmpdir(),'relate-test-'));
  try {
    const path = join(dir,'move.rl');
    execFileSync(process.execPath, ['--input-type=module','-e',`
      import { createMoveGraph } from ${JSON.stringify(new URL('./move-graph.mjs',import.meta.url).href)};
      import { EXCEPTION_EMAIL } from ${JSON.stringify(new URL('./move-fixtures.mjs',import.meta.url).href)};
      const graph = createMoveGraph(process.argv[1],{ extended:true });
      const candidate = graph.applySource({ text:EXCEPTION_EMAIL });
      graph.applySource({ candidateId:candidate.candidateId });
      graph.checkpoint();
    `,path]);

    execFileSync(process.execPath, ['--input-type=module','-e',`
      import { Database } from '@relate/relate';
      const db = Database.open(process.argv[1]);
      const conn = db.connect();
      conn.query('MATCH (:Requirement {id:"parking"})-[r:ANCHORED_TO]->(:Task) DELETE r');
      conn.query('MATCH (r:Requirement {id:"elevator"}) SET r.hours = 120');
      db.checkpoint();
    `,path], { cwd:new URL('.',import.meta.url) });
    const reopened = createMoveGraph(path,{ extended:true });
    assert.equal(check(reopened.findConflicts(),'unloading').status,'satisfied');
    const friday = reopened.findConflicts(option('friday-a'));
    assert.equal(check(friday,'parking'),undefined);
    assert.equal(check(friday,'elevator').status,'conflict');
    assert.equal(check(friday,'elevator').deadlineLocal,'2026-11-29 12:00');
    const monday = reopened.findConflicts({ scenario:'dateOnly',date:'2026-12-07' });
    assert.equal(check(monday,'power').status,'conflict');
    assert.equal(check(monday,'cleaning').status,'conflict');
  } finally {
    rmSync(dir,{ recursive:true,force:true });
  }
});

test('confirmed changes update commitments and COI evidence independently', () => {
  const graph = createMoveGraph();
  const apply = text => {
    const candidate = graph.applySource({ text });
    assert.equal(candidate.status,'prepared');
    return graph.applySource({ candidateId:candidate.candidateId });
  };
  const ready = apply('Management accepted Mover B’s COI for this move.');
  assert.equal(ready.changes.length,0);
  assert.equal(check(graph.findConflicts(option('friday-b')),'coi').status,'satisfied');
  assert.match(check(graph.findConflicts(option('friday-b')),'elevator').detail,/Apply for/);
  apply('Management revoked approval of Mover B’s COI for this move.');
  assert.equal(check(graph.findConflicts(option('friday-b')),'coi').status,'pending');
  apply('Mover B confirms the quoted Friday, December 4, 2026 option for this move.');
  assert.equal(graph.findConflicts().booking.id,'friday-b');
  assert.equal(check(graph.findConflicts(),'duplicate-bookings').status,'conflict');
  apply('Mover A confirms cancellation of the original Saturday, December 5, 2026 booking for this move.');
  assert.equal(check(graph.findConflicts(),'duplicate-bookings'),undefined);
  apply(EXCEPTION_EMAIL);
  assert.equal(graph.findConflicts().booking.id,'friday-b');
  assert.equal(check(graph.findConflicts(),'unloading').status,'satisfied');
});

test('withdrawing an exception restores the conflict, and an elevator application is not confirmation', () => {
  const graph = createMoveGraph();
  const apply = text => {
    const result = graph.applySource({ text });
    assert.equal(result.status,'prepared');
    return graph.applySource({ candidateId:result.candidateId }).after;
  };
  assert.equal(check(apply(EXCEPTION_EMAIL),'unloading').status,'satisfied');
  assert.equal(check(apply('Management withdraws the following permission: ' + EXCEPTION_EMAIL),'unloading').status,'conflict');
  assert.equal(check(apply('Management received the freight elevator application for the Saturday booking for this move.'),'elevator').status,'pending');
  assert.equal(check(apply('Management confirmed the freight elevator reservation for the Saturday booking for this move.'),'elevator').status,'satisfied');
  assert.equal(check(apply('Management cancelled the freight elevator reservation for the Saturday booking for this move.'),'elevator').status,'pending');
});

test('reviewed deadline keeps its source, weekday and version across retries', () => {
  const graph = createMoveGraph();
  const reviewed = { baseVersion:graph.findConflicts().caseVersion,
    statement:'Unloading must finish by 14:00 every Friday.', quote:'On Fridays, finish unloading by two in the afternoon.' };
  const saved = graph.applySource({ reviewed });
  const id = saved.changes.find(item => item.label.includes('deadline · Fri')).id;
  assert.equal(check(saved.after,id).status,'satisfied'); // Saturday
  assert.equal(check(graph.findConflicts(option('friday-a')),id).status,'satisfied'); // finishes at 14:00
  const late = check(graph.findConflicts(option('friday-b')),id);
  assert.equal(late.status,'conflict');
  assert.ok(late.evidence.some(item => item.quote === reviewed.quote));
  assert.equal(graph.applySource({ reviewed }).caseVersion,saved.caseVersion);
  assert.throws(() => graph.applySource({ reviewed:{ ...reviewed,quote:'A different reply.' } }),/Review the email again/);
  assert.equal(graph.findConflicts().caseVersion,saved.caseVersion);
});

test('cloud explanation projects only the facts used for the reviewed decision', async () => {
  const { explanationFacts } = await import('./cloud-explanation.mjs');
  const graph = createMoveGraph();
  const report = graph.findConflicts();
  assert.deepEqual(explanationFacts('Unloading must finish by 12:00 every Saturday.', report), {
    rule:{type:'unloading_deadline',weekday:'Saturday',finishBy:'12:00'},
    booking:{weekday:'Saturday',unloadingEnds:'13:30'},
  });
  assert.deepEqual(explanationFacts('Management cancelled the freight elevator reservation for the Saturday booking for this move.',report), {
    rule:{type:'freight_elevator',reservation:'cancelled'},
    booking:{date:'2026-12-05',unloadingStarts:'11:30',unloadingEnds:'13:30'},
  });
});
