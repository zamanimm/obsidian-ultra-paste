# 🚀 Ultra Paste

**A smarter, safer clipboard for Obsidian — Markdown, AI text, math, links, PDFs, images, and custom rules in one plugin.**

**Version:** `0.2.1` · **Platform:** Desktop & Mobile · **License:** MIT · **Built with:** Plain JavaScript (no build required to install)

Ultra Paste helps turn content copied from browsers, AI assistants, articles, PDFs, and other apps into useful Obsidian notes. It combines smart formatting with *explicit escape hatches*: paste exactly what you copied, preview the result, or choose a specialized command when needed.

> [!IMPORTANT]
> **Strict plain paste means strict plain paste.** `Ctrl/Cmd + Shift + V` inserts the clipboard's `text/plain` without regex rules, title fetching, whitespace cleanup, LaTeX repair, URL rewriting, HTML conversion, or any other Ultra Paste transformation. Text already selected in the editor is replaced as with a normal paste; the *clipboard text itself* is not rewritten.

## ✨ Feature overview

### 🧠 Smart Paste & clipboard handling

- ✅ **Automatic clipboard detection** using an ordered detector pipeline: code context → standalone web URL → rich HTML or text, with a native Obsidian fallback when no detector claims the paste.
- ✅ **Three paste modes:** **Auto** (recommended), **Prefer rich HTML**, and **Plain text only**.
- ✅ **Rich HTML → Markdown:** preserve headings, emphasis, links, lists, tables, blockquotes, and code where supported by the clipboard HTML and Obsidian's converter.
- ✅ **AI/chat cleanup:** repair common copied-markdown formatting, heading artifacts, extra blank lines, and optionally remove synthetic AI citation markers.
- ✅ **Markdown-first option:** keep already useful plain-text Markdown instead of unnecessarily rebuilding it from HTML.
- ✅ **Protected content:** keep fenced code, inline code, existing math, and other protected spans out of ordinary prose transformations.
- ✅ **Code-friendly paste:** detect when the cursor is inside a code fence or inline code and insert plain clipboard text without smart formatting.
- ✅ **Smart large-paste fallback:** unusually large ordinary clipboard payloads are left to Obsidian's native paste handling.
- ✅ **Multi-format safety:** image-plus-meaningful-text clipboard content is handed back to Obsidian rather than silently discarding the text.
- ✅ **Preview before insertion:** inspect plain text, clipboard HTML, and proposed Markdown; choose **Insert formatted**, **Insert original**, or **Cancel**.
- ✅ **Raw HTML command:** insert clipboard `text/html` *as literal HTML source*, preserving markup and inline styles supplied by the clipboard (not the same as HTML → Markdown).
- ✅ **Reader-style article extraction:** an optional command extracts the main article content from copied HTML using a lightweight built-in extractor; regular Smart Paste never strips content as if it were a full article.

### 🧮 AI & LaTeX math repair

- ✅ Convert `\(...\)` → `$...$` and `\[...\]` → `$$...$$`.
- ✅ Extract LaTeX from common **KaTeX**, **MathJax**, and **MathML** clipboard markup, including TeX annotations when present.
- ✅ Recover clear AI-generated math in `[ formula ]` blocks, including multiline and quoted equations.
- ✅ Recognize selected nested-bracket, matrix, and AI heading-export artifacts.
- ✅ Preserve existing `$...$` / `$$...$$`, code, links, citations, and typical Markdown constructs where recognized.
- ✅ Optional plain-parentheses detection, such as `(x=y)`; **off by default** because it can modify ordinary prose.
- ✅ Optional experimental repair of ambiguous matrix separators; **off by default**.
- ✅ Three **on-demand math commands**:
  - 🛡️ **Safe:** conservative delimiter and obvious-expression repair.
  - ⚖️ **Balanced:** broader mathematical-pattern detection and limited structural repair.
  - 🪄 **Aggressive:** additional heuristic fixes with a **mandatory before/after preview**.
- ✅ Commands operate on the **selection** or, if nothing is selected, the **current note**. They do **not** change your normal Smart Paste settings.
- ✅ Counts and reports repaired expressions when running manual math commands.

### 🔗 Links & URL cleanup

- ✅ Remove common tracking query parameters, including `utm_*`, `fbclid`, `gclid`, and similar identifiers, while retaining other parameters.
- ✅ Automatically fetch the **page title** of a single pasted public web URL (**enabled by default**).
- ✅ Use selected text as the Markdown link label when you paste a URL over a selection.
- ✅ Preserve already-labeled links rather than needlessly changing their titles.
- ✅ Escape special Markdown characters in fetched titles.
- ✅ Configure excluded websites and a maximum title length.
- ✅ Keep the original URL if a title cannot be retrieved; skip local/private addresses and obvious non-page assets.
- ✅ Use limited network requests for title retrieval. Mobile WebView restrictions may prevent some lookups.

