'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(__dirname+'/../main.js','utf8');
let requests=[], tabs=[], previews=0, previewInstance;
let fail=false, nextTitle='A [complex] | **title**';
const settings={enabled:true,autoLinkTitles:true,cleanTracking:true,wrapSelectedTextWithUrl:true,preserveCode:true,autoTitleBlacklist:'',autoTitleMaxLength:0,convertMath:true,normalizeHeadings:true,condenseBlankLines:true,enableCustomRules:false,preferPlainMarkdown:true,mode:'auto',rules:[]};
class PluginMock { constructor(){this.app={workspace:{on:()=>({}),getActiveFile:()=>({path:'Test.md',extension:'md'})}};} async loadData(){return null;} addSettingTab(t){tabs.push(t);} registerDomEvent(){} registerEvent(){} addCommand(c){commands.set(c.id,c);} }
class ModalMock { constructor(){previewInstance=this;} open(){previews++;} }
class BasicMock {}
class Parser { parseFromString(html){return { querySelector(q){const m=q==='title'?html.match(/<title[^>]*>([\s\S]*?)<\/title>/i):null;return m?{textContent:m[1]}:null}, querySelectorAll(q){if(q==='a[href]'){return [...html.matchAll(/<a\s+href=["']([^"']+)["']>([^<]+)<\/a>/gi)].map(m=>({textContent:m[2]}));}return [];}};}}
let commands=new Map();
const clipboard={async read(){throw new Error('denied')},async readText(){return 'https://example.com/article'}};
const context={module:{exports:{}},require(n){assert.equal(n,'obsidian');return {Plugin:PluginMock,PluginSettingTab:BasicMock,Setting:BasicMock,Modal:ModalMock,Notice:BasicMock,htmlToMarkdown:x=>x,requestUrl: async p=>{requests.push(p); if(fail) throw new Error('not reachable');return {headers:{'content-type':'text/html; charset=utf-8'},text:'<html><head><title>'+nextTitle+'</title></head></html>'};}}},console,Math,URL,document:{},window:{},navigator:{clipboard},DOMParser:Parser,setTimeout,clearTimeout};
vm.runInNewContext(code,context,{filename:'main.js'});
const UltraPaste=context.module.exports,f=UltraPaste._internal;
function editor(initial='',cursorLine=0){let value=initial,cursor={line:cursorLine,ch:initial.length},selection='';const o={
  getSelection:()=>selection,setSelection:v=>selection=v,getCursor:()=>({...cursor}),getLine:l=>value.split('\n')[l]||'',getValue:()=>value,
  posToOffset:p=>value.split('\n').slice(0,p.line).reduce((x,y)=>x+y.length+1,0)+p.ch,
  offsetToPos:offset=>{const s=value.slice(0,offset).split('\n');return {line:s.length-1,ch:s.at(-1).length}},
  replaceSelection:t=>{const off=o.posToOffset(cursor);value=value.slice(0,off)+t+value.slice(off+selection.length);cursor=o.offsetToPos(off+t.length);selection='';},
  replaceRange:(txt,a,b)=>{let x=o.posToOffset(a),y=o.posToOffset(b);value=value.slice(0,x)+txt+value.slice(y);} };return o;}
function paste(plugin,ed,text,html=''){let stopped=false;plugin.onEditorPaste({defaultPrevented:false,preventDefault(){stopped=true;},clipboardData:{types:html?['text/plain','text/html']:['text/plain'],getData:n=>n==='text/plain'?text:html}},ed);return stopped;}
const flush=()=>new Promise(ok=>setImmediate(ok));
(async()=>{
  const plugin=new UltraPaste();await plugin.onload();
  assert.equal(plugin.settings.autoLinkTitles,true,'default must be on');
  let ed=editor();assert.ok(paste(plugin,ed,'https://example.com/article?utm_source=x&id=42'));
  assert.equal(ed.getValue(),'https://example.com/article?id=42','URL inserted immediately and tracking stripped');
  await flush();
  assert.equal(ed.getValue(),'[A \\[complex\\] \\| \\*\\*title\\*\\*](<https://example.com/article?id=42>)');
  assert.equal(requests[0].url,'https://example.com/article?id=42','no tracking sent to remote host');
  requests=[];ed=editor();ed.setSelection('Research paper');
  paste(plugin,ed,'https://example.com/article');await flush();
  assert.equal(ed.getValue(),'[Research paper](https://example.com/article)'); assert.equal(requests.length,0,'selected text wins');
  requests=[];ed=editor('```js\n',1);
  paste(plugin,ed,'https://example.com/article');await flush();
  assert.equal(requests.length,0,'no request inside code fence');
  requests=[];ed=editor('](');
  paste(plugin,ed,'https://example.com/article');await flush();
  assert.equal(requests.length,0,'no request in existing link destination');
  requests=[];assert.equal(f.htmlProvidesLinkLabel('<a href="https://example.com/article">Useful Custom Name</a>','https://example.com/article'),true);
  assert.equal(requests.length,0,'rich link with explicit label is not auto-titled');
  requests=[];ed=editor();paste(plugin,ed,'https://192.168.1.8/');await flush();assert.equal(requests.length,0,'no local network fetch');
  requests=[];ed=editor();paste(plugin,ed,'https://example.com/doc.pdf');await flush();assert.equal(requests.length,0,'no file fetch');
  fail=true;ed=editor();paste(plugin,ed,'https://example.com/missing');await flush();assert.equal(ed.getValue(),'https://example.com/missing','failed title fetch preserves URL');
  fail=false;ed=editor();requests=[];
  await commands.get('paste-as-plain').editorCallback(ed);
  assert.equal(ed.getValue(),'https://example.com/article');assert.equal(requests.length,0,'plain paste must not fetch');
  ed=editor();await commands.get('paste-preview').editorCallback(ed);assert.equal(previews,1);assert.equal(ed.getValue(),'','preview must not insert');
  assert.match(previewInstance.formatted,/\[A \\[complex\\] \\|/,'preview should show fetched title');
  assert.equal(f.titledMarkdown('https://x.org/path(a)','hi | [a]'),'[hi \\| \\[a\\]](<https://x.org/path(a)>)');
  assert.equal(f.autoTitleCandidate('https://example.org/','','', {...settings,autoLinkTitles:false}),null);
  console.log('PASS auto-link: default on; pasted bare URL; tracking; escaped titles; selection; code; existing link; labeled HTML; private host; file; failure; plain; preview');
})().catch(e=>{console.error(e);process.exitCode=1});
