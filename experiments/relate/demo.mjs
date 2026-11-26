import { post } from '/move-api.mjs';
import { renderMoveRulesCard } from '/move-rules-card.mjs';
import { EXCEPTION_EMAIL } from '/move-fixtures.mjs';

import { extractMail, explainWithGemini } from '/local-mail.js';
import { readUpdate } from '/source-rules.mjs';

const panel = document.getElementById('connected-move') || document;
const element = (id) => panel.querySelector('#' + id);
const results = element('results');
const labels = {
  conflict: 'Conflict',
  pending: 'Action needed',
  satisfied: 'Satisfied',
  unknown: 'Needs confirmation',
};
const statusOrder = ['conflict', 'pending', 'unknown', 'satisfied'];
const friday = ['friday-a', 'friday-b'];
const current = 'current';
const history = [];
let proposal;
let lastAgent;
let markSites = () => {};
let onConfirmed = () => {};
const dateLabel = date => new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
}).format(new Date(date + 'T00:00:00Z'));
const sourceNames = { S02: 'Mover booking', S03: 'Building move-in policy', S05: 'Key-return agreement', S10: 'Cleaning appointment', S11: 'Utility notice' };

function addText(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

function renderReport(report, compact = false) {
  const card = document.createElement('article');
  addText(card, 'h3', report.label || (report.booking?.date && dateLabel(report.booking.date)) || 'Schedule and requirements');
  if (report.incrementalCost != null) {
    const amount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: report.currency || 'USD',
    }).format(report.incrementalCost);
    addText(card, 'p', 'Known additional cost ' + amount);
  }
  if (report.unknownFees?.length) addText(card, 'p', 'Unknown fees · ' + report.unknownFees.join(', '));
  if (report.incrementalCost > 0 && report.id) {
    const button = addText(card, 'button', 'Preview inquiry');
    button.type = 'button';
    button.className = 'secondary';
    const draft = addText(card, 'p', '');
    button.onclick = () => {
      draft.textContent = 'Could you confirm the quoted December 4 loading and unloading windows and any additional charges? I am checking building and installation arrangements before booking.';
    };
  }
  const checksPanel = compact ? document.createElement('details') : card;
  if (compact) {
    const blocked = report.checks.filter(check => check.status === 'conflict');
    const pending = report.checks.filter(check => ['pending', 'unknown'].includes(check.status));
    if (blocked.length) addText(card, 'p', 'Conflicts · ' + blocked.map(check => check.label).join(', ')).dataset.status = 'conflict';
    if (pending.length) addText(card, 'p', 'Still needed · ' + pending.map(check => check.label).join(', ')).dataset.status = 'pending';
    addText(checksPanel, 'summary', 'View requirements and evidence');
    card.append(checksPanel);
  }
  const checks = [...(report.checks || [])].sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
  for (const check of checks) {
    const item = document.createElement('section');
    item.className = 'check';
    checksPanel.append(item);
    const heading = addText(item, 'p', [labels[check.status], check.label].filter(Boolean).join(' · '));
    heading.dataset.status = check.status;
    if (check.detail) addText(item, 'p', check.detail);
    if (check.deadlineLocal) addText(item, 'p', 'Apply by ' + check.deadlineLocal + ' Pacific time');
    if (check.path?.length) {
      const path = document.createElement('details');
      addText(path, 'summary', 'Relationship path');
      const chain = addText(path, 'p', '');
      chain.className = 'chain';
      const labelOf = id => id === 'move' ? 'Move date' : report.checks.find(other => other.id === id)?.label || id;
      check.path.slice(1).forEach((id, index) => {
        const relation = check.relations?.[index];
        if (index) addText(chain, 'span', relation === 'ANCHORED_TO' ? '← ANCHORED_TO' : (relation || '') + ' →');
        addText(chain, 'b', labelOf(id));
      });
      if (check.blockedBy?.length) addText(path, 'p', 'Held up by · ' + check.blockedBy.map(labelOf).join(', ')).className = 'path-sources';
      const sources = addText(path, 'p', 'Evidence · ' +
        (check.evidence || []).map(({ id }) => sourceNames[id] || id).join(' + '));
      sources.className = 'path-sources';
      if (check.id === 'unloading' && check.status === 'conflict') path.open = true;
      item.append(path);
    }
    if (check.evidence?.length) {
      const evidence = document.createElement('details');
      addText(evidence, 'summary', 'Source excerpts');
      const rows = document.createElement('div');
      rows.innerHTML = renderMoveRulesCard(check.id, {
        rows: check.evidence.map(({ id, quote }) => ({ label: sourceNames[id] || 'Supporting document', value: id, src: quote })),
      }, true);
      evidence.append(rows);
      item.append(evidence);
    }
  }
  return card;
}

