import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMoveGraph } from './move-graph.mjs';
import { confirmedCloudFacts } from './cloud-explanation.mjs';
import { runAgent } from './agent.mjs';
import { MOVE_RULES_CSS } from '../../src/move-rules-card.mjs';

// Work on a private copy of seed.rl so the committed store stays as shipped.
const seed = new URL('./seed.rl', import.meta.url);
const working = join(mkdtempSync(join(tmpdir(), 'connected-move-')), 'move.rl');
if (existsSync(seed)) copyFileSync(seed, working);
const graph = createMoveGraph(working);
console.log('Relate store: ' + working);
const mapPage = new URL('../../reports/map-agent.html', import.meta.url);
const routes = {
  '/api/conflicts': input => graph.findConflicts(input),
  '/api/compare': input => graph.compareOptions(input),
  '/api/explain': input => graph.explain(input),
  '/api/source/prepare': ({ text }) => graph.applySource({ text }),
  '/api/source/commit': ({ candidateId, reviewed, explain }) => {
    const result = graph.applySource(reviewed ? { reviewed } : { candidateId });
    if (reviewed && explain === true && result.after) result.cloud = confirmedCloudFacts(reviewed.statement, graph);
    return result;
  },
  '/api/reset': () => graph.reset(),
  '/api/graph': () => graph.graphView(),
  '/api/agent': input => runAgent(graph, input),
};
const assets = {
  '/logo.svg': ['../../assets/logo.svg', 'image/svg+xml'],
  '/standalone': ['demo.html', 'text/html'],
  '/local-mail.js': ['node_modules/.cache/connected-move/local-mail.js','text/javascript'],
  '/source-rules.mjs': ['source-rules.mjs','text/javascript'],
  '/demo.css': ['demo.css', 'text/css'],
  '/move-api.mjs': ['move-api.mjs','text/javascript'],
  '/demo.mjs': ['demo.mjs', 'text/javascript'],
  '/move-fixtures.mjs': ['move-fixtures.mjs', 'text/javascript'],
  '/move-rules-card.mjs': ['../../src/move-rules-card.mjs', 'text/javascript'],
};

const server = createServer(async (request, response) => {
  const reply = (status, body, type = 'application/json') => {
    response.writeHead(status, { 'content-type': type + '; charset=utf-8' });
    response.end(type === 'application/json' ? JSON.stringify(body ?? {}) : body);
  };
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET') {
      // The product map page is not part of the public repository; without it
      // the standalone page is the home page.
      if (path === '/' && !existsSync(mapPage)) return reply(200, await readFile(new URL('./demo.html', import.meta.url)), 'text/html');
      if (path === '/') {
        const [map, panel, styles] = await Promise.all([
          readFile(mapPage, 'utf8'),
          readFile(new URL('./demo.html', import.meta.url), 'utf8'),
          readFile(new URL('./demo.css', import.meta.url), 'utf8'),
        ]);
        const controls = panel.slice(panel.indexOf('<header>'), panel.indexOf('<script type="module"'));
        const scopedStyles = styles.replace(':root', ':scope').replace('body{margin:0}', '');
        return reply(200, map.replace('</head>', `<style>
          #connected-move #ask, #connected-move #answer {display:none}
          #connected-move {position:fixed;z-index:1500;right:16px;top:64px;bottom:16px;width:min(640px,calc(100vw - 32px));overflow:auto;background:#f4f8fc;border-radius:12px;transition:transform .6s ease,opacity .6s ease}
          #connected-move.waiting {transform:translateX(calc(100% + 32px));opacity:0;pointer-events:none}
          .move-site {display:flex;align-items:center;gap:8px;width:max-content;transform:translate(-17px,-17px)}
          .move-site .pin {width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--site,#1F6FB5);border:3px solid #fff;box-shadow:0 2px 8px rgba(23,36,51,.3);transition:background .4s}
          .move-site .pin svg {width:16px;height:16px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
          .move-site .tag {background:#fff;border:1px solid #d3e3f0;border-radius:8px;padding:5px 9px;font:600 13px/1.35 "Plus Jakarta Sans",system-ui,sans-serif;color:#172433;box-shadow:0 2px 8px rgba(23,36,51,.12)}
          .move-site .tag small {display:block;font:11px/1.4 "IBM Plex Mono",ui-monospace,monospace;color:var(--site,#5B6B7C)}
          .msg.a .relate-receipt {display:block;margin-top:8px;padding-top:6px;border-top:1px solid #d3e3f0;font:11px/1.5 "IBM Plex Mono",ui-monospace,monospace;color:#5B6B7C}
          .msg.a .b {white-space:pre-line}
          .move-site.flip {flex-direction:row-reverse;transform:translate(calc(-100% + 17px),-17px)}
          #rail {display:none !important}
          @media (min-width:721px) {#chatview {bottom:auto !important;max-height:540px} #chatview .asst {max-height:540px !important}}
          @scope (#connected-move) {
            ${scopedStyles}
            main {display:block;margin:8px auto}
            main > section {margin-bottom:12px}
          }
          </style></head>`).replace('</body>', `<aside id="connected-move" class="waiting" aria-label="Connected Move">${controls}</aside><script type="module" src="/demo.mjs"></script></body>`), 'text/html');
      }
      if (path === '/move-rules-card.css') return reply(200, MOVE_RULES_CSS, 'text/css');
      if (Object.hasOwn(assets, path)) {
        const [file, type] = assets[path];
        return reply(200, await readFile(new URL(file, import.meta.url)), type);
      }
      if (path === '/api/firebase-config') {
        const { FIREBASE_PROJECT_ID:projectId, FIREBASE_APP_ID:appId, FIREBASE_WEB_API_KEY:apiKey } = process.env;
        if (!projectId || !appId || !apiKey) return reply(503, { error:'Firebase Web app configuration is missing.' });
        return reply(200, { projectId, appId, apiKey, siteKey:process.env.FIREBASE_RECAPTCHA_SITE_KEY,
          debugAppCheck:process.env.FIREBASE_APP_CHECK_DEBUG === '1' });
      }
      if (path === '/api/scenarios') return reply(200, graph.compareOptions());
    }
    if (request.method === 'POST' && Object.hasOwn(routes, path)) {
      if (!request.headers['content-type']?.startsWith('application/json')) {
        return reply(415, { error: 'Expected application/json.' });
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 65536) return reply(413, { error: 'Request is too large.' });
      }
      return reply(200, await routes[path](JSON.parse(body || '{}')));
    }
    reply(404, { error: 'Route not found.' });
  } catch (error) {
    reply(400, { error: error.message });
  }
});
server.listen(Number(process.env.PORT || 3210), '127.0.0.1', () => {
  console.log('Put Roots demo: http://127.0.0.1:' + server.address().port);
});
