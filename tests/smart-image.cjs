'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const cmds=new Map(), callbacks=new Map(), notices=[];
let responseForUrl=null, requestCalls=0;
global.window={};
class PluginMock {
  constructor(){this.app={workspace:{on:(name,fn)=>{callbacks.set(name,fn);return{};},getActiveFile:()=>this.note,activeEditor:null},
    metadataCache:{getFileCache:()=>({frontmatter:{imageNameKey:'study',slug:'paper'}}),getFirstLinkpathDest:(p)=>this.app.vault.getFiles().find(f=>f.name===p ||f.path===p)},
    fileManager:{getAvailablePathForAttachment:async(name)=>{const p='Attachments/'+name;return this.app.vault.getAbstractFileByPath(p)?'Attachments/'+name.replace(/(\.[^.]+)$/, ' 1$1'):p;},
      generateMarkdownLink:f=>`[[${f.name}]]`,
      renameFile:async(f,target)=>{if(this.app.vault.getAbstractFileByPath(target))throw Error('exists');this.app.vault.files.delete(f.path);f.path=target;f.name=target.split('/').pop();f.basename=f.name.replace(/\.[^.]+$/,'');this.app.vault.files.set(target,f);}},
    vault:{files:new Map(),folders:new Set(['Attachments']), getAbstractFileByPath(p){return this.files.get(p)|| (this.folders.has(p)?{path:p}:null);},
      getFiles(){return [...this.files.values()];}, getConfig:()=>true,
      async createFolder(p){this.folders.add(p);},async createBinary(p,buf){
        assert(!this.files.has(p),'never overwrite');
        const f={path:p,name:p.split('/').pop(),basename:p.split('/').pop().replace(/\.[^.]+$/,''),extension:p.split('.').pop(),parent:{path:p.split('/').slice(0,-1).join('/')},stat:{size:buf.byteLength},data:new Uint8Array(buf)};
        this.files.set(p,f);return f;
      },async readBinary(f){return f.data.buffer;}}
    };
    this.note={path:'Research/Paper.md',basename:'Paper',extension:'md'};
  }
  async loadData(){return {};}registerDomEvent(){}registerEvent(){}addSettingTab(){}addCommand(c){cmds.set(c.id,c);}
}
class ModalMock{constructor(app){this.app=app;}open(){global.latestImageModal=this;}close(){}}
class NoticeMock{constructor(s){notices.push(s);}}
const originalLoad=Module._load;
Module._load=function(id,...rest){if(id==='obsidian')return {Plugin:PluginMock,Modal:ModalMock,Notice:NoticeMock,PluginSettingTab:class{},Setting:class{},htmlToMarkdown:x=>x,requestUrl:async()=>{requestCalls++;if(responseForUrl)return responseForUrl;throw Error('URL MUST be manual');}};return originalLoad.call(this,id,...rest);};
const Plugin=require(path.join(__dirname,'../main.js'));Module._load=originalLoad;
// Version 0.2.0 uses size-limited streaming fetch rather than requestUrl for manual image downloads.
global.fetch=async (_url,_options)=>{requestCalls++;const bytes=new Uint8Array(responseForUrl.arrayBuffer);let emitted=false;return {ok:true,status:200,headers:{get:k=>k.toLowerCase()==='content-type'?responseForUrl.headers['content-type']:String(bytes.length)},body:{getReader(){return {async read(){if(emitted)return {done:true};emitted=true;return {done:false,value:bytes};},async cancel(){}};}}};};
const f=Plugin._internal;
function editor(note='Initial note'){
  let val=note;let pos={line:0,ch:note.length};let selection='';
  const e={inserted:[],getValue:()=>val,getCursor:()=>({...pos}),getSelection:()=>selection,
    somethingSelected:()=>Boolean(selection),getLine:(i)=>val.split('\n')[i]||'',replaceSelection(s){e.inserted.push(s);val=val+s;pos.ch=val.length;},move(txt){val+=txt;pos.ch=val.length;},setSelection(t){selection=t;}};
  return e;
}
const bytes=new TextEncoder().encode('fake-image-data--test');
const fakeFile=(name='p.png',type='image/png',data=bytes)=>({name,type,size:data.byteLength, arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)});
const clip=(files)=>({types:['Files'],files,getData:()=>'',items:[]});
const event=(files)=>({defaultPrevented:false, clipboardData:clip(files), prevented:0, preventDefault(){this.prevented++;this.defaultPrevented=true;},stopPropagation(){}});
(async()=>{
  assert.equal(f.imageExt('image/png','x.exe'),'png');
  assert.equal(f.imageExt('image/svg+xml','wrong.png'),'');
  assert.equal(f.imageExt('','x.jpeg'),'jpg');
  assert.equal(f.safeImageStem('../CON: Bad * file|'), 'CON- Bad - file-');
  assert.equal(f.imageNameFromTemplate('{{noteName}}-{{date}}-{{counter}}',{basename:'My Note'},'',4,{},new Date('2026-10-22T10:00:00Z')).startsWith('My Note-20261022-004'),true);
  assert.equal(f.imageNameFromTemplate('{{frontmatter:slug}}/{{imageNameKey}}',{basename:'X'},'',1,{slug:'paper',imageNameKey:'key'}),'paper-key');
  assert.equal(f.imageDisplayWidth({width:200,height:300},{imageAutoWidth:true,imagePortraitWidth:300,imageMaxDisplayWidth:600}),0);
  assert.equal(f.imageDisplayWidth({width:800,height:1000},{imageAutoWidth:true,imagePortraitWidth:300,imageMaxDisplayWidth:600}),300);
  assert.equal(f.imageEmbedLink('[[file.png]]',300),'![[file.png|300]]');
  assert.equal(f.imageEmbedLink('[file.png](some%20file.png)',300),'![file.png|300](some%20file.png)');
  assert.equal(f.validateImageUrl('http://example.com/a.png'),null);
  assert.equal(f.validateImageUrl('https://localhost/a.png'),null);
  assert.equal(f.validateImageUrl('https://192.168.1.1/a.png'),null);
  assert.equal(f.validateImageUrl('https://public.example.com/a.png'),'https://public.example.com/a.png');
  assert.equal(f.eligibleImageFiles(clip([fakeFile(),fakeFile('notes.pdf','application/pdf')] )).length,0);
  assert.equal(f.eligibleImageFiles(clip([fakeFile()])).length,1);
  const p=new Plugin();await p.onload();
  assert.equal(p.settings.smartImagePaste,true);
  assert.equal(p.settings.imageNamingPreview,true);
  assert.equal(p.settings.imageDetectDuplicates,true);
  assert.equal(p.settings.imageNoteFolders,false);
  assert.equal(p.settings.imageCompression,false);
  assert.equal(p.settings.imageAutoWidth,false);
  assert.ok(cmds.has('save-image-from-clipboard-url'));
  assert.ok(cmds.has('rename-image-at-cursor'));
  // No modal and no ordinary transformations while storing a binary paste.
  p.settings.imageNamingPreview=false;
  let e=editor('Start');let ev=event([fakeFile()]);
  p.onEditorPaste(ev,e,{file:p.note});
  await new Promise(r=>setTimeout(r,25));
  assert.equal(ev.prevented,1);
  assert.equal(p.app.vault.getFiles().length,1);
  assert.match(p.app.vault.getFiles()[0].path,/^Attachments\/Paper-\d{8}-001\.png$/);
  assert.match(e.inserted[0],/^!\[\[Paper-\d{8}-001\.png\]\]$/);
  // SHA reuse reuses identical image without creating a new file.
  let e2=editor();let ev2=event([fakeFile('another.png')]);p.onEditorPaste(ev2,e2,{file:p.note});
  await new Promise(r=>setTimeout(r,25));
  assert.equal(ev2.prevented,1);assert.equal(p.app.vault.getFiles().length,1);
  assert.equal(e2.inserted.length,1);
  // Plain shortcut must never save or inspect image files.
  p._plainPasteKeyHeld=true;p._plainPasteConsumed=false;
  let e3=editor('untouched');let ev3=event([fakeFile()]);p.onEditorPaste(ev3,e3,{file:p.note});
  await new Promise(r=>setTimeout(r,10));
  assert.equal(p.app.vault.getFiles().length,1);assert.equal(e3.inserted.length,0);
  p._plainPasteKeyHeld=false;
  // Per-note folders optional and width optional.
  p.settings.imageNoteFolders=true;p.settings.imageAutoWidth=true;
  let e4=editor();p.onEditorPaste(event([fakeFile('second.jpg','image/jpeg',new TextEncoder().encode('unique image'))]),e4,{file:p.note});
  await new Promise(r=>setTimeout(r,25));
  assert.equal(p.app.vault.getFiles().length,2);
  assert.ok(p.app.vault.getFiles().some(x=>x.path.startsWith('Research/images/Paper/')));
  // Naming prompt cancellation may not create or replace files.
  p.settings.imageNamingPreview=true;
  p.imageNamingPrompt=async()=>null;
  let e5=editor('Must remain');await p.handleImageFiles([fakeFile('new.png','image/png',new TextEncoder().encode('brand new'))],e5,p.note);
  assert.equal(e5.inserted.length,0);assert.equal(p.app.vault.getFiles().length,2);
  // After changing cursor while asynchronous naming, must leave file tree intact.
  p.imageNamingPrompt=async()=>{e5.move(' modified');return 'Changed';};
  await p.handleImageFiles([fakeFile('new.png','image/png',new TextEncoder().encode('newer image'))],e5,p.note);
  assert.equal(p.app.vault.getFiles().length,2);
  assert.equal(e5.inserted.length,0);
  // Unknown files and mixed file transfers stay native.
  let e6=editor();let ev6=event([fakeFile('notes.pdf','application/pdf')]);p.onEditorPaste(ev6,e6,{file:p.note});
  assert.equal(ev6.prevented,0);assert.equal(e6.inserted.length,0);
  // Explicit URL command: no network during any ordinary Paste, one request on command.
  assert.equal(requestCalls,0);
  p.settings.imageNamingPreview=false;p.settings.imageNoteFolders=false;
  responseForUrl={headers:{'content-type':'image/jpeg'},arrayBuffer:new TextEncoder().encode('url image').buffer};
  p.readPlainClipboard=async()=> 'https://public.example.com/figure.jpg';
  const urlEd=editor('Start URL');
  // Simulate the non-Node runtime to exercise the bounded streaming fetch adapter.
  const originalRequire=Module._load;
  Module._load=function(name,...args){if(name==='node:https'){const e=Error('Not available');e.code='MODULE_NOT_FOUND';throw e;}return originalRequire.call(this,name,...args);};
  try {await cmds.get('save-image-from-clipboard-url').editorCallback(urlEd);} finally {Module._load=originalRequire;}
  assert.equal(requestCalls,1);
  assert.match(urlEd.inserted.at(-1),/^!\[\[.*\.jpg\]\]$/);
  assert.equal(p.app.vault.getFiles().length,3);
  p.readPlainClipboard=async()=> 'http://insecure.example/image.jpg';
  await cmds.get('save-image-from-clipboard-url').editorCallback(editor());
  assert.equal(requestCalls,1,'invalid URL must be rejected before requestUrl');
  assert.equal(f.imageRefAtCursor('![Caption](<My picture.png>)',15),'My picture.png');
  // Safe manual rename: update references through Obsidian fileManager, never by raw text replace.
  const oldFile=p.app.vault.getFiles().at(-1);
  const renameEd=editor('![['+oldFile.name+']]');
  const pending=p.renameImageAtCursor(renameEd);
  assert.ok(global.latestImageModal,'confirmation modal should open');
  global.latestImageModal.finish('A New Image');
  await pending;
  assert.ok(p.app.vault.getFiles().some(file=>file.name==='A New Image.jpg'));
  assert.equal(renameEd.inserted.length,0,'rename never overwrites current editor selection');
  // Automatic image paste disabled -> native fallback.
  p.settings.smartImagePaste=false;let ev7=event([fakeFile()]);p.onEditorPaste(ev7,e6,{file:p.note});
  assert.equal(ev7.prevented,0);
  console.log('PASS Smart Image Paste: default settings, image detection, HTML/no network, naming, no overwrite, dedup, manual cancel, changes while preview, raw paste isolation, note folders, link formatting');
})().catch(e=>{console.error(e);process.exitCode=1;});
