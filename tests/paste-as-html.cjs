'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../main.js','utf8');
const commands=new Map();
const notices=[];
let converted=0, requests=0;
let html='<div style="color: red; font-weight: bold">فارسی <strong>A &amp; B</strong>\r\n<table><tr><td>x</td></tr></table></div>';
let clipboardItems=[];
let denyRead=false;
const clipboard={
 async read(){if(denyRead)throw Error('permission denied');return clipboardItems;},
 async readText(){return 'This must NOT replace HTML';}
};
class PluginMock{
 constructor(){this.app={workspace:{on:()=>null,activeEditor:null,getActiveFile:()=>({path:'Test.md',extension:'md'})}};}
 async loadData(){return null;}
 addSettingTab(){}
 registerDomEvent(){}
 registerEvent(){}
 addCommand(c){commands.set(c.id,c);}
}
class Empty{}
class NoticeMock{constructor(message){notices.push(message);}}
const ctx={module:{exports:{}},require(id){assert.equal(id,'obsidian');return{Plugin:PluginMock,PluginSettingTab:Empty,Setting:Empty,Notice:NoticeMock,Modal:Empty,htmlToMarkdown(){converted++;return 'WRONG';},requestUrl(){requests++;return Promise.reject(Error('unexpected'));}};},navigator:{clipboard},window:{},document:{},URL,console,Math};
vm.runInNewContext(src,ctx,{filename:'main.js'});
const Plugin=ctx.module.exports;
const inserted=[];
let noteValue='Test note';
const editor={replaceSelection(text){inserted.push(text);noteValue+=text;},getSelection(){return '';},getValue(){return noteValue;},getCursor(){return {line:0,ch:noteValue.length};}};
(async()=>{
 const plugin=new Plugin();await plugin.onload();
 const command=commands.get('paste-as-html');
 assert.ok(command,'Paste as HTML command registered');
 assert.equal(command.hotkeys,undefined,'no default shortcut conflict');
 assert.deepEqual([...commands.get('paste-as-plain').hotkeys[0].modifiers],['Mod','Shift']);
 assert.deepEqual([...commands.get('paste-preview').hotkeys[0].modifiers],['Mod','Alt']);
 assert.notEqual(command.id, 'paste-rich', 'separate command from rich-to-markdown');
 clipboardItems=[{types:['text/plain','text/html'],async getType(type){assert.equal(type,'text/html');return{text:async()=>html};}}];
 await command.editorCallback(editor);
 assert.equal(inserted.length,1);
 assert.equal(inserted[0],html,'HTML payload is inserted verbatim including CRLF & styles');
 assert.equal(converted,0); assert.equal(requests,0);
 // HTML in a later ClipboardItem should work, without touching plain text.
 clipboardItems=[{types:['text/plain'],async getType(){throw Error('never');}},{types:['text/html'],async getType(){return{text:async()=>'<b>HTML-only item</b>'};}}];
 await command.editorCallback(editor);
 assert.equal(inserted.at(-1),'<b>HTML-only item</b>');
 // Clipboard containing only plain text must not silently replace selection.
 clipboardItems=[{types:['text/plain'],async getType(){throw Error('never');}}];
 let count=inserted.length;
 await command.editorCallback(editor);
 assert.equal(inserted.length,count);
 assert.match(notices.at(-1),/text\/html/);
 // Empty HTML must also not replace selected note content.
 clipboardItems=[{types:['text/html'],async getType(){return{text:async()=>''};}}];
 await command.editorCallback(editor);
 assert.equal(inserted.length,count);
 denyRead=true;
 await command.editorCallback(editor);
 assert.equal(inserted.length,count);
 assert.match(notices.at(-1),/permission denied/);
 denyRead=false;
 assert.equal(converted,0);assert.equal(requests,0);
 console.log('PASS Paste as HTML: command, literal styles+CRLF, HTML-only, multi-item, no-HTML, empty, denied, no transformations, previous shortcuts');
})().catch(e=>{console.error(e);process.exitCode=1;});