### 🧱 Smart Structure Paste

- ✅ **Nested lists:** rebase indentation when a pure Markdown list is pasted into another list item.
- ✅ **Checklists:** preserve checkbox markers and relative nesting where the list format is recognized.
- ✅ **Blockquotes & callouts:** continue the existing quote prefix across the pasted lines.
- ✅ **Context-aware activation:** structure changes run only when the destination matches a supported pattern.
- ✅ Two independent default-on toggles: **Keep nested list indentation** and **Continue blockquotes and callouts**.
- ✅ **Never** runs for strict plain paste.

### 📄 Clean PDF Text

- ✅ Dedicated **selection-only Command Palette action**; no automatic PDF cleanup during ordinary paste.
- ✅ Rejoin lines wrapped by a PDF page layout.
- ✅ Repair common hyphenated words split across lines.
- ✅ Expand typographic ligatures such as `ﬁ` → `fi`.
- ✅ Try to preserve recognized Markdown structure, links, code fences, and display math.
- ✅ Optional **Remove isolated page numbers** and **Join prose into one paragraph** switches, both initially off.
- ✅ Review **Original selection** and **Cleaned preview**, then **Apply cleaned text** or **Cancel**.

### 🖼️ Smart Image Paste

- ✅ Handle actual pasted/dropped image files without taking over unrelated attachments.
- ✅ Support recognized PNG, JPEG, WebP, GIF, BMP, and AVIF image clipboard types.
- ✅ Show an optional **image preview**, size, dimensions (when available), proposed filename, and destination before saving.
- ✅ **Automatic filename templates**, with tokens: `{{noteName}}`, `{{date}}`, `{{datetime}}`, `{{counter}}`, `{{originalName}}`, `{{imageNameKey}}`, and `{{frontmatter:key}}`.
- ✅ **Collision-safe names:** allocate distinct names instead of overwriting existing files.
- ✅ **Duplicate detection:** reuse an identical destination image using SHA-256 when hashing is available.
- ✅ Follow Obsidian's native attachment location by default; optionally use per-note `images/<note-name>/` folders.
- ✅ Optional display-width limits for portrait and landscape images, without resampling the underlying file.
- ✅ Optional image compression/resizing (off by default). Original GIF animations are not recompressed.
- ✅ Respect Obsidian's preferred Markdown-link or Wikilink style for image embeds.
- ✅ Command to **download an image from a public HTTPS URL**, only after an explicit user action (up to 25 MB, subject to response checks).
- ✅ Command to **rename the image at the cursor** with confirmation using Obsidian's file-management mechanisms.
- ✅ Safer async handling: check the destination note before inserting image links. If the note changed after files were saved, insertion is canceled rather than writing into the wrong note.
- ✅ No automatic mass moves, deletion of image folders, or image-URL downloads on ordinary paste.

### 🧩 Custom rules & configuration

- ✅ Ordered **regex find-and-replace rules**, with individual enable/disable switches and Move Up / Move Down buttons.
- ✅ Two rule scopes: **Prose only** (protects code, math, and URLs) and **All content** (potentially unsafe).
- ✅ Support regex flags, capture-group replacements (`$1`, `$2`, …), and `$SEL` for the editor selection.
- ✅ Optional **JavaScript rules** with matching context; **disabled globally by default** and not sandboxed.
- ✅ Import an Ultra Paste settings JSON or supported **Paste Transform** rule export. Imported JavaScript rules remain disabled until explicitly reviewed.
- ✅ Export settings to JSON through the clipboard.
- ✅ Preserve the Settings page scroll position when adding, deleting, moving, or changing a rule's type.
- ✅ Toggle the entire automatic Smart Paste engine from the Command Palette; manual specialized commands remain available.
- ✅ Optional paste-success notices and debug logging (both off by default).

### 🔒 Performance, privacy & compatibility

- ✅ Optimized protected-span restoration for large Markdown/math pastes.
- ✅ Guard asynchronous clipboard, preview, and link-title operations against note/cursor changes where supported.
- ✅ Protect the ordinary paste workflow with native-Obsidian fallbacks.
- ✅ Support **Obsidian Desktop and Mobile** (`isDesktopOnly: false`).
- ✅ Avoid requiring Node.js or Electron on mobile; use Web Crypto where available for image hashes.
- ✅ Provide a mobile **one-shot system Plain Paste** command for platforms that block direct clipboard reads.
- ✅ No analytics or telemetry implemented by Ultra Paste. Website-title requests and *manually requested* image downloads connect to the respective remote sites.

## ⌨️ Keyboard shortcuts

