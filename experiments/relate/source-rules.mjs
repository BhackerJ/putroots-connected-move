export const TZ = 'America/Los_Angeles';
export const localTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ, dateStyle: 'short', timeStyle: 'short',
});

export function timestamp(date, time) {
  if (!date || !time) return undefined;
  const utc = Date.parse(date + 'T' + time + ':00Z');
  if (!Number.isFinite(utc)) return undefined;
  // Compute the zone offset from the intended local wall clock. Verify the
  // result so a nonexistent wall-clock time never becomes a valid schedule.
  const wall = instant => Date.parse(localTime.format(instant).replace(' ', 'T') + ':00Z');
  const result = utc + utc - wall(utc);
  return wall(result) === utc ? result : undefined;
}

export function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}

function readException(text) {
  const match = /^For this move only, you may unload at the new building on (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+) (\d{1,2}), (\d{4}) from (\d{1,2}):(\d{2}) (AM|PM) to (\d{1,2}):(\d{2}) (AM|PM)\.(?: All other requirements, including the freight elevator reservation, still apply\.)?$/i.exec(text);
  if (!match) return undefined;
  const [, month, day, year, startHour, startMinute, startPeriod, endHour, endMinute, endPeriod] = match;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthIndex = months.findIndex(value => value.toLowerCase() === month.toLowerCase()) + 1;
  const date = [year,String(monthIndex).padStart(2,'0'),day.padStart(2,'0')].join('-');
  const clock = (hour, minute, period) => {
    if (Number(hour) < 1 || Number(hour) > 12 || Number(minute) > 59) return undefined;
    return String(Number(hour) % 12 + (period.toUpperCase() === 'PM' ? 12 : 0)).padStart(2,'0') + ':' + minute;
  };
  const start = clock(startHour,startMinute,startPeriod);
  const end = clock(endHour,endMinute,endPeriod);
  if (!isDate(date) || !start || !end || start >= end || !timestamp(date,start) || !timestamp(date,end)) return undefined;
  const weekday = new Intl.DateTimeFormat('en', { timeZone:'UTC', weekday:'long' }).format(new Date(date));
  if (!text.toLowerCase().includes(' on ' + weekday.toLowerCase() + ',')) return undefined;
  return { date,start,end,quote:text };
}

export function readUpdate(text) {
  const cutoff = /^Unloading must finish by ([01]\d|2[0-3]):([0-5]\d) every (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\.$/.exec(text);
  if (cutoff) return { kind:'cutoff', day:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].indexOf(cutoff[3]) + 1, end:cutoff[1] + ':' + cutoff[2], quote:text };
  const exception = readException(text);
  if (exception) return { kind:'exception', active:true, ...exception };
  if (text.startsWith('Management withdraws the following permission: ')) {
    const withdrawn = readException(text.slice('Management withdraws the following permission: '.length));
    if (withdrawn) return { kind:'exception', ...withdrawn, active:false, quote:text };
  }
  const approval = /^Management (accepted|revoked approval of) Mover ([AB])['’]s COI for this move\.$/i.exec(text);
  if (approval) return { kind:'approval', providerId:approval[2].toUpperCase(), accepted:approval[1].toLowerCase() === 'accepted', quote:text };
  const elevator = /^Management (received|confirmed|cancelled) the freight elevator (?:application|reservation) for the (Saturday|Friday [AB]) booking for this move\.$/i.exec(text);
  if (elevator) return {
    kind:'elevator', state:elevator[1].toLowerCase(),
    bookingId:elevator[2].toLowerCase() === 'saturday' ? 'current' : elevator[2].toLowerCase().replace(' ','-'),
    quote:text,
  };
  const booking = /^Mover ([AB]) confirms the quoted Friday, December 4, 2026 option for this move\.$/i.exec(text);
  if (booking) return { kind:'booking', bookingId:'friday-' + booking[1].toLowerCase(), quote:text };
  if (/^Mover A confirms cancellation of the original Saturday, December 5, 2026 booking for this move\.$/i.test(text)) return { kind:'cancel',quote:text };
  return undefined;
}
