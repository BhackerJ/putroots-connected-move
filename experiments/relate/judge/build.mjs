import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MOVE_RULES_CSS } from '../../../src/move-rules-card.mjs';

const output = resolve('node_modules/.cache/judge');
await mkdir(output,{recursive:true});
if (!process.env.FIREBASE_ENTERPRISE_SITE_KEY) throw new Error('Set the public FIREBASE_ENTERPRISE_SITE_KEY.');
const aliases = {
  '/move-api.mjs':'judge/api.mjs', './graph-store.mjs':'judge/graph-store.mjs',
  '/local-mail.js':'local-mail.mjs', '/source-rules.mjs':'source-rules.mjs',
  '/move-rules-card.mjs':'../../src/move-rules-card.mjs','/move-fixtures.mjs':'move-fixtures.mjs'
};
await build({ entryPoints:['demo.mjs'], outfile:output+'/demo.mjs', bundle:true, format:'esm', define:{ JUDGE_SITE_KEY:JSON.stringify(process.env.FIREBASE_ENTERPRISE_SITE_KEY) },
  plugins:[{ name:'judge-browser', setup(b) {
    b.onResolve({filter:/^[/]|^\.\/graph-store\.mjs$/}, args => aliases[args.path] ? {path:resolve(aliases[args.path])}:undefined);
  }}] });
const html = (await readFile('demo.html','utf8')).replace('<form id="ask">','<form id="ask" hidden>')
  .replace('Sample move in San Francisco','Sample move in San Francisco · Changes last for this tab session.')
  .replace('<summary>Add a property reply</summary>','<summary>Add a property reply</summary><p>Use desktop Chrome with the on-device model enabled and downloaded. <a href="https://firebase.google.com/docs/ai-logic/hybrid/web/get-started">Chrome setup</a> · <a href="https://github.com/BhackerJ/putroots-connected-move/blob/buildhybridai-2026/submissions/buildhybridai/demo-script.md#paste-these-emails-in-order">Four sample emails</a></p>');
await writeFile(output+'/index.html',html);
await writeFile(output+'/move-rules-card.css',MOVE_RULES_CSS);
await copyFile('demo.css',output+'/demo.css');
await copyFile('../../assets/logo.svg',output+'/logo.svg');
await copyFile('node_modules/@relate/relate-wasm/relate_bg.wasm',output+'/relate_bg.wasm');