| Shortcut | Action | What it does |
|---|---|---|
| **`Ctrl + V`** (Windows/Linux) or **`Cmd + V`** (macOS) | **Smart Paste** | Detect clipboard content and apply enabled formatting features. |
| **`Ctrl + Shift + V`** or **`Cmd + Shift + V`** | **Strict Plain Paste** | Insert exact clipboard `text/plain`; no Ultra Paste replacements or processing. |
| **`Ctrl + Alt + V`** or **`Cmd + Option + V`** | **Preview Paste** | Review clipboard and formatted output before choosing what to insert. |
| **`Ctrl/Cmd + P`** | **Obsidian Command Palette** | Search `Ultra Paste` to access the specialized commands below. |

> [!TIP]
> If another plugin or a custom Obsidian hotkey uses one of these shortcuts, check **Settings → Hotkeys** for conflicts. Shortcut availability also depends on the operating system and physical keyboard.

## 🎛️ Command Palette reference

Open **`Ctrl/Cmd + P`**, then type **`Ultra Paste`**.

| Command name (searchable text) | How to use it |
|---|---|
| **Toggle Ultra Paste** | Enable or disable automatic Smart Paste interception. |
| **Preview clipboard and paste** | Compare source and output; insert formatted text, insert original plain text, or cancel. |
| **Paste as plain text (no transforms)** | Paste `text/plain` literally, without running rules or cleanup. |
| **Paste next OS clipboard event as plain text (mobile)** | Arm a one-time plain paste, then invoke the device's normal **Paste** within **20 seconds**. Useful if direct clipboard access is blocked. |
| **Paste rich HTML from clipboard** | Convert clipboard HTML to Markdown, preferring the rich input. |
| **Paste as HTML (raw clipboard HTML)** | Insert the literal clipboard HTML source, including available inline styles, without Markdown conversion. |
| **Paste article from clipboard (reader extraction)** | Copy web/article content, then request a best-effort main-content extraction. |
| **Fix AI math in selection or current note** | Run the standard manual math repair command on the selection or entire note. |
| **Fix Math — Safe (selection or note)** | Run conservative math repair immediately (Undo is available). |
| **Fix Math — Balanced (selection or note)** | Apply broader math repair to the selection or note. |
| **Fix Math — Aggressive (preview required)** | Compare original and repaired math; **Apply repaired math** or cancel. |
| **Clean PDF text in selection (preview)** | Select text copied from a PDF, set optional cleanup switches, review, then apply. |
| **Save image from clipboard URL (confirm)** | Copy a single public HTTPS image URL, run the command, then review/confirm naming and saving. |
| **Rename image at cursor (confirm)** | Place the cursor on a supported embedded image link and run the rename dialog. |

### 📱 Mobile quick guide

1. Use your device's regular **Paste** action for Smart Paste; it uses whatever clipboard formats the operating system exposes.
2. To bypass *all* processing, run **Paste next OS clipboard event as plain text (mobile)**, then tap the device's **Paste** action within 20 seconds.
3. Consider adding your favorite Ultra Paste commands to Obsidian's **Mobile Toolbar**.
4. Direct clipboard HTML reading and certain network requests may be restricted by Android, iOS, or the embedded WebView. When unavailable, the command should report the limitation rather than inventing clipboard content.

## ⚙️ Recommended settings

All controls live under **Settings → Community plugins → Ultra Paste**.

| Setting | Default | Recommendation |
|---|---|---|
| Smart Paste enabled | **On** | Keep on for routine use. |
| Paste mode | **Auto** | Prefer Auto unless you consistently copy rich HTML. |
| Prefer existing Markdown | **On** | Preserve properly structured AI Markdown. |
| Protect code | **On** | Strongly recommended. |
| Convert AI math delimiters | **On** | Reliable delimiter normalization. |
| Repair AI bracket math | **On** | Conservative bracket repairs. |
| Detect bare parenthesis math | **Off** | Enable only for documents that need it. |
| Repair ambiguous formula formatting | **Off** | Experimental; check results manually. |
| Clean link tracking | **On** | Remove common trackers. |
| Auto-fetch link titles | **On** | Turn off if you do not want title-network requests. |
| Keep nested list indentation | **On** | Context-sensitive. |
| Continue blockquotes and callouts | **On** | Context-sensitive. |
| Smart Image Paste | **On** | Uses image files from the clipboard. |
| Image naming preview | **On** | Review names/paths before saving. |
| Image duplicate detection | **On** | Reuse identical files where supported. |
| Per-note image folders | **Off** | Default to your Obsidian attachment settings. |
| Auto image display width | **Off** | Optional for visual consistency. |
| Image compression | **Off** | Keep originals unless size matters. |
| JavaScript rules | **Off** | Enable only for code you trust. |
| Remove synthetic AI citations | **Off** | Opt in only if those markers are unwanted. |

