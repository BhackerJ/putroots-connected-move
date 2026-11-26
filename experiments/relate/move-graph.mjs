import { openStore, digest } from './graph-store.mjs';
import { BOOKINGS, REQUIREMENTS, SAMPLE_NOW, SOURCES } from './move-fixtures.mjs';

import { TZ, localTime, timestamp, isDate, readUpdate } from './source-rules.mjs';

// Each requirement is judged inside Relate. The query returns one verdict code
// per requirement; JavaScript only words the verdict and does the time-zone
// arithmetic for lead-time deadlines.
const VERDICTS = `MATCH (:Move {id:"sample"})-[:HAS_TASK]->(:Task)<-[:ANCHORED_TO]-(r:Requirement)
  OPTIONAL MATCH (x:Exception {date:$date})-[:EXCEPTION_TO]->(r)
  WITH r, x ORDER BY x.version DESC
  WITH r, x.start + '-' + x.end AS slot, collect(x)[0] AS latest
  WITH r, [e IN collect(latest) WHERE e IS NOT NULL AND e.active <> false] AS exceptions
  OPTIONAL MATCH (r)-[:HAS_APPROVAL]->(a:Approval {providerId:$providerId})
  WITH r, exceptions, a ORDER BY a.version DESC
  WITH r, exceptions, collect(a)[0] AS approval
  OPTIONAL MATCH (r)-[:SUPPORTED_BY]->(w:Source {id:"S12"})
  WITH r, exceptions, approval, count(w) > 0 AS attendanceStated, date($date).dayOfWeek >= 6 AS weekend
  RETURN r.id AS id, CASE
    WHEN r.kind = 'cutoff' THEN CASE
      WHEN date($date).dayOfWeek <> r.day THEN 'other_day'
      WHEN $unloadEnd IS NULL THEN 'unknown'
      WHEN $unloadEnd > r.end THEN 'late' ELSE 'ok' END
    WHEN r.kind = 'access' THEN CASE
      WHEN $date < r.date THEN 'conflict'
      WHEN $date > r.date OR ($unloadStart IS NOT NULL AND $unloadStart >= r.start) THEN 'ok'
      ELSE 'unknown' END
    WHEN r.kind = 'window' THEN CASE
      WHEN $unloadStart IS NOT NULL AND $unloadEnd IS NOT NULL
        AND any(e IN exceptions WHERE $unloadStart >= e.start AND $unloadEnd <= e.end) THEN 'exception'
      WHEN weekend AND size(exceptions) > 0 AND ($unloadStart IS NULL OR $unloadEnd IS NULL) THEN 'exception_unknown'
      WHEN weekend THEN 'weekend'
      WHEN $unloadStart IS NULL OR $unloadEnd IS NULL THEN 'unknown'
      WHEN $unloadStart >= r.start AND $unloadEnd <= r.end THEN 'ok'
      ELSE 'outside' END
    WHEN r.kind IN ['deadline','power_during_loading'] THEN CASE
      WHEN $date > r.date OR ($date = r.date AND $loadEnd IS NOT NULL AND $loadEnd > r.end) THEN 'late'
      WHEN $date = r.date AND $loadEnd IS NULL THEN 'unknown'
      ELSE 'ok' END
    WHEN r.kind = 'after_move' THEN CASE
      WHEN $date > r.date OR ($date = r.date AND $loadEnd IS NOT NULL AND $loadEnd > r.start) THEN 'late'
      WHEN $date = r.date AND $loadEnd IS NULL THEN 'unknown'
      ELSE 'ok' END
    WHEN r.kind = 'same_day' THEN CASE WHEN $date = r.date THEN 'ok' ELSE 'lead_time' END
    WHEN r.kind = 'lead_hours' THEN 'lead_time'
    WHEN r.kind = 'approval' THEN CASE
      WHEN $providerId IS NULL THEN 'unknown'
      WHEN approval.accepted = true THEN 'ok'
      ELSE 'pending' END
    WHEN r.kind = 'no_overlap' THEN CASE
      WHEN $date <> r.date THEN 'other_day'
      WHEN $loadStart IS NULL OR $loadEnd IS NULL OR $participantId IS NULL OR $loadLocation IS NULL
        OR r.participantId IS NULL OR r.locationId IS NULL OR NOT attendanceStated THEN 'unknown'
      WHEN $participantId = r.participantId AND $loadLocation <> r.locationId
        AND $loadStart < r.end AND r.start < $loadEnd THEN 'overlap'
      ELSE 'ok' END
    ELSE 'review' END AS verdict`;