// Graph view: the whole Relate store, laid out by role. Requirements that
// depend on each other sit on one row so a DEPENDS_ON chain reads left to right.
const SVG = 'http://www.w3.org/2000/svg';
const ROW = 40;
const COLUMNS = { a:[8,88], b:[108,176], c:[304,152] };
const REQUIREMENT_ROWS = { access:0, unloading:1, parking:2, internet:3, elevator:4, keys:6, coi:4, cleaning:6, power:7 };
const DEPENDENT = new Set(['coi','cleaning','power']);
const BOOKING_ROWS = { current:2, 'friday-a':3, 'friday-b':4 };
let graphView;

function svg(parent, tag, attributes = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  parent.append(node);
  return node;
}

function layout({ nodes, edges }) {
  const placed = new Map();
  const taken = new Set();
  const put = (node, column, row, label, width = COLUMNS[column][1]) => {
    taken.add(column + row);
    placed.set(node.key, { ...node, label, x:COLUMNS[column][0], y:8 + row * ROW, w:width, h:28 });
  };
  const sources = [];
  for (const node of nodes) {
    const { id } = node.props;
    if (node.type === 'Move') put(node, 'a', 0, 'Move');
    else if (node.type === 'Task') put(node, 'a', 1, 'Move date');
    else if (node.type === 'Booking') put(node, 'a', BOOKING_ROWS[id] ?? 5, node.props.label.slice(0, 3) + ' · ' + node.props.providerId);
    else if (node.type === 'Requirement') put(node, DEPENDENT.has(id) ? 'c' : 'b', REQUIREMENT_ROWS[id] ?? 8, node.props.label);
    else if (node.type === 'Source') sources.push(node);
  }
  const extras = { Exception:[1,2,3], Approval:[5,2,3], ElevatorUpdate:[2,3,0] };
  for (const node of nodes.filter(node => Object.hasOwn(extras, node.type))) {
    const row = [...extras[node.type], 0, 1, 2, 3, 5, 8, 9].find(row => !taken.has('c' + row)) ?? 9;
    const label = node.type === 'Exception' ? 'Exception · Dec ' + Number(node.props.date.slice(8))
      : node.type === 'Approval' ? 'COI ' + (node.props.accepted ? 'accepted' : 'declined') + ' · ' + node.props.providerId
      : 'Elevator · ' + node.props.state;
    put(node, 'c', row, label);
  }
  const rows = Math.max(...[...placed.values()].map(node => (node.y - 8) / ROW)) + 1;
  const step = (rows * ROW - 12) / Math.max(sources.length - 1, 1);
  sources.forEach((node, index) => {
    placed.set(node.key, { ...node, label:/^S\d\d$/.test(node.props.id) ? node.props.id : 'Reply', x:482, y:14 + index * step, w:16, h:16, dot:true });
  });
  return { placed, edges, height:Math.max(rows * ROW, 14 + sources.length * step) + 8 };
}

function edgePath(from, to) {
  if (Math.abs(from.x - to.x) < 4) {
    const [top, bottom] = from.y < to.y ? [from, to] : [to, from];
    return `M${top.x + top.w / 2} ${top.y + top.h} L${bottom.x + bottom.w / 2} ${bottom.y}`;
  }
  const [left, right] = from.x < to.x ? [from, to] : [to, from];
  const x1 = left.x + left.w, y1 = left.y + left.h / 2, x2 = right.x, y2 = right.y + right.h / 2;
  const bend = (x2 - x1) / 2;
  return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
}