### 🧪 Simple custom rule example

Add a **Regular expression** rule under *Custom rules*, then enable it:

- **Name:** Replace TODO
- **Pattern:** `\bTODO\b`
- **Flags:** `g`
- **Replacement:** `Task`
- **Scope:** `Prose only`

JavaScript rules run with Obsidian/plugin privileges and are **not sandboxed**. Do not import executable rules from untrusted sources. Synchronous JavaScript is supported; asynchronous script rules are not.

## 📦 Installation and updates

**Requirements:** Obsidian **1.5.0 or newer** on Windows, macOS, Linux, Android, or iOS. The plugin includes the ready-to-run JavaScript bundle: no `npm install`, TypeScript compiler, or build step is required for installation.

1. Download the Ultra Paste release ZIP and extract it.
2. Find your vault's plugin directory: `<your-vault>/.obsidian/plugins/`.
3. Copy the extracted **`ultra-paste`** folder into that directory. At minimum, Obsidian needs `main.js` and `manifest.json`.
4. In Obsidian, open **Settings → Community plugins**, and enable **Ultra Paste**.
5. If you previously installed an older version, **back up and preserve** `.obsidian/plugins/ultra-paste/data.json` before replacing the plugin files.
6. Disable other plugins that intercept the same paste events, at least while testing, to avoid duplicate or conflicting transformations.

> [!NOTE]
> The install ZIP contains JavaScript already ready for Obsidian. The separate source/test package is only for inspection and regression testing. Mobile support has passed simulated-runtime checks, but has **not yet been verified on physical Android and iOS devices**.

## 💡 Everyday workflows

- **Copy from ChatGPT or a website → `Ctrl/Cmd + V`:** keep useful Markdown, repair supported LaTeX delimiters, and clean common URL trackers.
- **Need untouched data or code → `Ctrl/Cmd + Shift + V`:** insert only raw clipboard plain text, preserving its exact characters and line breaks as delivered by the clipboard API.
- **Not sure what will change → `Ctrl/Cmd + Alt/Option + V`:** compare and choose the result manually.
- **Copy a long article → `Paste article from clipboard`:** extract the central content when a reader-style result is desired.
- **Copy from a PDF → select the pasted text → `Clean PDF text in selection (preview)`:** repair wrapping only after checking the preview.
- **Math notation looks broken → `Fix Math — Safe` / `Balanced` / `Aggressive`:** escalate only as needed.
- **Paste an image → naming preview:** confirm a meaningful name or cancel; duplicates can be reused instead of saved twice.

## 🛡️ Known limits and safety notes

- Ultra Paste cannot reconstruct line breaks that were *already missing* from the original clipboard text.
- Math recovery is heuristic beyond explicit LaTeX delimiters. Review **Balanced** and especially **Aggressive** changes in important academic notes.
- The included article reader is a lightweight implementation, **not the full Defuddle library**.
- Some MathML, complex HTML layouts, CSS-based formatting, and remote page titles may not survive or be available through the clipboard.
- Mobile clipboard APIs and cross-origin networking vary across devices; title fetching and manual image downloads may fail for restricted sites.
- A text-only clipboard cannot reproduce a binary image through **Strict Plain Paste**; this is intentional.
- For safety, certain asynchronous operations are canceled if you change the target note, cursor, or selection before they complete.
- Automatic image-folder deletion, mass relocation, and automatic web-image downloads are intentionally **not implemented**.
- Custom JavaScript rules run with plugin privileges. Review them carefully and keep backups of your vault and settings.

## 🙏 Acknowledgements

💜 Many thanks to the creators and contributors of [Clean AI Paste](https://github.com/GoSlowPoke168/obsidian-clean-ai-paste), [Paste Transform](https://github.com/rekby/obsidian-paste-transform), [Defuddle](https://github.com/kepano/defuddle), [Auto Link Title](https://github.com/zolrath/obsidian-auto-link-title), [Fix Math](https://github.com/loglux/fix-math-for-obsidian), [Paste as HTML](https://github.com/maotong06/obsidian-paste-as-html-plugin), [Better Paste](https://github.com/johansan/better-paste), [Paste Plus](https://github.com/jabaho9523/obsidian-paste-plus), [Paste Image Rename](https://github.com/reorx/obsidian-paste-image-rename), and [Smart Paste Image](https://github.com/acblbtpccc/obsidian-smart-paste-image) for sharing their work and inspiring Ultra Paste. 🙏

## 📜 License

MIT License — see [LICENSE](LICENSE).

---

**✨ Paste smarter when you want. Paste exactly when you need.**