// The path shown for a check is the longest one Relate finds from the move,
// through the requirement, along its DEPENDS_ON chain.
const PATHS = `MATCH p=(:Move {id:"sample"})-[:HAS_TASK]->(:Task)<-[:ANCHORED_TO]-(r:Requirement)-[:DEPENDS_ON*0..4]->(:Requirement)
  RETURN r.id AS id, [n IN nodes(p) | n.id] AS path, [x IN relationships(p) | type(x)] AS relations, length(p) AS hops
  ORDER BY hops DESC`;

export function createMoveGraph(path = ':memory:', { extended = true } = {}) {
  const connection = openStore(path);
  const query = (statement, parameters) => connection.query(statement, parameters).rows;
  const one = (statement, parameters) => query(statement, parameters)[0];
  const pending = new Map();
  const version = () => Number(one('MATCH (m:Move {id:"sample"}) RETURN m.version AS version').version);

  function transact(action) {
    connection.begin();
    try {
      const value = action();
      connection.commit();
      return value;
    } catch (error) {
      connection.rollback();
      throw error;
    }
  }

  function seed(caseVersion = 1) {
    query('CREATE (:Move {id:"sample",version:$caseVersion,timezone:$zone,bookingId:"current"})-[:HAS_TASK]->(:Task {id:"move"})', { zone: TZ, caseVersion });
    for (const [id, quote] of Object.entries(SOURCES)) {
      query('CREATE (:Source {id:$id,quote:$quote})', { id, quote });
    }
    for (const booking of BOOKINGS) {
      query(`MATCH (t:Task {id:"move"}),(s:Source {id:$source})
        CREATE (t)-[:HAS_BOOKING]->(b:Booking {id:$id,label:$label,providerId:$providerId,date:$date,
          loadStart:$loadStart,loadEnd:$loadEnd,unloadStart:$unloadStart,unloadEnd:$unloadEnd,
          incrementalCost:$incrementalCost,status:$status,participantId:"resident",loadLocation:"old-home"})
          -[:SUPPORTED_BY]->(s)`,
      { ...booking, incrementalCost:booking.incrementalCost ?? 0, status:booking.id === 'current' ? 'accepted' : 'option' });
    }
    for (const { sources, ...requirement } of REQUIREMENTS) {
      if (!extended && ['cleaning','power'].includes(requirement.id)) continue;
      query(`MATCH (t:Task {id:"move"})
        CREATE (r:Requirement {id:$id,label:$label,kind:$kind,date:$date,start:$start,end:$end,
          hours:$hours,providerId:$providerId,participantId:$participantId,locationId:$locationId})
          -[:ANCHORED_TO]->(t)`,
      { date:null,start:null,end:null,hours:null,providerId:null,participantId:null,locationId:null,...requirement });
      for (const source of sources) {
        query(`MATCH (r:Requirement {id:$id}),(s:Source {id:$source}) CREATE (r)-[:SUPPORTED_BY]->(s)`,
          { id:requirement.id, source });
      }
    }
    query(`MATCH (e:Requirement {id:"elevator"}),(c:Requirement {id:"coi"}),(s:Source {id:"S04"})
      CREATE (e)-[:DEPENDS_ON]->(c)
      CREATE (c)-[:HAS_APPROVAL]->(:Approval {providerId:"A",accepted:true,version:0})-[:SUPPORTED_BY]->(s)`);
    // Keys go back after cleaning (S05); the cleaners need power (S10).
    query(`MATCH (k:Requirement {id:"keys"}),(c:Requirement {id:"cleaning"}),(p:Requirement {id:"power"})
      CREATE (k)-[:DEPENDS_ON]->(c)-[:DEPENDS_ON]->(p)`);
  }

  if (!one('MATCH (m:Move {id:"sample"}) RETURN m.id AS id')) transact(seed);

  const evidence = record => ({ id:record.id, quote:record.quote });
  function findConflicts(input = {}) {
    const { scenario = 'current', optionId, date, asOf = SAMPLE_NOW } = input;
    if (input.moveId && input.moveId !== 'sample') throw new Error('Unknown move');
    const now = Date.parse(asOf);
    if (!Number.isFinite(now)) throw new Error('Invalid case time');
    if (!['current','optionId','dateOnly'].includes(scenario)) throw new Error('Unknown scenario');
    if (scenario === 'dateOnly' && !isDate(date)) {
      throw new Error('Provide a valid date in YYYY-MM-DD format');
    }
    const caseVersion = version();
    if (input.caseVersion !== undefined && input.caseVersion !== caseVersion) throw new Error('Case changed. Refresh and retry.');
    const selected = scenario === 'dateOnly' ? undefined : one(`MATCH (m:Move {id:"sample"})-[:HAS_TASK]->(:Task)-[:HAS_BOOKING]->(b:Booking)-[:SUPPORTED_BY]->(s:Source)
      WHERE ($option IS NULL AND b.id = m.bookingId) OR b.id = $option
      RETURN properties(b) AS booking, collect(properties(s)) AS sources`, { option:scenario === 'current' ? null : optionId ?? '' });
    if (scenario !== 'dateOnly' && !selected) throw new Error('Unknown booking option');
    const booking = selected?.booking ?? { date, label:date };
    const rows = query(`MATCH (:Move {id:"sample"})-[:HAS_TASK]->(t:Task)<-[:ANCHORED_TO]-(r:Requirement)-[:SUPPORTED_BY]->(s:Source)
      OPTIONAL MATCH (r)-[:DEPENDS_ON]->(p:Requirement)-[:SUPPORTED_BY]->(ps:Source)
      OPTIONAL MATCH (x:Exception {date:$date})-[:EXCEPTION_TO]->(r)
      OPTIONAL MATCH (x)-[:SUPPORTED_BY]->(xs:Source)
      RETURN properties(r) AS rule, collect(DISTINCT properties(s)) AS sources,
        collect(DISTINCT properties(p)) AS prerequisites, collect(DISTINCT properties(ps)) AS prerequisiteSources,
        collect(DISTINCT properties(x)) AS exceptions, collect(DISTINCT properties(xs)) AS exceptionSources
      ORDER BY rule.id`, { date:booking.date });
    const approvals = booking.providerId ? query(`MATCH (:Move {id:"sample"})-[:HAS_TASK]->(:Task)<-[:ANCHORED_TO]-(:Requirement {id:"coi"})-[:HAS_APPROVAL]->(a:Approval {providerId:$providerId})-[:SUPPORTED_BY]->(s:Source)
      RETURN properties(a) AS approval, properties(s) AS source, a.version AS version ORDER BY version DESC`, { providerId:booking.providerId }) : [];
    const latestApproval = approvals[0];
    const accepted = latestApproval?.approval.accepted ?? false;
    const elevatorRecords = booking.id ? query(`MATCH (:Booking {id:$bookingId})-[:HAS_ELEVATOR_UPDATE]->(e:ElevatorUpdate)-[:SUPPORTED_BY]->(s:Source)
      RETURN e.state AS state, properties(s) AS source, e.version AS version ORDER BY version DESC`, { bookingId:booking.id }) : [];
    const elevator = elevatorRecords[0];
    const verdicts = new Map(query(VERDICTS, {
      date:booking.date, providerId:booking.providerId ?? null,
      loadStart:booking.loadStart ?? null, loadEnd:booking.loadEnd ?? null,
      unloadStart:booking.unloadStart ?? null, unloadEnd:booking.unloadEnd ?? null,
      participantId:booking.participantId ?? null, loadLocation:booking.loadLocation ?? null,
    }).map(row => [row.id,row.verdict]));
    const paths = new Map();
    for (const row of query(PATHS)) if (!paths.has(row.id)) paths.set(row.id,row);
    const checks = rows.map(row => {
      const { rule, sources, prerequisites, prerequisiteSources, exceptionSources } = row;
      const evaluated = assess(rule, verdicts.get(rule.id), booking, now, prerequisites.filter(Boolean), accepted, elevator?.state);
      const approvalEvidence = rule.kind === 'approval' || prerequisites.some(item => item?.kind === 'approval')
        ? latestApproval?.source : undefined;
      const related = [...sources, ...prerequisiteSources, ...exceptionSources, ...(selected?.sources ?? []), approvalEvidence, rule.kind === 'lead_hours' ? elevator?.source : undefined].filter(Boolean);
      return { id:rule.id, label:rule.label, ...evaluated,
        path:paths.get(rule.id).path, relations:paths.get(rule.id).relations,
        evidence:[...new Map(related.map(item => [item.id,evidence(item)])).values()] };
    });
    // A requirement is held up by anything unsettled further along its chain.
    const statusOf = new Map(checks.map(item => [item.id,item.status]));
    for (const item of checks) {
      const upstream = item.path.slice(3).filter(id => statusOf.get(id) !== 'satisfied');
      if (upstream.length) item.blockedBy = upstream;
    }
    if (scenario === 'current' && booking.status === 'cancelled') {
      checks.push({ id:'booking-cancelled', label:'Mover booking', status:'conflict',
        detail:'The current mover booking was cancelled. A replacement is still needed.',
        path:['sample','move',booking.id], evidence:selected.sources.map(evidence) });
    }
    if (scenario === 'current') {
      const duplicateBookings = query(`MATCH (m:Move {id:"sample"})-[:HAS_TASK]->(:Task)-[:HAS_BOOKING]->(b:Booking)-[:SUPPORTED_BY]->(s:Source)
        WHERE b.id <> m.bookingId AND b.status = 'accepted'
        RETURN b.label AS label, properties(s) AS source`);
      if (duplicateBookings.length) checks.push({
        id:'duplicate-bookings', label:'Overlapping mover commitments', status:'conflict',
        detail:'Another mover booking is still active. Confirm its cancellation.',
        path:['sample','move','duplicate-bookings'],
        evidence:[...selected.sources, ...duplicateBookings.map(row => row.source)].map(evidence),
      });
    }
    return { caseVersion, asOf, scenario, booking, checks };
  }

  function compareOptions({ optionIds = ['friday-a','friday-b'], ...input } = {}) {
    if (!Array.isArray(optionIds) || optionIds.length < 2 || optionIds.length > 3) throw new Error('Choose two or three options');
    const reports = optionIds.map(optionId => findConflicts({ ...input, scenario:'optionId', optionId }));
    return { caseVersion:reports[0].caseVersion, asOf:reports[0].asOf, options:reports.map(report => ({
      ...report.booking, checks:report.checks, currency:'USD', unknownFees:report.booking.providerId === 'B' ? ['Parking','Mover A cancellation'] : ['Parking'],
    })) };
  }

  function explain({ id, ...scenario }) {
    const report = findConflicts(scenario);
    const check = report.checks.find(item => item.id === id);
    if (!check) throw new Error('Unknown check');
    return { caseVersion:report.caseVersion, asOf:report.asOf, ...check };
  }

  function applySource(input) {
    if (input.reviewed) {
      const { statement, quote, baseVersion } = input.reviewed;
      if (typeof statement !== 'string' || typeof quote !== 'string' || !quote.trim() || !readUpdate(statement)) throw new Error('Invalid reviewed restriction.');
      const candidateId = digest(JSON.stringify([statement,quote]));
      if (!one('MATCH (s:Source {id:$id}) RETURN s.id AS id', { id:candidateId })) {
        if (baseVersion !== version()) throw new Error('Move changed. Review the email again.');
        pending.set(candidateId, { ...readUpdate(statement), candidateId, baseVersion, text:quote, quote });
      }
      return applySource({ candidateId });
    }
    if (input.text !== undefined) {
      const text = input.text.trim();
      const candidateId = digest(text);
      const existing = one('MATCH (s:Source {id:$id}) RETURN s.id AS id', { id:candidateId });
      if (existing) return { status:'committed', candidateId, caseVersion:version() };
      const update = readUpdate(text);
      if (!update) return { status:'needs_review', detail:'The statement and its scope could not be verified from this email.' };
      const candidate = { candidateId, baseVersion:version(), text, ...update };
      pending.set(candidateId, candidate);
      return { status:'prepared', ...candidate };
    }
    const { candidateId } = input;
    if (typeof candidateId !== 'string') throw new Error('Missing confirmation candidate');
    if (one('MATCH (s:Source {id:$id}) RETURN s.id AS id', { id:candidateId })) return { status:'committed', candidateId, caseVersion:version() };
    const candidate = pending.get(candidateId);
    if (!candidate || candidate.baseVersion !== version()) throw new Error('Candidate is missing or stale. Prepare it again.');
    const before = findConflicts();
    transact(() => {
      const { kind } = candidate;
      if (kind === 'cutoff') {
        query(`MATCH (t:Task {id:"move"})
          CREATE (r:Requirement {id:$ruleId,label:$label,kind:"cutoff",day:$day,end:$end})-[:ANCHORED_TO]->(t)
          CREATE (r)-[:SUPPORTED_BY]->(:Source {id:$sourceId,quote:$quote})`,
          { ...candidate, ruleId:"cutoff-" + candidate.candidateId, sourceId:candidate.candidateId, label:'Unloading deadline · ' + ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][candidate.day-1] + ' ' + candidate.end });
      } else if (kind === 'booking') {
        const { bookingId } = candidate;
        const booking = one('MATCH (b:Booking {id:$bookingId}) RETURN properties(b) AS booking', { bookingId })?.booking;
        if (!booking || booking.status !== 'option') throw new Error('Booking option is no longer available');
        if (Date.parse(SAMPLE_NOW) > timestamp('2026-12-01','17:00')) throw new Error('Booking option has expired');
        query(`MATCH (m:Move {id:"sample"}),(b:Booking {id:$bookingId}),(old:Booking)
          WHERE old.id = m.bookingId
          SET old.status = CASE WHEN old.providerId = b.providerId THEN 'superseded' ELSE old.status END,
              m.bookingId = b.id, b.status = 'accepted'
          CREATE (b)-[:SUPPORTED_BY]->(:Source {id:$candidateId,quote:$quote,text:$text})`, candidate);
      } else if (kind === 'cancel') {
        const booking = one('MATCH (b:Booking {id:"current"}) RETURN b.status AS status');
        if (booking?.status !== 'accepted') throw new Error('Original booking is no longer active');
        query(`MATCH (m:Move {id:"sample"}),(b:Booking {id:"current"})
          SET b.status = 'cancelled'
          CREATE (b)-[:SUPPORTED_BY]->(:Source {id:$candidateId,quote:$quote,text:$text})`, candidate);
      } else if (kind === 'approval') {
        query(`MATCH (m:Move {id:"sample"}),(r:Requirement {id:"coi"})
          CREATE (r)-[:HAS_APPROVAL]->(:Approval {providerId:$providerId,accepted:$accepted,version:m.version + 1})
            -[:SUPPORTED_BY]->(:Source {id:$candidateId,quote:$quote,text:$text})`, candidate);
      } else if (kind === 'elevator') {
        query(`MATCH (m:Move {id:"sample"}),(b:Booking {id:$bookingId})
          CREATE (b)-[:HAS_ELEVATOR_UPDATE]->(:ElevatorUpdate {state:$state,version:m.version + 1})
            -[:SUPPORTED_BY]->(:Source {id:$candidateId,quote:$quote,text:$text})`, candidate);
      } else {
        query(`MATCH (m:Move {id:"sample"}),(r:Requirement {id:"unloading"})
          CREATE (x:Exception {date:$date,start:$start,end:$end,active:$active,version:m.version + 1})-[:EXCEPTION_TO]->(r)
          CREATE (x)-[:SUPPORTED_BY]->(:Source {id:$candidateId,quote:$quote,text:$text})`, candidate);
      }
      query('MATCH (m:Move {id:"sample"}) SET m.version = m.version + 1');
    });
    pending.delete(candidateId);
    const after = findConflicts();
    return { status:'committed', candidateId, caseVersion:after.caseVersion, before, after,
      changes:after.checks.filter(check => before.checks.find(old => old.id === check.id)?.status !== check.status) };
  }

  function reset() {
    const nextVersion = version() + 1;
    transact(() => {
      query('MATCH (n) DETACH DELETE n');
      seed(nextVersion);
    });
    pending.clear();
    return findConflicts();
  }

  // The whole store as nodes and edges, for the graph view.
  function graphView() {
    return {
      nodes: query('MATCH (n) RETURN id(n) AS key, labels(n)[0] AS type, properties(n) AS props ORDER BY key'),
      edges: query('MATCH (a)-[r]->(b) RETURN id(a) AS from, id(b) AS to, type(r) AS type'),
    };
  }

  return { findConflicts, compareOptions, explain, applySource, reset, graphView, checkpoint() { connection.checkpoint(); } };
}

