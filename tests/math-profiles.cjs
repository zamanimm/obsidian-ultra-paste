'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const commands=new Map(), modals=[], notices=[];
const app={workspace:{activeEditor:null,on:()=>{},getActiveFile:()=>({path:'Test.md',extension:'md'})}};
class PluginMock {constructor(){this.app=app;} async loadData(){return null;} addSettingTab(){} addCommand(c){commands.set(c.id,c);} registerDomEvent(){} registerEvent(){} }
class ModalMock {constructor(a){this.app=a;} open(){modals.push(this);} close(){} }
class Empty{}
const sandbox={module:{exports:{}},require:n=>{assert.equal(n,'obsidian');return {Plugin:PluginMock,PluginSettingTab:Empty,Setting:Empty,Notice:class{constructor(t){notices.push(t);}},Modal:ModalMock,htmlToMarkdown:x=>x};}, console, Math, URL, navigator:{clipboard:{}}, document:{}, window:{}};
vm.runInNewContext(fs.readFileSync(__dirname+'/../main.js','utf8'),sandbox);
const F=sandbox.module.exports._internal;
const test=(label,input,expectations)=>{
 const values=['safe','balanced','aggressive'].map(mode=>F.fixMathWithProfile(input,mode));
 expectations.forEach((test,i)=>{if(test.exact!==undefined)assert.equal(values[i].text,test.exact,label+' '+values[i].profile);if(test.has)assert.ok(values[i].text.includes(test.has),label+' '+values[i].profile+' expected substring '+test.has+' found '+values[i].text);if(test.lacks)assert.ok(!values[i].text.includes(test.lacks),label+' '+values[i].profile+' unexpected '+test.lacks);});
 values.forEach(v=> assert.equal(F.fixMathWithProfile(v.text,v.profile).text,v.text,'idempotence: '+label+' '+v.profile));
};
test('bracket inline',String.raw`Look [ \frac{a}{b} = c ] today.`,[{exact:String.raw`Look [ \frac{a}{b} = c ] today.`},{has:'$$\n\\frac{a}{b} = c\n$$'},{has:'$$\n\\frac{a}{b} = c\n$$'}]);
test('simple parens','Look at (x=y) and (p).',[{exact:'Look at (x=y) and (p).'},{exact:'Look at $x=y$ and (p).'},{exact:'Look at $x=y$ and $p$.'}]);
test('safety','[1, 2, 3] [ref](https://example.com?q=1) [[Wiki]] [^1] `'+String.raw`[ \frac{a}{b} ]`+'`',Array(3).fill({exact:'[1, 2, 3] [ref](https://example.com?q=1) [[Wiki]] [^1] `'+String.raw`[ \frac{a}{b} ]`+'`'}));
test('fenced untouched',['~~~python',String.raw`[ \frac{1}{2} ]`,`\\(x=y\\)`,'~~~'].join('\n'),Array(3).fill({exact:['~~~python',String.raw`[ \frac{1}{2} ]`,`\\(x=y\\)`,'~~~'].join('\n')}));
test('normal delimiters',String.raw`Inline \(x+y\) and display \[x^2+y^2=z^2\]`,Array(3).fill({has:'$x+y$'}));
test('nested left',String.raw`Eq [ \left[ \frac{x}{2} \right] + y ]`,[{exact:String.raw`Eq [ \left[ \frac{x}{2} \right] + y ]`},{has:String.raw`\left[ \frac{x}{2} \right] + y`},{has:String.raw`\left[ \frac{x}{2} \right] + y`}]);
test('bad artifact restricted', ['$$','\\begin{matrix}','1 & 2\\','3 & 4','\\end{matrix}','## \\frac{a}{b}','====','$$'].join('\n'), [{has:'## \\frac'},{has:'## \\frac'},{lacks:'## \\frac'}]);
const makeEditor=(value,selection='')=>({text:value,selection,applies:0,somethingSelected(){return this.selection.length>0;},getSelection(){return this.selection;},getValue(){return this.text;},getCursor(){return {line:0,ch:0};},replaceSelection(t){this.applies++;this.selection=t;},replaceRange(t){this.applies++;this.text=t;},offsetToPos(){return {line:0,ch:this.text.length};},getLine(){return this.text.split('\n')[0]||'';},setCursor(){},lineCount(){return this.text.split('\n').length;}});
(async()=>{
 const plugin=new sandbox.module.exports();await plugin.onload();
 for(const id of ['fix-math-safe','fix-math-balanced','fix-math-aggressive'])assert.ok(commands.has(id),'command '+id);
 assert.equal(plugin.settings.convertMath,true);assert.equal(plugin.settings.detectParenMath,false);
 const editor=makeEditor('Here (x=y) and (p).');
 commands.get('fix-math-safe').editorCallback(editor);
 assert.equal(editor.applies,0,'safe no-op on ambiguous parens');
 commands.get('fix-math-balanced').editorCallback(editor);
 assert.equal(editor.applies,1,'balanced applies immediately');
 assert.equal(editor.text,'Here $x=y$ and (p).');
 const aggressive=makeEditor('Here (p).');
 commands.get('fix-math-aggressive').editorCallback(aggressive);
 assert.equal(aggressive.applies,0,'aggressive must wait for preview confirmation');
 assert.equal(modals.length,1,'one mandatory preview');
 assert.equal(modals[0].source,'Here (p).');
 assert.equal(modals[0].result.text,'Here $p$.');
 aggressive.text='Edited while modal open';
 modals[0].onApply();
 assert.equal(aggressive.text,'Edited while modal open','discard stale preview');
 assert.equal(aggressive.applies,0);
 const selected=makeEditor('Ignored initial note','[ \\frac{a}{b} ]');
 commands.get('fix-math-safe').editorCallback(selected);
 assert.equal(selected.applies,1);
 assert.equal(selected.text,'Ignored initial note','selection mode must not replace entire note');
 assert.equal(plugin.settings.detectParenMath,false,'commands do not change preferences');
 console.log('PASS math modes: safe/balanced/aggressive, code+URLs, preview+cancel/stale, selection, no preference changes');
})().catch(e=>{console.error(e);process.exitCode=1});
assert.equal(F.fixMathWithProfile('First\r\nSecond\r\n','safe').text,'First\r\nSecond\r\n','unchanged CRLF remains untouched');
assert.ok(F.fixMathWithProfile('Eq \\(x=y\\)\r\n', 'safe').text.includes('\r\n'),'CRLF preserved for converted math');
assert.equal(F.fixMathWithProfile('| Group | Math |\n|---|---|\n| A | [ \\frac{x}{2} ] |','balanced').text,'| Group | Math |\n|---|---|\n| A | [ \\frac{x}{2} ] |','never replace bracket math with display block inside table');
