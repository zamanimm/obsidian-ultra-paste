'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const commands=new Map(), notices=[];
let lastModal;
global.window={};
class PluginMock {
  constructor(){this.note={path:'A.md',extension:'md'};this.app={workspace:{on:()=>({}),activeEditor:null,getActiveFile:()=>this.note}};}
  async loadData(){return {imageQuality:'malformed',mode:'bogus', rules:[{name:'r',type:'javascript',enabled:true}]};}
  addSettingTab(){} registerEvent(){} registerDomEvent(){}addCommand(c){commands.set(c.id,c);}
}
class ModalMock {constructor(app){this.app=app;}open(){lastModal=this;return this;}close(){}}
class NoticeMock{constructor(s){notices.push(s);}}
const original=Module._load;
Module._load=function(name,...args){if(name==='obsidian')return {Plugin:PluginMock,Modal:ModalMock,Notice:NoticeMock,PluginSettingTab:class{},Setting:class{},htmlToMarkdown:x=>x,requestUrl:async()=>({text:'<title>foo</title>',headers:{'content-type':'text/html'}})};return original.call(this,name,...args);};
const UltraPaste=require('../main.js');Module._load=original;
const f=UltraPaste._internal;
const plugin=new UltraPaste();
class Editor {
  constructor(value=''){this.value=value;this.pos={line:0,ch:value.length};this.selection='';this.applies=[];this.cm=null;}
  getValue(){return this.value;} getSelection(){return this.selection;}getCursor(){return {...this.pos};}
  getLine(l){return this.value.split('\n')[l]||'';}posToOffset(p){return this.value.split('\n').slice(0,p.line).reduce((n,s)=>n+s.length+1,0)+p.ch;}
  offsetToPos(n){const s=this.value.slice(0,n).split('\n');return {line:s.length-1,ch:s.at(-1).length};}
  setCursor(p){this.pos={...p};this.selection='';}
  replaceSelection(t){this.applies.push(t);const offset=this.posToOffset(this.pos);this.value=this.value.slice(0,offset)+t+this.value.slice(offset+this.selection.length);this.pos=this.offsetToPos(offset+t.length);this.selection='';}
  replaceRange(t,f,to){this.applies.push(t);const s=this.posToOffset(f),e=this.posToOffset(to);this.value=this.value.slice(0,s)+t+this.value.slice(e);}
  switchNote(v){this.value=v;this.pos={line:0,ch:v.length};this.selection='';}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const transfer=(files,plain='',html='')=>({types:['Files',...(plain?['text/plain']:[]),...(html?['text/html']:[])],files,getData:type=>type==='text/plain'?plain:type==='text/html'?html:''});
const imageFile={name:'f.png',size:3,type:'image/png',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
(async()=>{
 await plugin.onload();
 assert.equal(plugin.settings.mode,'auto');assert.equal(plugin.settings.imageQuality,0.85); // settings schema guards
 const plain=new Editor('Note A');
 let resolveClip; plugin.readPlainClipboard=()=>new Promise(r=>{resolveClip=r;});
 const plainTask=plugin.pastePlainLiteral(plain);
 plugin.note={path:'B.md',extension:'md'};plain.switchNote('Note B');resolveClip('\r\n  RAW utm_source=x  \r\n');await plainTask;
 assert.equal(plain.value,'Note B');assert.equal(plain.applies.length,0,'strict plain must never write to switched note');
 plugin.note={path:'A.md',extension:'md'};
 const preview=new Editor('Original A');plugin.readClipboard=async()=>({plain:'some clipboard',html:''});
 await commands.get('paste-preview').editorCallback(preview);
 assert.ok(lastModal&&lastModal.onInsert);
 plugin.note={path:'B.md',extension:'md'};preview.switchNote('Original B');lastModal.onInsert('formatted output');
 assert.equal(preview.value,'Original B');assert.equal(preview.applies.length,0,'preview stale edit blocked');
 plugin.note={path:'A.md',extension:'md'};
 const urlEd=new Editor('');let resolveTitle;plugin.fetchPageTitle=()=>new Promise(r=>{resolveTitle=r;});
 plugin.pasteUrlWithTitle(urlEd,'https://example.org');
 assert.equal(urlEd.value,'https://example.org');
 plugin.note={path:'B.md',extension:'md'};urlEd.switchNote('https://example.org');resolveTitle('Different Title');await flush();
 assert.equal(urlEd.value,'https://example.org');assert.equal(urlEd.applies.length,1,'old URL remains in new note');
 plugin.note={path:'A.md',extension:'md'};
 const raw=new Editor('');let resolveHtml;plugin.readRawHtmlClipboard=()=>new Promise(r=>{resolveHtml=r;});
 const rawTask=commands.get('paste-as-html').editorCallback(raw);plugin.note={path:'B.md',extension:'md'};raw.switchNote('NOT-TO-CHANGE');resolveHtml('<p>hello</p>');await rawTask;
 assert.equal(raw.value,'NOT-TO-CHANGE');assert.equal(raw.applies.length,0);
 plugin.note={path:'A.md',extension:'md'};
 const mixed=new Editor('A');let prevented=0,handled=0;
 plugin.handleImageFiles=async()=>{handled++;};
 plugin.onEditorPaste({defaultPrevented:false,clipboardData:transfer([imageFile],'important commentary','<div>Important commentary<img src="x"></div>'),preventDefault(){prevented++;}},mixed,{file:plugin.note});
 assert.equal(prevented,0);assert.equal(handled,0,'rich image text falls back to native');
 const only=new Editor('A');
 plugin.onEditorPaste({defaultPrevented:false,clipboardData:transfer([imageFile]),preventDefault(){prevented++;}},only,{file:plugin.note});
 await flush();assert.equal(prevented,1);assert.equal(handled,1,'image-only handled');
 const drop=new Editor('0123456789');let preventedDrop=0;
 plugin.onEditorDrop({defaultPrevented:false,dataTransfer:transfer([imageFile]),clientX:100,clientY:20,preventDefault(){preventedDrop++;}},drop,{file:plugin.note});
 assert.equal(preventedDrop,0,'when drop coordinates unavailable native Obsidian gets the drop');
 drop.cm={posAtCoords:()=>3};
 plugin.onEditorDrop({defaultPrevented:false,dataTransfer:transfer([imageFile]),clientX:100,clientY:20,preventDefault(){preventedDrop++;}},drop,{file:plugin.note});
 assert.equal(preventedDrop,1);assert.equal(drop.pos.ch,3);
 const huge=new Editor('A'); let hugeClaim=0;
 plugin.onEditorPaste({defaultPrevented:false,clipboardData:{types:['text/plain'],getData:()=>('x'.repeat(900001))},preventDefault(){hugeClaim++;}},huge,{file:plugin.note});
 assert.equal(hugeClaim,0,'large plain clipboard uses native paste');
 const content='  \\(E=mc^2\\)\r\nhttps://site.test/?utm_source=keep&q=1   ';
 assert.equal(f.normalizeSettings({mode:'bad',imageQuality:Infinity}).mode,'auto');
 assert.equal(f.normalizeSettings({imageQuality:Infinity}).imageQuality,0.85);
 assert.equal(f.hasMeaningfulMixedText(transfer([imageFile],'caption')),true);
 console.log('PASS stability: stale preview/plain/HTML/title blocked; image MIME routing; drop coordinate fallback; large native; settings validation');
})().catch(e=>{console.error(e);process.exitCode=1;});