function assess(rule, verdict, booking, now, prerequisites, accepted, elevatorState) {
  const { date, unloadStart, loadStart, loadEnd, providerId } = booking;
  const status = (status, detail, extras = {}) => ({ status, detail, ...extras });
  const unknown = detail => status('unknown', detail);
  const deadline = (at, hours, action) => {
    if (at === undefined) return unknown(action + '. Confirm the start time to calculate the deadline.');
    const deadline = at - hours * 3600000;
    return status(now > deadline ? 'conflict' : 'pending',
      now > deadline ? 'The application deadline has passed.' : action,
      { deadline:new Date(deadline).toISOString(), deadlineLocal:localTime.format(deadline) });
  };
  switch (rule.kind) {
    case 'cutoff':
      if (verdict === 'other_day') return status('satisfied','This deadline applies on another day.');
      if (verdict === 'unknown') return unknown('Confirm the unloading end time.');
      if (verdict === 'late') {
        const minutes = time => Number(time.slice(0,2)) * 60 + Number(time.slice(3));
        const overrun = minutes(booking.unloadEnd) - minutes(rule.end);
        return status('conflict', `Unloading must finish by ${rule.end}. The booking ends at ${booking.unloadEnd}, ${overrun} minutes late.`);
      }
      return status('satisfied','Unloading finishes by the property deadline.');
    case 'access':
      if (verdict === 'conflict') return status('conflict','The new apartment is unavailable on this date.');
      if (verdict === 'ok') return status('satisfied','The new apartment is accessible.');
      return unknown('Confirm when unloading starts.');
    case 'window':
      return {
        exception:status('satisfied','The building approved this exact unloading window.'),
        exception_unknown:unknown('Confirm unloading times to check the exception.'),
        weekend:status('conflict','The confirmed or proposed date falls outside the weekday unloading rule.'),
        unknown:unknown('Confirm both unloading times.'),
        ok:status('satisfied','Unloading fits the building window.'),
        outside:status('conflict','Unloading falls outside the building window.'),
      }[verdict];
    case 'deadline':
    case 'power_during_loading': {
      const label = rule.kind === 'deadline' ? 'key-return deadline' : 'power cutoff';
      if (verdict === 'late') return status('conflict','Loading ends after the ' + label + '.');
      if (verdict === 'unknown') return unknown('Confirm when loading ends.');
      return status('satisfied','Loading ends by the ' + label + '.');
    }
    case 'same_day':
      return verdict === 'ok' ? status('satisfied','Parking covers this date.')
        : deadline(timestamp(date, loadStart), rule.hours, 'Request and confirm parking for the new date');
    case 'lead_hours': {
      if (elevatorState === 'confirmed' && accepted) return status('satisfied','Management confirmed the freight elevator.');
      if (elevatorState === 'received' && accepted) return status('pending','The application was received. Wait for management’s confirmation.');
      const result = deadline(timestamp(date, unloadStart), rule.hours, 'Apply for and confirm the freight elevator');
      const prerequisite = prerequisites.find(item => item.kind === 'approval');
      if (providerId && prerequisite && !accepted && result.status !== 'conflict') {
        return { ...result, detail:'Management must accept this mover’s COI before you apply.' };
      }
      return result;
    }
    case 'approval':
      if (verdict === 'unknown') return unknown('Confirm the mover and its COI acceptance.');
      return verdict === 'ok' ? status('satisfied','Management accepted this mover’s COI.') : status('pending','The COI awaits management acceptance.');
    case 'no_overlap':
      if (verdict === 'other_day') return status('satisfied','Internet installation and loading fall on different days.');
      if (verdict === 'unknown') return unknown('Confirm loading times, location and who must attend.');
      if (verdict === 'overlap') {
        return status('conflict','You must be at both homes at the same time.', { overlapStart:loadStart > rule.start ? loadStart : rule.start, overlapEnd:loadEnd < rule.end ? loadEnd : rule.end });
      }
      return status('satisfied','No overlap is shown for the required attendee.');
    case 'after_move':
      if (verdict === 'late') return status('conflict','Cleaning starts before furniture is out.');
      if (verdict === 'unknown') return unknown('Confirm when furniture is out.');
      return status('satisfied','Furniture is out before cleaning.');
    default:
      return unknown('This requirement needs review.');
  }
}
