import { readUpdate } from './source-rules.mjs';

export function explanationFacts(statement, report) {
  const rule = readUpdate(statement);
  const { booking } = report;
  if (rule?.kind === 'cutoff') {
    const day = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return { rule:{ type:'unloading_deadline', weekday:day[rule.day % 7], finishBy:rule.end },
      booking:{ weekday:day[new Date(booking.date + 'T12:00:00Z').getUTCDay()], unloadingEnds:booking.unloadEnd } };
  }
  if (rule?.kind === 'elevator') {
    return { rule:{ type:'freight_elevator', reservation:rule.state },
      booking:{ date:booking.date, unloadingStarts:booking.unloadStart, unloadingEnds:booking.unloadEnd } };
  }
  if (rule?.kind === 'approval') {
    return { rule:{ type:'mover_insurance', accepted:rule.accepted },
      booking:{ usesReviewedMover:booking.providerId === rule.providerId } };
  }
  if (rule?.kind === 'exception') {
    return { rule:{ type:'unloading_exception', date:rule.date, start:rule.start, end:rule.end, active:rule.active },
      booking:{ date:booking.date, unloadingStarts:booking.unloadStart, unloadingEnds:booking.unloadEnd } };
  }
}

export function confirmedCloudFacts(statement, graph) {
  const update = readUpdate(statement);
  const report = update?.kind === 'elevator' ? graph.findConflicts({scenario:'optionId',optionId:update.bookingId}) : graph.findConflicts();
  const facts = explanationFacts(statement, report);
  return facts && { facts };
}