function drawGraph() {
  const figure = element('graph');
  const { placed, edges, height } = layout(graphView);
  figure.replaceChildren();
  const canvas = svg(figure, 'svg', { viewBox:`0 0 548 ${height}`, role:'img', 'aria-label':'Move graph stored in Relate' });
  const lines = svg(canvas, 'g');
  for (const edge of edges) {
    const from = placed.get(edge.from), to = placed.get(edge.to);
    if (!from || !to) continue;
    const line = svg(lines, 'path', { d:edgePath(from, to), class:'edge', 'data-type':edge.type });
    line.dataset.from = edge.from;
    line.dataset.to = edge.to;
  }
  for (const node of placed.values()) {
    const group = svg(canvas, 'g', { class:'node', 'data-key':node.key, 'data-type':node.type });
    if (node.dot) svg(group, 'circle', { cx:node.x + 8, cy:node.y + 8, r:8 });
    else svg(group, 'rect', { x:node.x, y:node.y, width:node.w, height:node.h, rx:6 });
    const text = svg(group, 'text', node.dot
      ? { x:node.x + 22, y:node.y + 12 }
      : { x:node.x + 8, y:node.y + 18 });
    text.textContent = node.label;
  }
  const caption = element('graph-caption');
  caption.textContent = `Relate graph · ${graphView.nodes.length} nodes · ${graphView.edges.length} relationships · path query MATCH p=(:Move)-[:HAS_TASK]->(:Task)<-[:ANCHORED_TO]-(r:Requirement)-[:DEPENDS_ON*0..4]->()`;
}

async function refreshGraph() {
  graphView = await post('graph');
  drawGraph();
}

// Colour requirements by verdict and light up each conflict's path and evidence.
function highlight({ checks = [], bookings = [], fresh = [], date } = {}) {
  const figure = element('graph');
  const keyOf = new Map(graphView.nodes.map(node => [node.props.id, node.key]));
  const nodeOf = key => figure.querySelector(`.node[data-key="${key}"]`);
  const edgeOf = (from, to) => figure.querySelector(`.edge[data-from="${from}"][data-to="${to}"]`);
  const light = (target, step) => {
    if (!target) return;
    target.style.transitionDelay = step * 180 + 'ms';
    target.classList.add('hot');
  };
  figure.querySelectorAll('.hot').forEach(target => { target.classList.remove('hot', 'fresh'); target.style.transitionDelay = ''; });
  figure.querySelectorAll('.node[data-status]').forEach(node => delete node.dataset.status);
  for (const check of checks) {
    const node = nodeOf(keyOf.get(check.id));
    if (node) node.dataset.status = check.status;
  }
  // The task node shows which date the verdicts are for.
  nodeOf(keyOf.get('move')).querySelector('text').textContent = date
    ? 'Dec ' + Number(date.slice(8)) : 'Move date';
  for (const key of fresh) {
    nodeOf(key)?.classList.add('hot', 'fresh');
    figure.querySelectorAll(`.edge[data-from="${key}"],.edge[data-to="${key}"]`).forEach(edge => edge.classList.add('hot', 'fresh'));
  }
  const task = keyOf.get('move');
  for (const id of bookings) {
    light(nodeOf(keyOf.get(id)), 0);
    light(edgeOf(task, keyOf.get(id)), 0);
  }
  for (const check of checks.filter(check => check.status === 'conflict' && check.path)) {
    const keys = check.path.map(id => keyOf.get(id));
    light(nodeOf(keys[0]), 0);
    light(edgeOf(keys[0], keys[1]), 1);
    light(nodeOf(keys[1]), 1);
    for (let index = 2; index < keys.length; index++) {
      light(edgeOf(keys[index], index === 2 ? keys[1] : keys[index - 1]) || edgeOf(keys[index - 1], keys[index]), index);
      light(nodeOf(keys[index]), index);
    }
    // Evidence can hang off the requirement, a prerequisite or the booking.
    const near = new Set([...keys, ...bookings.map(id => keyOf.get(id))].map(String));
    for (const { id } of check.evidence || []) {
      const source = keyOf.get(id);
      light(nodeOf(source), keys.length);
      figure.querySelectorAll(`.edge[data-to="${source}"]`).forEach(edge => {
        if (near.has(edge.dataset.from)) light(edge, keys.length);
      });
    }
  }
  markSites(checks);
}

