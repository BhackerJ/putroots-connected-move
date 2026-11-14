export const SAMPLE_NOW = '2026-11-30T09:00:00-08:00';

export const SOURCES = {
  S01: 'Keys to the new apartment are available December 1 at 9:00 AM. Internet can be installed before furniture arrives.',
  S02: 'Mover A confirmed December 5. Loading at the old apartment is 9:00–10:30 AM and unloading at the new apartment is 11:30 AM–1:30 PM. Request a change at least 72 hours before loading to avoid a change fee. Fare differences still apply.',
  S03: 'Unloading is permitted Monday through Friday, 9:00 AM–4:00 PM. Apply for a freight elevator at least 48 hours before unloading. Management must accept your mover’s COI before you apply. Wait for written confirmation of the elevator reservation.',
  S04: 'We accepted Mover A’s COI on November 24. It covers this move on December 4 or 5. Mover B’s COI is still pending.',
  S05: 'Return your old apartment keys by Sunday, December 6 at noon. You may return them once your furniture is out and the apartment has been cleaned. Please ask for written approval for any extension.',
  S06: 'Mover A can load on Friday, December 4 from 9:00–11:00 AM and unload noon–2:00 PM for $120 more. This offer expires December 1 at 5:00 PM. The change requires written confirmation.',
  S07: 'Mover B can load Friday, December 4 from 10:00 AM–noon and unload 1:30–3:30 PM for $80 more than the original fare. Offer expires December 1 at 5:00 PM and requires written confirmation. We submitted our COI. Mover A’s cancellation cost is unknown.',
  S08: 'Your parking arrangements cover December 5 only. Request any change at least 72 hours before the new loading start. Wait for written confirmation. Additional charges are unknown.',
  S09: 'Internet installation is Friday, December 4 from 10:00 AM–noon at the new apartment. You must be there for the entire appointment. A replacement slot has not been confirmed.',
  S10: 'Cleaning starts at the old apartment December 5 at 3:00 PM, after all furniture has been moved out. The cleaners need power at the apartment. Any change requires confirmation.',
  S11: 'Power at the old apartment ends December 6 at 6:00 PM. The movers need power throughout loading. An extension requires confirmation.',
  S12: 'I must personally stay at the old apartment throughout loading with either mover. No alternate person is available. I can take Friday off. The movers’ schedule allows travel between addresses.',
};
export const EXCEPTION_EMAIL = 'For this move only, you may unload at the new building on Saturday, December 5, 2026 from 11:30 AM to 1:30 PM. All other requirements, including the freight elevator reservation, still apply.';

export const BOOKINGS = [
  { id:'current', label:'Saturday · Mover A', providerId:'A', date:'2026-12-05', loadStart:'09:00', loadEnd:'10:30', unloadStart:'11:30', unloadEnd:'13:30', source:'S02' },
  { id:'friday-a', label:'Friday · Mover A', providerId:'A', date:'2026-12-04', loadStart:'09:00', loadEnd:'11:00', unloadStart:'12:00', unloadEnd:'14:00', incrementalCost:120, source:'S06' },
  { id:'friday-b', label:'Friday · Mover B', providerId:'B', date:'2026-12-04', loadStart:'10:00', loadEnd:'12:00', unloadStart:'13:30', unloadEnd:'15:30', incrementalCost:80, source:'S07' },
];

export const REQUIREMENTS = [
  { id:'access', label:'New apartment access', kind:'access', date:'2026-12-01', start:'09:00', sources:['S01'] },
  { id:'unloading', label:'Building unloading window', kind:'window', start:'09:00', end:'16:00', sources:['S03'] },
  { id:'keys', label:'Return old keys', kind:'deadline', date:'2026-12-06', end:'12:00', sources:['S05'] },
  { id:'parking', label:'Parking arrangement', kind:'same_day', date:'2026-12-05', hours:72, sources:['S08'] },
  { id:'elevator', label:'Freight elevator', kind:'lead_hours', hours:48, sources:['S03'] },
  { id:'coi', label:'Mover insurance (COI)', kind:'approval', providerId:'A', sources:['S04'] },
  { id:'internet', label:'Internet installation', kind:'no_overlap', date:'2026-12-04', start:'10:00', end:'12:00', participantId:'resident', locationId:'new-home', sources:['S09','S12'] },
  { id:'cleaning', label:'Old apartment cleaning', kind:'after_move', date:'2026-12-05', start:'15:00', sources:['S10'] },
  { id:'power', label:'Power during loading', kind:'power_during_loading', date:'2026-12-06', end:'18:00', sources:['S11'] },
];
