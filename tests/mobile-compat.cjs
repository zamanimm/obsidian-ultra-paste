'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../main.js','utf8');
const commands=new Map();const listeners=new Map();const inserted=[];let nodeCalls=0, nativeRequests=0, fetchCalls=0;
const note={path:'Mobile.md',basename:'Mobile',extension:'md'};
let value='Start', text='\r\n\\(E=mc^2\\)  &utm_source=KEEP  ';let cursor={line:0,ch:5};
const editor={getValue:()=>value,getSelection:()=>'',getCursor:()=>({...cursor}),replaceSelection:s=>{inserted.push(s);value+=s;cursor.ch=value.length;},getLine:()=>value};
const app={workspace:{getActiveFile:()=>note,activeEditor:{editor},on:()=>({})}};
class Plugin{constructor(){this.app=app;}async loadData(){return{};}registerDomEvent(_el,name,cb){listeners.set(name,cb);}registerEvent(){}addSettingTab(){}addCommand(c){commands.set(c.id,c);}}
class Dummy{}
const mockObsidian={Plugin,PluginSettingTab:Dummy,Setting:Dummy,Notice:class{constructor(){}},Modal:Dummy,htmlToMarkdown:x=>x,requestUrl:()=>{nativeRequests++;throw Error('native network request forbidden on mobile test');},Platform:{isMobile:true,isAndroidApp:true,isDesktopApp:false}};
const content=new TextEncoder().encode('<html><title>Mobile Title</title><body>Page</body></html>');
const img=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
let responseMode='title';
function webResponse(){
  const bytes=responseMode==='image'?img:content;
  const type=responseMode==='image'?'image/png':'text/html';
  let sent=false;
  return {ok:true,status:200,type:'basic',redirected:responseMode==='redirect',headers:{get:k=>k==='content-type'?type:k==='content-length'?String(bytes.length):null},body:{getReader(){return{async read(){if(sent)return {done:true};sent=true;return{done:false,value:bytes};},async cancel(){}};}}};
}
const webCrypto=require('node:crypto').webcrypto;
const context={module:{exports:{}},require(name){if(name==='obsidian')return mockObsidian;nodeCalls++;throw Error('NODE API forbidden: '+name);},window:{},
 navigator:{clipboard:{async readText(){throw Error('Clipboard permission unavailable');}}},console,URL,Blob,TextDecoder,AbortController,crypto:webCrypto,
 DOMParser:class{parseFromString(html){return {querySelector:q=>q==='title'?{textContent:(html.match(/<title>(.*?)<\/title>/)||[])[1]||''}:null}}},setTimeout,clearTimeout,Date,fetch:async(_url,opts)=>{fetchCalls++;assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');return webResponse();}};
vm.runInNewContext(source,context,{filename:'ultra-paste-mobile.js'});
const Ultra=context.module.exports,f=Ultra._internal;
(async()=>{
  assert.equal(f.isMobileRuntime(),true);
  assert.equal(f.validatePublicWebUrl('https://localhost/private'),null);
  assert.equal(f.validatePublicWebUrl('https://192.168.1.2/x'),null);
  assert.equal(f.validatePublicWebUrl('https://example.org:8443/'),null);
  assert.equal(f.validatePublicWebUrl('https://docs.example.org/a'),'https://docs.example.org/a');
  const plugin=new Ultra();await plugin.onload();
  assert.equal(nodeCalls,0,'startup must avoid ALL Node imports on mobile');
  const title=await plugin.fetchPageTitle('https://docs.example.org/a');
  assert.equal(title,'Mobile Title');
  assert.equal(nativeRequests,0,'never use unbounded requestUrl mobile fallback');
  const hash=await f.imageHash(img);
  assert.equal(typeof hash,'string');assert.equal(hash.length,64);
  responseMode='image';
  const result=await f.downloadRemoteImageLimited('https://docs.example.org/a',500);
  assert.equal(new Uint8Array(result.arrayBuffer).length,img.length);
  await assert.rejects(f.downloadRemoteImageLimited('https://docs.example.org/a',4),/byte limit/);
  responseMode='redirect';
  await assert.rejects(f.boundedWebFetch('https://docs.example.org/a',2000),/redirect/);
  responseMode='title';
  // The regular mobile command gracefully arms native Paste when clipboard read is denied.
  await commands.get('paste-as-plain').editorCallback(editor);
  let intercepted=false;
  plugin.onEditorPaste({defaultPrevented:false,clipboardData:{types:['text/plain','text/html'],getData:t=>t==='text/plain'?text:'<b>RICH</b>'},preventDefault(){intercepted=true;},stopPropagation(){}},editor,{file:note});
  assert.equal(intercepted,true);assert.equal(inserted.at(-1),text,'mobile plain paste must preserve exact CRLF/whitespace');
  // Armed state is strictly one-shot, so next paste should enter the normal smart pipeline.
  plugin.settings.enabled=false;
  intercepted=false;
  plugin.onEditorPaste({defaultPrevented:false,clipboardData:{types:['text/plain'],getData:()=>text},preventDefault(){intercepted=true;}},editor,{file:note});
  assert.equal(intercepted,false);
  assert.equal(nodeCalls,0,'MOBILE must never dynamically import Node, even on network/hash paths');
  assert.ok(fetchCalls>=3);
  console.log('PASS mobile: startup, no Node APIs, bounded fetch, public destination checks, Web Crypto, denied clipboard one-shot strict paste');
})().catch(e=>{console.error(e);process.exitCode=1});
