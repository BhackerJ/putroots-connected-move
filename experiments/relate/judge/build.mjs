import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const output = resolve('node_modules/.cache/judge');
await mkdir(output,{recursive:true});
if (!process.env.FIREBASE_ENTERPRISE_SITE_KEY) throw new Error('Set the public FIREBASE_ENTERPRISE_SITE_KEY.');
const aliases = {
  '/move-api.mjs':'judge/api.mjs', './graph-store.mjs':'judge/graph-store.mjs',
  '/local-mail.js':'local-mail.mjs', '/source-rules.mjs':'source-rules.mjs',
  '/move-rules-card.mjs':'../../src/move-rules-card.mjs','/move-fixtures.mjs':'move-fixtures.mjs'
};
await build({ entryPoints:['judge/product.mjs'], outfile:output+'/connected-move-product.mjs', bundle:true, format:'esm', define:{ JUDGE_SITE_KEY:JSON.stringify(process.env.FIREBASE_ENTERPRISE_SITE_KEY) },
  plugins:[{ name:'judge-browser', setup(b) {
    b.onResolve({filter:/^[/]|^\.\/graph-store\.mjs$/}, args => aliases[args.path] ? {path:resolve(aliases[args.path])}:undefined);
  }}] });
const product = await readFile(process.env.PUTROOTS_MAP_HTML, 'utf8');
if (!product.includes('window.PUTROOTS_HYBRID') || !product.includes('function openMovePin(')) throw Error('Expected the integrated Put Roots map build');
let shell = product;
for (const match of product.matchAll(/https:\/\/unpkg\.com\/((?:@[^/]+\/)?[^/@]+)@[^/]+\/dist\/([^"']+?)["']/g)) {
  const [,pkg,file] = match;
  await copyFile('node_modules/'+pkg+'/dist/'+file,output+'/'+file);
  shell = shell.replace(match[0].slice(0,-1), '/'+file);
}
await copyFile('node_modules/@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js',output+'/leaflet-maplibre-gl.js');
shell = shell.replace('https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js','/leaflet-maplibre-gl.js');
const html = shell.replace(/<script[^>]+src="https:\/\/www\.useinflect\.ai[^>]+><\/script>/g, '')
  .replace(/<img src="https:\/\/www\.useinflect\.ai[^>]+>/g, '')
  .replace(/<script>\(function\(\)\{var g=document.createElement\("script"\);\s*g.src="https:\/\/accounts.google.com[^<]+<\/script>/, '')
  .replace(/var GCLIENT = "[^"]*";/, 'var GCLIENT = "";')
  .replace('<head>', '<head><script src="/workspace.js"></script>');
await writeFile(output+'/index.html',html);
await copyFile('judge/workspace.js',output+'/workspace.js');
console.log('Product workspace SHA256',createHash('sha256').update(html).digest('hex'));
await copyFile('../../assets/logo.svg',output+'/logo.svg');
await copyFile('node_modules/@relate/relate-wasm/relate_bg.wasm',output+'/relate_bg.wasm');
