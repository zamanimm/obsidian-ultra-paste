"""Regression check: structural settings changes must not reset scroll to top.
This uses a minimal Obsidian Settings mock and Chromium DOM, not real Obsidian.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

MAIN = (Path(__file__).resolve().parents[1] / 'main.js').read_text()

MOCK = r'''() => {
  class SettingTab {
    constructor(app,plugin){this.app=app;this.plugin=plugin;this.containerEl=document.querySelector('#settings');}
  }
  class Builder {
    constructor(el){this.el=el;this.cb=null;}
    setValue(v){this.el.value=v;return this;}
    setPlaceholder(s){this.el.placeholder=s;return this;}
    setDisabled(v){this.el.disabled=!!v;return this;}
    setButtonText(v){this.el.textContent=v;return this;}
    setTooltip(v){this.el.title=v;return this;}
    setIcon(v){this.el.textContent=v;return this;}
    setCta(){return this;}
    addOption(value,label){const opt=document.createElement('option');opt.value=value;opt.textContent=label;this.el.appendChild(opt);return this;}
    onClick(fn){this.el.addEventListener('click',fn);return this;}
    onChange(fn){this.el.addEventListener('change',()=>fn(this.el.type==='checkbox'?this.el.checked:this.el.value));return this;}
  }
  class Setting {
    constructor(parent){this.el=document.createElement('div');this.el.className='setting';parent.append(this.el);}
    setName(v){this.el.dataset.name=v;const l=document.createElement('span');l.textContent=v;this.el.append(l);return this;}
    setDesc(){return this;}
    _add(tag,type,cb){let el=document.createElement(tag);if(type)el.type=type;this.el.append(el);cb(new Builder(el));return this;}
    addButton(cb){return this._add('button','button',cb);}
    addExtraButton(cb){return this._add('button','button',cb);}
    addDropdown(cb){return this._add('select',null,cb);}
    addToggle(cb){let el=document.createElement('input');el.type='checkbox';this.el.append(el);const b=new Builder(el);b.setValue=function(v){el.checked=v;return this;};cb(b);return this;}
    addText(cb){return this._add('input','text',cb);}
    addTextArea(cb){return this._add('textarea',null,cb);}
  }
  window.HTMLElement.prototype.empty=function(){this.innerHTML='';};
  window.HTMLElement.prototype.createEl=function(tag,opts){const e=document.createElement(tag);if(opts?.text)e.textContent=opts.text;this.append(e);return e;};
  window.HTMLElement.prototype.createDiv=function(){return this.createEl('div');};
  class Plugin {
    constructor(){this.app={workspace:{on:()=>{}}};this.saved=null;}
    async loadData(){return null;}
    addSettingTab(tab){this.tab=tab;}
    registerEvent(){} registerDomEvent(){} addCommand(){}
    async saveData(x){this.saved=JSON.parse(JSON.stringify(x));}
  }
  window.module={exports:{}};
  window.require=()=>({Plugin,PluginSettingTab:SettingTab,Setting,Modal:class {},Notice:class{},htmlToMarkdown:x=>x});
  window.requestAnimationFrame=cb=>{window._pendingRaf=cb;};
}'''

async def test():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=await browser.new_page()
        await page.set_content('<style>#pane{height:360px;overflow-y:auto;width:750px}.setting{min-height:40px;display:flex;gap:4px;align-items:center}input[type=text]{max-width:100px}</style><div id="pane"><div id="settings"></div></div>')
        await page.evaluate(MOCK)
        await page.add_script_tag(content=MAIN)
        state=await page.evaluate('''async () => {
          const P=window.module.exports, plugin=new P(); await plugin.onload();
          plugin.settings.rules=Array.from({length:6},(_,i)=>({id:'rule'+i,name:'Rule'+i,enabled:false,type:'regex',scope:'prose',pattern:'',flags:'g',replacement:''}));
          const tab=plugin.tab; tab.display();
          window.plugin=plugin;
          window.tab=tab;
          const pane=document.querySelector('#pane');
          const info=[];
          async function testAction(label, before, element) {
            pane.scrollTop=before;
            const original=pane.scrollTop;
            element.click();
            await new Promise(r=>setTimeout(r,30));
            if(window._pendingRaf){window._pendingRaf();window._pendingRaf=null;}
            info.push({label,original,current:pane.scrollTop});
          }
          await testAction('add',600, Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Add new rule'));
          await testAction('move up',500, Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='↑'&&!x.disabled));
          await testAction('delete',450, Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='trash'));
          pane.scrollTop=575;
          let sel=Array.from(document.querySelectorAll('select')).find(x=>Array.from(x.options).some(o=>o.value==='javascript'));
          const before=pane.scrollTop;
          sel.value='javascript';sel.dispatchEvent(new Event('change',{bubbles:true}));
          await new Promise(r=>setTimeout(r,30));
          if(window._pendingRaf){window._pendingRaf();window._pendingRaf=null;}
          info.push({label:'change type',original:before,current:pane.scrollTop});
          return {info,savedRules:plugin.saved?.rules?.length};
        }''')
        for x in state['info']:
            assert x['original']>100, x
            assert abs(x['original']-x['current'])<3, f"Jumped: {x}"
        assert state['savedRules']==6, state
        print('PASS settings scroll after add / move / delete / type change:',state['info'])
        await browser.close()

asyncio.run(test())
