'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const {EventEmitter}=require('node:events');
let dnsAddress='8.8.8.8', expectedBytes=Buffer.from('<html><head><title>Safe</title></head></html>'), returnRedirect=null, requests=0;
const fakeDns={lookup(_host,_opts,done){done(null,[{address:dnsAddress,family:4}]);}};
const fakeHttps={get(url,opts,onResponse){
  requests++;
  const req=new EventEmitter();req.destroy=e=>queueMicrotask(()=>req.emit('error',e));
  queueMicrotask(()=>{
    opts.lookup(new URL(url).hostname,{all:false},(err)=>{
      if(err){req.emit('error',err);return;}
      const res=new EventEmitter();res.statusCode=returnRedirect?302:200;
      res.headers=returnRedirect?{location:returnRedirect}:{'content-type':expectedBytes[0]===60?'text/html':'image/png','content-length':String(expectedBytes.length)};
      res.destroy=()=>res.emit('error',Error('body limit'));res.resume=()=>{};
      onResponse(res);
      if(!returnRedirect){res.emit('data',expectedBytes);res.emit('end');}
    });
  });
  return req;
}};
const old=Module._load;
Module._load=function(id,...args){
 if(id==='obsidian')return {Plugin:class{},PluginSettingTab:class{},Setting:class{},Notice:class{},Modal:class{},htmlToMarkdown:x=>x};
 if(id==='node:dns')return fakeDns;
 if(id==='node:https')return fakeHttps;
 return old.call(this,id,...args);
};
const funcs=require('../main.js')._internal;
(async()=>{
  assert.equal(funcs.isPublicAddress('127.0.0.1'),false);
  assert.equal(funcs.isPublicAddress('192.168.1.5'),false);
  assert.equal(funcs.isPublicAddress('::ffff:7f00:1'),false);
  assert.equal(funcs.isPublicAddress('::1'),false);
  assert.equal(funcs.isPublicAddress('8.8.8.8'),true);
  let response=await funcs.boundedNodeTitleHtml('https://example.com/',1024);
  assert.match(response.text,/<title>Safe<\/title>/);
  const prior=requests;dnsAddress='10.0.0.2';
  await assert.rejects(funcs.boundedNodeTitleHtml('https://example.com/',1024),/Non-public DNS/);
  assert.equal(requests,prior+1);
  dnsAddress='8.8.8.8';
  await assert.rejects(funcs.boundedNodeTitleHtml('https://127.0.0.1/private',1024),/Unsafe webpage/);
  returnRedirect='https://localhost/internal';
  await assert.rejects(funcs.boundedNodeTitleHtml('https://example.com/',1024),/Unsafe webpage/);
  returnRedirect=null;
  expectedBytes=Buffer.concat([Buffer.from("<html>"),Buffer.alloc(2048,40)]);
  await assert.rejects(funcs.boundedNodeTitleHtml('https://example.com/',1024),/too large|limit|exceeded/i);
  expectedBytes=Buffer.from([137,80,78,71,0,255]);
  response=await funcs.boundedNodeTitleHtml('https://example.com/photo.png',1024,0,'image');
  assert.deepEqual([...new Uint8Array(response.arrayBuffer)], [...expectedBytes]);
  Module._load=old;
  console.log('PASS bounded network: HTTPS, private DNS/IP deny, redirect deny, body limit, safe binary data');
})().catch(e=>{Module._load=old;console.error(e);process.exitCode=1;});
