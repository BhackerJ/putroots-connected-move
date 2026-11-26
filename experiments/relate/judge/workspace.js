// Supply the synthetic booking to the original Put Roots map and task rail.
window.PUTROOTS_HYBRID = true;
const home = { id:'sample-home', kind:'home', name:'New apartment · Mission Bay', lat:37.7706, lng:-122.3925,
  tasks:[{task:'new_building_rules', title:'Check the building’s move-in rules', kind:'email', state:'ready',
    rules_reply:'new_building', due:-7, dlabel:'Nov 28', need_line:'Review the property reply against the current booking.', note:'Saturday, December 5 · Unloading booked 11:30–13:30.'}] };
const nativeFetch = window.fetch.bind(window);
window.fetch = function(input, options) {
  const url = new URL(input instanceof Request ? input.url : input, location.href);
  if (url.origin === location.origin && !url.pathname.includes('.') && url.pathname !== '/') {
    const data = url.pathname === '/move/map' ? {ok:true, pins:[home], d0:'2026-12-05', new_address:'Mission Bay', due_tasks:home.tasks} : {};
    return Promise.resolve(Response.json(data));
  }
  return nativeFetch(input, options);
};
window.addEventListener('load', async () => {
  await import('/connected-move-product.mjs');
  TOKEN = 'sample';
  window.syncEntry();
  loadMoveLayer(() => openMovePin(home));
});
