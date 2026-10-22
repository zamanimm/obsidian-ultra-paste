import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

MAIN = Path(__file__).resolve().parent.parent / 'main.js'
HTML = (Path(__file__).resolve().parent / 'fixtures' / 'clipboard-rich-test.html').read_text()

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page = await browser.new_page()
        await page.goto('about:blank')
        # Minimal converter in this browser-only test. In actual Obsidian the native converter is used.
        await page.evaluate('''() => {
          window.module = {exports:{}};
          window.require = name => {
            if(name!=='obsidian') throw Error(name);
            return {Plugin:class{}, PluginSettingTab:class{}, Setting:class{}, Notice:class{}, Modal:class{},
              htmlToMarkdown: html => {
                const d=new DOMParser().parseFromString(html,'text/html');
                const root=d.body;
                function convert(n){
                  if(n.nodeType===3)return n.textContent;
                  if(n.nodeType!==1)return '';
                  const inner=Array.from(n.childNodes).map(convert).join('');
                  if(n.tagName==='STRONG'||n.tagName==='B')return '**'+inner+'**';
                  if(n.tagName==='EM'||n.tagName==='I')return '*'+inner+'*';
                  if(n.tagName==='H1')return '# '+inner+'\\n\\n';
                  if(n.tagName==='H2')return '## '+inner+'\\n\\n';
                  if(n.tagName==='P')return inner+'\\n\\n';
                  if(n.tagName==='A')return '['+inner+']('+n.getAttribute('href')+')';
                  if(n.tagName==='BR')return '\\n';
                  return inner;
                }
                return convert(root);
              }
            };
          };
        }''')
        await page.add_script_tag(content=MAIN.read_text())
        res = await page.evaluate('''html => {
          const f=window.module.exports._internal;
          const settings={ mode:'rich',convertMath:true,cleanTracking:true,normalizeHeadings:true,condenseBlankLines:true,
            preferPlainMarkdown:true, enableCustomRules:false, wrapSelectedTextWithUrl:true,rules:[]};
          return f.formatPaste('',html,settings,{mode:'rich'});
        }''',HTML)
        assert '```\nimport pandas as pd\ndata = {' in res, res
        assert 'url = "https://example.com/?utm_source=KEEP"' in res, res
        assert '[Tracked link](https://example.com/research?id=42)' in res, res
        assert '**bold text**' in res, res
        assert 'Sample_ID: PDAC_001\nDOI:' in res, res
        math_test = '<p>Math <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><annotation encoding="application/x-tex">x+1</annotation></semantics></math></span></span></p>'
        res2 = await page.evaluate('''html => window.module.exports._internal.htmlToSafeMarkdown(html)''',math_test)
        assert '$x+1$' in res2, res2
        link_tests = await page.evaluate('''() => {
          const f=window.module.exports._internal;
          return {
            title:f.titleFromHtml('<html><head><title>A &amp; B [Test]</title></head><body></body></html>'),
            labeled:f.htmlProvidesLinkLabel('<a href=\"https://example.com/\">Named Link</a>','https://example.com/'),
            unlabeled:f.htmlProvidesLinkLabel('<a href=\"https://example.com/\">https://example.com/</a>','https://example.com/'),
            titled:f.titledMarkdown('https://example.com/path(x)','A & B | Title')
          };
        }''')
        assert link_tests['title'] == 'A & B [Test]', link_tests
        assert link_tests['labeled'] is True and link_tests['unlabeled'] is False, link_tests
        assert link_tests['titled'] == '[A & B \\| Title](<https://example.com/path(x)>)', link_tests
        print('PASS browser DOM fixture: rich HTML, protected code, math annotations, HTML page titles, escaping and pre-labeled links')
        await browser.close()

asyncio.run(run())
