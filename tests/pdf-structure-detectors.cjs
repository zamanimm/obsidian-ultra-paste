'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../main.js','utf8');
const commands=new Map();const events=new Map();let hitUrl=0;let notice=[];
class Plugin {constructor(){this.app={workspace:{on:(name,callback)=>{events.set(name,callback);},activeEditor:null,getActiveFile:()=>({path:'Test.md',extension:'md'})}};}async loadData(){return {};}addSettingTab(){}registerDomEvent(){}registerEvent(){}addCommand(c){commands.set(c.id,c);} }
class Modal {constructor(app){this.app=app;}open(){globalThis.latestModal=this;} }
class Notice {constructor(t){notice.push(t);} }
const ctx={module:{exports:{}},navigator:{clipboard:{readText:async()=>''}},document:{},window:{},Math,URL,console,setTimeout,clearTimeout,require:(id)=>{assert.equal(id,'obsidian');return {Plugin,Modal,Notice,PluginSettingTab:class{},Setting:class{},htmlToMarkdown:x=>x,requestUrl:async()=>{hitUrl++;return {headers:{'content-type':'text/html'},text:'<title>Fetched</title>'};}};}};
vm.runInNewContext(source,ctx,{filename:'main.js'});
const lib=ctx.module.exports._internal;
const plainPDF='The findings suggest that long-term expo-\nsure has a measurable effect on the out-\ncome in both groups. The results agree.\n\nThe next paragraph is separate.';
assert.equal(lib.cleanPdfText(plainPDF),'The findings suggest that long-term exposure has a measurable effect on the outcome in both groups. The results agree.\n\nThe next paragraph is separate.');
assert.equal(lib.cleanPdfText('The ﬁndings show a signiﬁcant eﬀect.'),'The findings show a significant effect.');
assert.equal(lib.cleanPdfText('Page 12\n\n123\n\nConclusion',{removePageNumbers:false}),'Page 12\n\n123\n\nConclusion');
assert.equal(lib.cleanPdfText('Page 12\n\n123\n\nConclusion',{removePageNumbers:true}),'Page 12\n\nConclusion');
const protectedText='```python\nprint("Hello")\n  x=3\n```\n\n$$\n\\frac{a}{b}\n$$\n\nA paragraph has ordinary PDF line wraps that are sometimes tricky\nto recover exactly.';
assert.match(lib.cleanPdfText(protectedText),/```python\nprint\("Hello"\)\n  x=3\n```/);
assert.match(lib.cleanPdfText(protectedText),/\$\$\n\\frac\{a\}\{b\}\n\$\$/);
assert.equal(lib.cleanPdfText('ﬁle',''), 'file');
function ed(line,prefix=line,options={}){
  const lines=(options.note||line).split('\n');
  return {getCursor:(which)=>which==='to'? {line:options.line||0,ch:options.toCh??prefix.length}:{line:options.line||0,ch:options.fromCh??prefix.length},getLine:(i)=>lines[i]||'',getSelection:()=>options.selection||'',getValue:()=>options.note||line,somethingSelected:()=>!!options.selection,replaceSelection(x){this.inserts.push(x);},inserts:[],getCursorAtOffset:()=>({line:0,ch:0})};
}
const s={smartStructureLists:true,smartStructureQuotes:true};
let e=ed('    - ');
assert.equal(lib.structurePaste('- Parent\n  - Child\n- Peer',e,s),'Parent\n      - Child\n    - Peer');
e=ed('  1. ');
assert.equal(lib.structurePaste('1. First\n   1. Sub\n2. Second',e,s),'First\n     1. Sub\n  2. Second');
e=ed('  - Existing');
assert.equal(lib.structurePaste('- Subtask\n  - Grandchild',e,s),'\n    - Subtask\n      - Grandchild');
e=ed('> ');
assert.equal(lib.structurePaste('First\n\nSecond',e,s),'First\n>\n> Second');
e=ed('> > ');
assert.equal(lib.structurePaste('First\nSecond',e,s),'First\n> > Second');
e=ed('> [!note] Header');
assert.equal(lib.structurePaste('First\nSecond',e,s),'First\nSecond');
e=ed('- ');
assert.equal(lib.structurePaste('Just a paragraph\nwith lines',e,s),'Just a paragraph\nwith lines');
e=ed('Ordinary prose');
assert.equal(lib.structurePaste('- A\n- B',e,s),'- A\n- B');
e=ed('> prefix and more text', '>',{fromCh:2,toCh:2});
assert.equal(lib.structurePaste('First\nSecond',e,s),'First\nSecond');
e=ed('    - ', '    - ',{selection:'multiple\nlines',note:'    - \nother',line:0,toCh:0});
assert.equal(lib.structurePaste('- A\n- B',e,s),'- A\n- B');
// Detector routing, no changes for unknown clipboard or HTML-only in code.
const defaults={enabled:true,smartStructureLists:true,smartStructureQuotes:true,preserveCode:true,autoLinkTitles:false,mode:'plain',convertMath:true,cleanTracking:true,normalizeHeadings:true,condenseBlankLines:true,enableCustomRules:false,rules:[]};
e=ed('> ');
assert.equal(lib.detectSmartPaste('one\ntwo','',e,defaults).text,'one\n> two');
e=ed('```python\n', '```python\n',{note:'```python\n'}); // fake editor: fallback native on empty plain
assert.equal(lib.detectSmartPaste('', '<p>html</p>',e,defaults),null);
assert.equal(lib.detectSmartPaste('code literal', '',e,defaults).source,'code-context');
// Only PDF command triggers PDF cleanup; normal smart formatting keeps wrapped PDF lines.
const direct=lib.detectSmartPaste(plainPDF,'',ed('Some text'),defaults);
assert.match(direct.text,/expo-\nsure/);
assert.ok(commands.size===0);
(async()=>{
  const pl=new ctx.module.exports();await pl.onload();
  assert.ok(commands.has('clean-pdf-text'));
  const origCommands=['paste-as-html','paste-as-plain','paste-preview','fix-math-safe','fix-math-balanced','fix-math-aggressive'];
  for(const id of origCommands)assert.ok(commands.has(id));
  const bad=ed('hello');commands.get('clean-pdf-text').editorCallback(bad);
  assert.ok(notice.some(x=>x.includes('select PDF text')),'PDF requires explicit selection');
  assert.equal(bad.inserts.length,0);
  const selected=ed('some selected text','some selected text',{selection:'Some split text'});
  commands.get('clean-pdf-text').editorCallback(selected);
  assert.equal(selected.inserts.length,0,'PDF command must only open preview');
  // No special treatment for native file or internal Obsidian pastes.
  let prevented=0;
  const ee={defaultPrevented:false,preventDefault(){prevented++},clipboardData:{types:['Files','text/plain'],getData:()=>'- X\n- Y'}};
  pl.onEditorPaste(ee,selected);
  assert.equal(prevented,0);
  ee.clipboardData={types:['text/plain'],getData:()=>''};pl.onEditorPaste(ee,selected);assert.equal(prevented,0);
  const before=selected.inserts.length;
  pl.settings={...pl.settings,smartStructureLists:true,smartStructureQuotes:true};
  pl.onEditorPaste({defaultPrevented:false,preventDefault(){prevented++},clipboardData:{types:['text/plain'],getData:()=>'- A\n  - B'}},ed('    - '));
  assert.equal(prevented,1);
  assert.equal(selected.inserts.length,before);
  assert.equal(hitUrl,0);
  console.log('PASS: PDF formatting + preview-only command, ligatures, page-number opt-in, code+math safety, nested lists, callouts, context, native fallback, existing commands');
})().catch(e=>{console.error(e);process.exitCode=1});
