'use strict';
const assert=require('node:assert/strict');const Module=require('node:module');
const old=Module._load;
Module._load=function(id,...args){if(id==='obsidian')return {Plugin:class{},PluginSettingTab:class{},Setting:class{},Notice:class{},Modal:class{},htmlToMarkdown:x=>x};return old.call(this,id,...args);};
const f=require('../main.js')._internal;Module._load=old;
const cases=require('./fixtures/output-parity-v019.json');
const settings={mode:'plain',convertMath:true,detectBracketMath:true,detectParenMath:false,repairMathArtifacts:false,cleanTracking:true,normalizeHeadings:true,condenseBlankLines:true,preserveCode:true,preferPlainMarkdown:true,stripAIReferences:false,wrapSelectedTextWithUrl:true,enableCustomRules:true,allowJavaScriptRules:false,rules:[]};
for(let n=0;n<cases.length;n++){
 const c=cases[n];assert.equal(f.formatPaste(c.input,'',settings),c.output,'v0.1.9 output parity '+n);
 const mask=f.protectMarkdown(c.input,{links:c.links,math:true});
 assert.equal(mask.restore(mask.text),c.restored,'code/math protected roundtrip '+n);
}
console.log('PASS parity: '+cases.length+' reference cases match v0.1.9 output');
