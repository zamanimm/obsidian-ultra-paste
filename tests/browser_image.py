import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

MAIN = (Path(__file__).resolve().parent.parent / 'main.js').read_text()

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = await browser.new_page()
        await page.goto('about:blank')
        await page.evaluate('''() => {
            HTMLElement.prototype.createEl = function(tag,opts={}) {
              const e=document.createElement(tag);
              if(opts.text!==undefined)e.textContent=opts.text;
              this.appendChild(e);return e;
            };
            HTMLElement.prototype.setText = function(s){this.textContent=s;};
            HTMLElement.prototype.empty = function(){this.replaceChildren();};
            window.errorLogs=[];
            const priorError=console.error;console.error=(...a)=>{window.errorLogs.push(a.map(String).join(' '));priorError(...a);};
            Object.defineProperty(window,'crypto',{value:{subtle:{digest:async(_name,b)=>b instanceof ArrayBuffer?b:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}}});
            window.testCommands=new Map();
            window.assetFiles=new Map();
            const file={path:'Research/Lecture.md',basename:'Lecture',extension:'md'};
            const app={
              workspace:{on:()=>({}),getActiveFile:()=>file,activeEditor:null},
              metadataCache:{getFileCache:()=>({frontmatter:{imageNameKey:'research'}})},
              fileManager:{
                getAvailablePathForAttachment:async n=>'assets/'+n,
                generateMarkdownLink:f=>'[['+f.name+']]'
              },
              vault:{
                getAbstractFileByPath:p=>assetFiles.get(p)||null,
                getFiles:()=>[...assetFiles.values()],
                createFolder:async()=>{},
                createBinary:async(path,buf)=>{
                  if(assetFiles.has(path))throw Error('duplicate path');
                  const f={path,name:path.split('/').pop(),stat:{size:buf.byteLength},data:buf};
                  assetFiles.set(path,f);return f;
                },
                readBinary:async f=>f.data,
              }
            };
            window.PluginMock=class{
              constructor(){this.app=app;}
              async loadData(){return null;}
              registerDomEvent(){}registerEvent(){}addSettingTab(){}
              addCommand(cmd){testCommands.set(cmd.id,cmd);}
            };
            window.ModalMock=class{
              constructor(app){this.contentEl=document.createElement('div');this.contentEl.className='test-modal';document.body.appendChild(this.contentEl);this.app=app;}
              open(){this.onOpen?.();window.activeImageModal=this;}
              close(){this.onClose?.();this.contentEl.remove();}
            };
            window.SettingMock=class{
              constructor(parent){this.row=parent.createEl('div');}
              setName(s){this.row.createEl('label',{text:s});return this;}
              setDesc(){return this;}
              addText(cb){const input=this.row.createEl('input');
                const api={inputEl:input,setValue:v=>{input.value=v;return api;},onChange:f=>{input.addEventListener('input',()=>f(input.value));return api;}};
                cb(api);return this;}
              addButton(cb){const el=this.row.createEl('button');const api={setButtonText:v=>{el.textContent=v;return api;},setCta:()=>api,onClick:f=>{el.addEventListener('click',f);return api;}};cb(api);return this;}
            };
            window.module={exports:{}};
            window.require=n=>{
              if(n!=='obsidian')throw Error(n);
              return {Plugin:PluginMock,Modal:ModalMock,PluginSettingTab:class{},Setting:SettingMock,Notice:class{},htmlToMarkdown:s=>s,requestUrl:async()=>{throw Error('No requests expected')}};
            };
            window.makeEditor=()=>{
              let value='Lesson';let text='';
              const ed={getValue:()=>value,getCursor:()=>({line:0,ch:value.length}),getSelection:()=>'',replaceSelection:s=>{text=s;value+=s;},getInserted:()=>text};
              return ed;
            };
        }''')
        await page.add_script_tag(content=MAIN)
        result = await page.evaluate('''async () => {
          const plugin=new module.exports();await plugin.onload();
          plugin.settings.imageAutoWidth=true;plugin.settings.imagePortraitWidth=20;
          const canvas=document.createElement('canvas');canvas.width=40;canvas.height=80;
          canvas.getContext('2d').fillRect(0,0,40,80);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
          const file=new File([blob],'screenshot.png',{type:'image/png'});
          const editor=makeEditor();
          const evt={defaultPrevented:false,clipboardData:{types:['Files'],files:[file]},preventDefault(){this.prevented=true},stopPropagation(){}};
          plugin.onEditorPaste(evt,editor);
          // modal includes an actual image loaded from an object URL in Chromium
          await new Promise(resolve=>setTimeout(resolve,70));
          const modal=document.querySelector('.test-modal');
          if(!modal)throw Error('Modal missing');
          if(!modal.querySelector('img')?.naturalWidth)throw Error('Image preview did not load');
          const initialName=modal.querySelector('input').value;
          modal.querySelector('input').value='Figure overview';
          modal.querySelector('button').click();
          await new Promise(resolve=>setTimeout(resolve,100));
          const first=[...assetFiles.values()];
          if(first.length!==1)throw Error('No file saved: '+JSON.stringify(window.errorLogs));
          if(first[0].name!=='Figure overview.png')throw Error('Wrong name: '+first[0].name);
          if(editor.getInserted()!=='![[Figure overview.png|20]]')throw Error('Invalid embed '+editor.getInserted());
          const editor2=makeEditor();
          plugin.onEditorPaste({...evt,defaultPrevented:false,preventDefault(){}},editor2);
          await new Promise(resolve=>setTimeout(resolve,100));
          if(assetFiles.size!==1)throw Error('Duplicate image incorrectly created');
          if(editor2.getInserted()!=='![[Figure overview.png|20]]')throw Error('Duplicate link incorrect');
          return {initialName, inserted:editor.getInserted(), reused:editor2.getInserted(), files:assetFiles.size};
        }''')
        assert result['files']==1, result
        print('PASS Chromium image integration: actual PNG, naming modal/preview, manual filename, image width, saved embed, SHA reuse', result)
        await browser.close()

asyncio.run(run())
