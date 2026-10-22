'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const main = fs.readFileSync(__dirname + '/../main.js', 'utf8');
const commands = new Map();
const listeners = new Map();
let webRequests = 0, conversions = 0, rulesInvoked = 0, openedPreviews = 0;
const app = { workspace: { activeEditor: null, on: (_name, listener) => listener, getActiveFile:()=>({path:'Test.md',extension:'md'}) } };
class PluginMock {
  constructor() { this.app = app; }
  async loadData() { return null; }
  addSettingTab() {}
  registerEvent() {}
  registerDomEvent(_el, event, handler) { listeners.set(event, handler); }
  addCommand(command) { commands.set(command.id, command); }
}
class ModalMock { constructor(app) { this.app = app; } open() { openedPreviews++; } }
class SimpleMock {}
const clipboardText = '  \\(E=mc^2\\)\r\nhttps://example.org/?utm_source=KEEP\n  **keep unchanged**  \n  foo\t\n';
let textResult = clipboardText;
let rejectReadText = false;
let richItems = [];
const clipboard = {
  async read() { return richItems; },
  async readText() { if (rejectReadText) throw Error('readText denied'); return textResult; }
};
const context = {
  module: { exports: {} },
  require(name) {
    assert.equal(name, 'obsidian');
    return { Plugin: PluginMock, PluginSettingTab: SimpleMock, Setting: SimpleMock,
      Notice: SimpleMock, Modal: ModalMock, htmlToMarkdown: x => {conversions++;return x;},
      requestUrl: async () => {webRequests++;return {text:'<title>Title</title>',headers:{'content-type':'text/html'}};} };
  },
  document: {}, window: {}, navigator: { clipboard },
  console, Math, URL
};
vm.runInNewContext(main, context, { filename: 'main.js' });
const UltraPaste = context.module.exports;
const flush = () => new Promise(resolve => setImmediate(resolve));
const editor = {replaceSelection: value=>inserted.push(value), getSelection:()=>'',getValue:()=>'',getCursor:()=>({line:0,ch:0})};
let inserted = [];
let prevent = 0, stop = 0;
const chord = (overrides={})=>({
  code:'KeyV',key:'v',ctrlKey:true,metaKey:false,shiftKey:true,altKey:false,
  repeat:false,isComposing:false,target:{closest:selector=>'.cm-editor'},
  preventDefault(){prevent++;},stopImmediatePropagation(){stop++;},
  ...overrides
});
function nativePaste({plain=clipboardText,html='<b>RICH</b>',types=['text/plain','text/html']}={}) {
  let prevented=false;
  const evt={defaultPrevented:false,preventDefault(){prevented=true;},clipboardData:{types,getData:t=>t==='text/plain'?plain:html}};
  app.workspace.activeEditor={editor};
  plugin.onEditorPaste(evt, editor);
  return prevented;
}
let plugin;
(async () => {
  plugin = new UltraPaste(); await plugin.onload();
  assert.deepEqual([...commands.get('paste-as-plain').hotkeys[0].modifiers],['Mod','Shift']);
  assert.deepEqual([...commands.get('paste-preview').hotkeys[0].modifiers],['Mod','Alt']);
  // All potentially destructive features ON. Plain paste still must bypass them.
  plugin.settings.enableCustomRules=true;
  plugin.settings.allowJavaScriptRules=true;
  plugin.settings.autoLinkTitles=true;
  plugin.settings.convertMath=true;
  plugin.settings.cleanTracking=true;
  plugin.settings.normalizeHeadings=true;
  app.workspace.activeEditor={editor};
  // Explicit command preserves exact clipboard string with CRLF and whitespace.
  await commands.get('paste-as-plain').editorCallback(editor);
  assert.equal(inserted.at(-1),clipboardText);
  assert.equal(webRequests,0); assert.equal(conversions,0);
  inserted=[];
  await commands.get('paste-preview').editorCallback(editor);
  assert.equal(openedPreviews,1);
  assert.equal(inserted.length,0,'preview must not insert anything automatically');
  plugin.settings.rules=[{
    id:'trigger',name:'replace everything',enabled:true,type:'javascript',
    pattern:'.+',flags:'g',scope:'all',script:'globalThis.ruleCalls=(globalThis.ruleCalls||0)+1;return "REPLACED";'
  }];
  // Desktop shortcut: handled in capture phase; prevents command + native paste duplication.
  const keyDown=listeners.get('keydown'), keyUp=listeners.get('keyup');
  keyDown(chord()); await flush();
  assert.equal(inserted.length,1,'one keydown = one paste');
  assert.equal(inserted[0],clipboardText,'raw contents must be identical');
  assert.equal(prevent,1); assert.equal(stop,1);
  assert.equal(nativePaste(),true,'extra native paste should be cancelled');
  assert.equal(inserted.length,1,'native follow-up must not cause duplicate insertion');
  keyDown(chord({repeat:true})); await flush();
  assert.equal(inserted.length,1,'autorepeat must not duplicate text');
  keyUp(chord());
  // Native event fallback if OS generates a paste event instead of the plugin shortcut.
  inserted=[];
  keyDown(chord({target:{closest:()=>null}}));
  assert.equal(nativePaste(),true);
  assert.equal(inserted[0],clipboardText,'fallback raw event text (including CRLF)');
  keyUp(chord());
  // Only HTML: no readText available, must not insert HTML or wipe selection.
  inserted=[];
  textResult='';rejectReadText=true;richItems=[{types:['text/html'],getType:async()=>({text:async()=>'<b>HTML only</b>'})}];
  await commands.get('paste-as-plain').editorCallback(editor);
  assert.equal(inserted.length,0,'HTML-only clipboard cannot produce plain text');
  keyDown(chord()); await flush();keyUp(chord());
  assert.equal(inserted.length,0,'HTML-only keyboard paste must not insert anything');
  // If a native editor-paste event has only HTML, never fallback to rich conversion.
  keyDown(chord({target:{closest:()=>null}}));
  assert.equal(nativePaste({types:['text/html']}),true);
  keyUp(chord());
  assert.equal(inserted.length,0);
  // Clipboard API fallback: text/plain still wins even when text/html is present.
  inserted=[];richItems=[{types:['text/plain','text/html'],getType:async type=>({text:async()=>type==='text/plain'?clipboardText:'<h1>BAD HTML</h1>'})}];
  await commands.get('paste-as-plain').editorCallback(editor);
  assert.equal(inserted[0],clipboardText,'fallback must return only text/plain, never HTML');
  // Plain paste also works if Smart Paste is disabled.
  rejectReadText=false; textResult=clipboardText;
  plugin.settings.enabled=false;
  keyDown(chord()); await flush();keyUp(chord());
  assert.equal(inserted.at(-1),clipboardText);
  // Don't steal shortcut from settings inputs.
  inserted=[]; const p=prevent;
  keyDown(chord({target:{closest:()=>null}})); await flush();keyUp(chord());
  assert.equal(prevent,p);assert.equal(inserted.length,0);
  // Smart Paste remains functional for ordinary ctrl-v and still fixes math + URLs.
  plugin.settings.enabled=true;plugin.settings.rules=[];
  inserted=[];
  nativePaste({html:'',types:['text/plain']});
  assert.match(inserted[0],/\$E=mc\^2\$/);
  assert.doesNotMatch(inserted[0],/utm_source=KEEP/);
  assert.equal(webRequests,0,'no page title network request during literal paste');
  assert.equal(context.ruleCalls || 0,0,'plain-paste path must never execute even Scope=All JS rule');
  console.log('PASS literal clipboard: exact text, no replacements, capture, no duplicates, HTML-only blocking, disabled-smart mode, input focus, ordinary paste, preview');
})().catch(error=>{console.error(error);process.exitCode=1});