function showReport(report, booking) {
  results.replaceChildren(renderReport(report));
  highlight({ checks:report.checks, bookings:report.booking?.id ? [report.booking.id] : [], date:report.booking?.date });
  if (booking) {
    const date = typeof report.booking === 'string' ? report.booking : report.booking?.date;
    element('booking').textContent = date ? 'Current booking · ' + dateLabel(date) : '';
  }
}

function perform(action, status = 'Checking move…') {
  return async (event) => {
    event?.preventDefault();
    const buttons = [...panel.querySelectorAll('button:enabled')];
    buttons.forEach(button => { button.disabled = true; });
    element('notice').textContent = status;
    try {
      await action();
      element('notice').textContent = '';
    } catch (error) {
      element('notice').textContent = error.message;
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  };
}

const loadCurrent = () => post('conflicts', { scenario: current }).then(report => showReport(report, true));
element('current').onclick = perform(loadCurrent);
element('monday').onclick = perform(async () => {
  const report = await post('conflicts', { scenario: 'dateOnly', date: '2026-12-07' });
  showReport(report);
  const graph = document.createElement('div');
  graph.className = 'impact';
  addText(graph, 'strong', dateLabel(report.booking.date));
  for (const check of report.checks.filter(check => check.status === 'conflict')) {
    addText(graph, 'p', '↳ ' + check.label).dataset.status = check.status;
  }
  results.prepend(graph);
});
element('compare').onclick = perform(async () => showComparison(await post('compare', { optionIds: friday })));
function showComparison(response) {
  results.replaceChildren(...response.options.map(option => renderReport(option, true)));
  // Show the worse verdict of the two options on each requirement.
  const worst = new Map();
  for (const check of response.options.flatMap(option => option.checks)) {
    const seen = worst.get(check.id);
    if (!seen || statusOrder.indexOf(check.status) < statusOrder.indexOf(seen.status)) worst.set(check.id, check);
  }
  highlight({ checks:[...worst.values()], bookings:response.options.map(option => option.id), date:response.options[0].date });
}
element('ask').onsubmit = perform(async () => {
  element('answer').textContent = '';
  const question = element('question').value;
  const response = await post('agent', { question, history });
  lastAgent = response;
  const answer = element('answer');
  for (const [index, part] of response.answer.split('**').entries()) {
    addText(answer, index % 2 ? 'strong' : 'span', part);
  }
  history.push({ role: 'user', content: question }, { role: 'assistant', content: response.answer });
  const report = response.tools?.findLast(({ result }) => Array.isArray(result?.checks))?.result;
  if (report) showReport(report);
  const comparison = response.tools?.findLast(({ result }) => Array.isArray(result?.options))?.result;
  if (comparison) showComparison(comparison);
  const candidate = response.tools?.findLast(({ result }) => result?.status === 'prepared')?.result;
  if (candidate) {
    element('source').closest('details').open = true;
    element('reply').value = candidate.text;
    showProposal(candidate);
  }
}, 'Waiting for agent…');

function clearProposal() {
  proposal = undefined;
  element('proposal').textContent = '';
  element('confirm').hidden = true;
}

function showProposal(candidate) {
  proposal = candidate;
  if (proposal.status === 'prepared') {
    element('proposal').textContent = proposal.reviewed ? proposal.reviewed.statement + ' — “' + proposal.quote + '”' : proposal.quote;
    element('confirm').hidden = false;
  } else {
    element('proposal').textContent = proposal.detail || 'This reply is already in the move record.';
  }
}

element('reply').oninput = clearProposal;
element('sample-reply').onclick = () => {
  clearProposal();
  element('reply').value = EXCEPTION_EMAIL;
};
element('source').onsubmit = perform(async () => {
  clearProposal();
  const text = element('reply').value;
  const baseVersion = graphView.nodes.find(node => node.type === 'Move').props.version;
  const exact = text.trim();
  const extracted = readUpdate(exact) ? { statement:exact, quote:exact }
    : await extractMail(text);
  const candidate = extracted ? { status:'prepared', quote:extracted.quote, reviewed:{ ...extracted, baseVersion } }
    : { detail:'No single supported rule with an exact source quote could be verified. Review the wording.' };
  if (element('reply').value === text) showProposal(candidate);
});
element('confirm').onclick = perform(async () => {
  if (!proposal) return;
  const response = await post('source/commit', proposal.reviewed ? { reviewed:proposal.reviewed, explain:true } : { candidateId:proposal.candidateId });
  clearProposal();
  const known = new Set(graphView.nodes.map(node => node.key));
  await refreshGraph();
  if (response.after) {
    showReport(response.after, true);
    highlight({ checks:response.after.checks, bookings:[response.after.booking.id], date:response.after.booking.date, fresh:graphView.nodes.filter(node => !known.has(node.key)).map(node => node.key) });
    const elevator = response.after.checks.find(check => check.id === 'elevator');
    const summary = document.createElement('article');
    const facts = response.cloud?.facts;
    const liftConfirmed = facts?.rule.type === 'freight_elevator' && facts.rule.reservation === 'confirmed';
    if (liftConfirmed) {
      const slot = facts.booking;
      addText(summary, 'p', `Property confirmed the freight elevator · ${dateLabel(slot.date)}, ${slot.unloadingStarts}–${slot.unloadingEnds}`).dataset.status = 'satisfied';
      for (const check of response.after.checks.filter(c => c.status === 'conflict' && c.id.startsWith('cutoff-'))) {
        addText(summary, 'p', 'Current plan conflict (Relate) · ' + check.detail).dataset.status = 'conflict';
      }
    }
    for (const check of response.changes) {
      if (liftConfirmed && check.id === 'elevator') continue;
      const before = response.before.checks.find(old => old.id === check.id);
      if (before) addText(summary, 'p', 'Before · ' + check.label + ' · ' + labels[before.status]).dataset.status = before.status;
      addText(summary, 'p', 'After · ' + check.label + ' · ' + labels[check.status]).dataset.status = check.status;
    }
    if (elevator?.status === 'pending') addText(summary, 'p', 'Still needed · Freight elevator reservation').dataset.status = 'pending';
    if (summary.childNodes.length) results.prepend(summary);
    if (response.cloud) {
      const explanation = document.createElement(liftConfirmed ? 'details' : 'section');
      addText(explanation, liftConfirmed ? 'summary' : 'h3', 'Gemini explanation of this property decision');
      summary.append(explanation);
      try {
        addText(explanation, 'p', await explainWithGemini(response.cloud.facts));
      } catch (error) {
        addText(explanation, 'p', 'Saved locally. Gemini explanation unavailable. ' + error.message);
      }
      const disclosure = document.createElement('details');
      addText(disclosure, 'summary', 'Fields prepared for Gemini');
      addText(disclosure, 'pre', JSON.stringify(response.cloud.facts, null, 2));
      summary.append(disclosure);
    }
    if (!summary.isConnected && summary.childNodes.length) results.prepend(summary);
    onConfirmed(summary, response);
    element('source').closest('details').open = false;
    (panel === document ? window : panel).scrollTo(0, 0);
  }
  else await loadCurrent();
});
element('reset').onclick = perform(async () => {
  await post('reset');
  clearProposal();
  history.length = 0;
  element('answer').textContent = '';
  element('reply').value = '';
  await refreshGraph();
  showBooked();
});

function showBooked() {
  element('booking').textContent = 'Current booking · Saturday, Dec 5';
  results.replaceChildren();
  addText(results, 'article', 'Mover A is booked. Check the plan to see whether the building and other arrangements line up.');
  if (graphView) highlight({ bookings:['current'] });
}
refreshGraph().finally(showBooked);

if (panel !== document) {
  // Embedded in the Put Roots map: the conversation on the left drives the
  // check, the map shows the two homes, and the graph panel opens once the
  // agent has answered.
  const question = document.getElementById('q');
  const send = document.getElementById('send');
  const log = document.getElementById('log');
  const ICONS = {
    house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  };
  // Sample locations; the case itself has no street addresses.
  const SITES = [
    { name:'Old apartment', area:'Inner Sunset', at:[37.7614, -122.4664], icon:'house', checks:['keys', 'cleaning', 'power'] },
    { name:'New apartment', area:'Mission Bay', at:[37.7706, -122.3925], icon:'building', flip:true, checks:['access', 'unloading', 'elevator', 'internet', 'parking', 'coi'] },
  ];
  const COLORS = { conflict:'#B3402E', pending:'#B97F24', unknown:'#B97F24', satisfied:'#3E7C4F' };
  const map = window.map;
  const L = window.L;
  let markers;
  const frame = () => map.flyToBounds(SITES.map(site => site.at), { paddingTopLeft:[80, 600], paddingBottomRight:[740, 90], duration:1.6 });
  const showMove = () => {
    if (markers || !map || !L) return;
    markers = SITES.map(site => {
      const icon = L.divIcon({ className:'', iconSize:null, html:
        `<div class="move-site${site.flip ? ' flip' : ''}"><span class="pin"><svg viewBox="0 0 24 24">${ICONS[site.icon]}</svg></span>` +
        `<span class="tag">${site.name} · ${site.area}<small></small></span></div>` });
      return L.marker(site.at, { icon, interactive:false }).addTo(map);
    });
    L.polyline(SITES.map(site => site.at), { color:'#1F6FB5', weight:3, dashArray:'6 8', opacity:.8 }).addTo(map);
    frame();
  };
  markSites = checks => {
    if (!markers) return;
    SITES.forEach((site, index) => {
      const mine = checks.filter(check => site.checks.includes(check.id));
      const worst = mine.sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status))[0];
      const root = markers[index].getElement()?.querySelector('.move-site');
      if (!root) return;
      root.style.setProperty('--site', worst && worst.status !== 'satisfied' ? COLORS[worst.status] : mine.length ? COLORS.satisfied : '#1F6FB5');
      const blocked = mine.filter(check => check.status !== 'satisfied');
      root.querySelector('small').textContent = !mine.length ? '' : blocked.length
        ? blocked.map(check => check.label).slice(0, 2).join(' · ')
        : 'All set';
    });
  };
  const receipt = tools => {
    const steps = (tools || []).map(({ name, input, result }) => {
      const scenario = input?.date || input?.optionId || input?.scenario || (input?.optionIds || []).join('+');
      const outcome = Array.isArray(result?.checks) ? (n => n + (n === 1 ? ' conflict' : ' conflicts'))(result.checks.filter(check => check.status === 'conflict').length)
        : Array.isArray(result?.options) ? result.options.length + ' options'
        : result?.status || '';
      return [name, scenario, outcome].filter(Boolean).join(' ');
    });
    return steps.length ? 'Relate · ' + steps.join(' → ') : '';
  };
  const agentBubble = text => {
    const message = addText(log, 'div', '');
    message.className = 'msg a';
    const bubble = addText(message, 'div', text);
    bubble.className = 'b';
    return bubble;
  };
  const submit = event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = question.value.trim();
    if (!text || element('ask').querySelector('button').disabled) return;
    window.__started = true;
    if (typeof window.addUser === 'function') window.addUser(text);
    if (typeof window.updateOnb === 'function') window.updateOnb();
    question.value = '';
    question.dispatchEvent(new Event('input', { bubbles: true }));
    showMove();
    const bubble = agentBubble('Checking your move against the Relate graph…');
    const answer = element('answer');
    const notice = element('notice');
    lastAgent = undefined;
    const observer = new MutationObserver(() => {
      if (answer.textContent || !notice.textContent) {
        bubble.replaceChildren(...Array.from(answer.childNodes, node => node.cloneNode(true)));
        if (!bubble.textContent) bubble.textContent = notice.textContent || 'No answer returned. Try again.';
        const line = receipt(lastAgent?.tools);
        if (line) addText(bubble, 'span', line).className = 'relate-receipt';
        panel.classList.remove('waiting');
        if (markers) frame();
        log.scrollTop = log.scrollHeight;
        observer.disconnect();
      }
    });
    observer.observe(answer, { childList: true });
    observer.observe(notice, { childList: true });
    element('question').value = text;
    element('ask').requestSubmit();
    log.scrollTop = log.scrollHeight;
  };
  onConfirmed = (summary, response) => {
    const bubble = agentBubble(['Saved the building’s reply to the move record.', ...Array.from(summary.childNodes, node => node.textContent)].join('\n'));
    addText(bubble, 'span', `Relate · commit case v${response.caseVersion} · ${response.changes.length} verdict changed`).className = 'relate-receipt';
    log.scrollTop = log.scrollHeight;
  };
  send.addEventListener('click', submit, true);
  question.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) submit(event);
  }, true);
}
