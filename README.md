# 📋 Ultra Paste

**Smarter clipboard handling for Obsidian.** Paste content from websites, AI assistants, PDFs and other apps as clean Markdown, while keeping full control over what gets changed.

**Version:** `0.2.1` · **Obsidian:** `1.5.0+` · **Platform:** Desktop & Mobile · **License:** MIT

## 🚀 Getting started

Ultra Paste works with Obsidian's normal paste action. There is no separate editor or workflow to learn.

1. Copy text, a link, rich content or an image from another app.
2. Press **`Ctrl + V`** (Windows/Linux) or **`Cmd + V`** (macOS).
3. Ultra Paste detects the clipboard content and applies the enabled transformations.

Use **Preview Paste** when you want to review the result first, or **Strict Plain Paste** when you do not want Ultra Paste to change anything.

## ⌨️ Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + V` / `Cmd + V` | **Smart Paste** — detect clipboard content and apply enabled transformations. |
| `Ctrl + Shift + V` / `Cmd + Shift + V` | **Strict Plain Paste** — insert clipboard `text/plain` without Ultra Paste processing. |
| `Ctrl + Alt + V` / `Cmd + Option + V` | **Preview Paste** — review the original and formatted content before inserting. |
| `Ctrl/Cmd + P` | Open Obsidian's Command Palette and search for `Ultra Paste`. |

> **Tip:** If a shortcut conflicts with another plugin or your own hotkey, check **Settings → Hotkeys** in Obsidian.

## 🧭 Using Ultra Paste

Most of the time, just use **Smart Paste**. For specific tasks, open the Command Palette (`Ctrl/Cmd + P`) and search for the command name.

| What you want to do | How to do it |
|---|---|
| Check the result before pasting | Run **Preview clipboard and paste**. Choose **Insert formatted**, **Insert original**, or **Cancel**. |
| Paste without any cleanup or conversion | Use **Strict Plain Paste** or run **Paste as plain text (no transforms)**. |
| Convert clipboard HTML to Markdown | Run **Paste rich HTML from clipboard**. |
| Insert the original HTML source | Run **Paste as HTML (raw clipboard HTML)**. This inserts HTML as text; it does not convert it to Markdown. |
| Extract the main content of a copied article | Run **Paste article from clipboard (reader extraction)**. This is a best-effort extraction from available clipboard HTML. |
| Clean text copied from a PDF | Select the pasted PDF text, then run **Clean PDF text in selection (preview)**. Review the result and apply or cancel. |
| Repair mathematical expressions | Run one of the **Fix Math** commands. They work on the selection, or on the whole note if nothing is selected. |
| Save an image from a URL | Copy a public HTTPS image URL and run **Save image from clipboard URL (confirm)**. Review the image and filename before saving. |
| Rename an embedded image | Place the cursor on the image link and run **Rename image at cursor (confirm)**. |
| Temporarily disable automatic Smart Paste | Run **Toggle Ultra Paste**. Specialized commands remain available. |

### Math repair modes

- **Fix Math — Safe:** conservative delimiter and obvious-expression repairs.
- **Fix Math — Balanced:** broader detection and limited structural repairs.
- **Fix Math — Aggressive:** additional heuristic repairs; always shows a before/after preview.

Manual math commands do not run the other paste transformations. Review repaired equations, especially when using Balanced or Aggressive mode.

## ✨ What Smart Paste can do

### 🧠 Text, Markdown and AI content

- Convert supported rich HTML into Markdown, including headings, emphasis, links, lists, tables, quotes and code.
- Clean common formatting artifacts from copied AI responses and other text.
- Preserve existing Markdown when it is already useful.
- Protect inline code, fenced code and recognized math from ordinary prose transformations.
- Normalize selected heading formatting and excessive blank lines.
- Optionally remove synthetic AI citation markers.

### 🧮 LaTeX and mathematics

- Convert `\(...\)` and `\[...\]` into Obsidian-compatible `$...$` and `$$...$$` delimiters.
- Recover supported equations from KaTeX, MathJax and MathML clipboard markup.
- Repair selected AI-generated bracketed equations and common formatting artifacts.
- Keep optional detection of ordinary parenthesized text and experimental matrix repairs disabled by default.

### 🔗 Links

- Remove common tracking parameters such as `utm_*`, `fbclid` and `gclid` while preserving other URL parameters.
- Fetch the page title when a single public web URL is pasted.
- Turn selected text into a Markdown link when a URL is pasted over it.
- Allow websites to be excluded from automatic title lookup.

### 🧱 Lists, quotes and callouts

- Preserve relative indentation when a pure Markdown list is pasted into another list item.
- Continue blockquote and callout prefixes across pasted lines.
- Apply these changes only in supported editor contexts.

### 📄 PDF text cleanup

- Rejoin lines wrapped by PDF page layout.
- Repair common words split by line-ending hyphens.
- Expand typographic ligatures such as `ﬁ` to `fi`.
- Preview the cleaned selection before applying it.

### 🖼️ Images

- Handle actual image files pasted or dragged into the editor without taking over unrelated attachments.
- Preview the image, dimensions, destination and proposed filename before saving (when enabled).
- Generate filenames from templates such as `{{noteName}}-{{date}}-{{counter}}`.
- Avoid filename collisions and detect identical images where hashing is supported.
- Follow Obsidian's attachment location by default, or use optional per-note image folders.
- Optionally add display widths or compress/resize images. Both are disabled by default; display width does not change the original image pixels.
- Keep animated GIFs untouched by image compression.

## ⚙️ Settings

Open **Settings → Community plugins → Ultra Paste**. You do not need to change every option; the defaults are designed for everyday use.

| Setting | What it controls |
|---|---|
| **Enable Ultra Paste** | Turns automatic Smart Paste interception on or off. |
| **Paste mode** | **Auto** chooses a useful clipboard format; **Prefer rich HTML** forces HTML when available; **Plain text only** ignores clipboard HTML. |
| **Prefer existing Markdown** | Keeps useful Markdown instead of rebuilding it from its HTML representation. |
| **Protect code** | Bypasses transformations when pasting inside inline or fenced code. |
| **Math options** | Controls automatic LaTeX delimiter conversion and optional math detection/repair. |
| **Link options** | Controls tracking cleanup, title lookup, excluded websites and selected-text linking. |
| **Smart structure** | Enables nested-list indentation and quote/callout continuation. |
| **Smart Image Paste** | Controls image handling, naming, duplicate detection, folders, display width and compression. |
| **Custom rules** | Enables your own ordered text transformations. |

> **Important — Plain text only vs. Strict Plain Paste:** The **Plain text only** setting chooses `text/plain` instead of clipboard HTML, but enabled cleanup rules may still run. **Strict Plain Paste** bypasses all Ultra Paste transformations and inserts only the clipboard's `text/plain` content.

### 🧩 Custom rules

Create rules under **Custom rules** in the settings. Rules run in order after the built-in cleanup and can be enabled, disabled or moved up and down.

A simple example:

| Field | Value |
|---|---|
| Name | Replace TODO |
| Type | Regular expression |
| Pattern | `\bTODO\b` |
| Flags | `g` |
| Replacement | `Task` |
| Scope | Prose only |

- **Prose only** protects recognized code, math and URLs.
- **All content** can also modify those areas, so use it carefully.
- Regex replacements support capture groups such as `$1` and `$2`, plus `$SEL` for the editor selection.
- JavaScript rules are optional, disabled by default and **not sandboxed**. They run with Obsidian/plugin privileges; only enable code you trust.
- Import Ultra Paste settings or supported Paste Transform settings, and export your configuration as JSON.

## 📱 Mobile

1. Use your device's normal **Paste** action for Smart Paste.
2. If the app or operating system blocks direct clipboard access, run **Paste next OS clipboard event as plain text (mobile)** from the Command Palette or Mobile Toolbar.
3. Within **20 seconds**, use the device's normal **Paste** action.

Mobile clipboard formats and network access depend on Android, iOS and the embedded WebView. Mobile support has passed simulated-runtime checks, but has not yet been verified on physical Android and iOS devices.

## 📦 Installation

**Requirements:** Obsidian `1.5.0` or newer. Ultra Paste is a plain JavaScript plugin; no build step or additional runtime dependency is required for installation.

1. Download and extract the Ultra Paste release ZIP.
2. Copy the `ultra-paste` folder into your vault's `.obsidian/plugins/` directory.
3. Make sure the folder contains `main.js` and `manifest.json`.
4. In Obsidian, open **Settings → Community plugins** and enable **Ultra Paste**.

When updating, back up and preserve `.obsidian/plugins/ultra-paste/data.json` so your settings and custom rules are not lost. The source/test package is intended for development and testing; use the release package for installation.

## 🔒 Privacy, limitations and safety

- Ultra Paste does not implement analytics or telemetry.
- Automatic page-title lookup sends a request directly to the public webpage when a single URL is pasted. Disable **Auto-fetch link titles** to prevent these requests.
- Image URL downloads happen only when you explicitly run the download command. Ordinary paste does not automatically download web images.
- Complex HTML, some MathML, CSS-based layouts and certain clipboard formats may not convert perfectly.
- Math recovery beyond explicit LaTeX delimiters is heuristic. Review important equations before relying on them.
- Strict Plain Paste requires clipboard `text/plain`; it cannot recreate binary image data from an image-only clipboard.
- Some mobile clipboard and network operations may be restricted by the operating system or website.
- Custom JavaScript rules are not sandboxed. Only enable scripts you have reviewed.

## 🙏 Acknowledgements

Thanks to the developers of [Clean AI Paste](https://github.com/GoSlowPoke168/obsidian-clean-ai-paste), [Paste Transform](https://github.com/rekby/obsidian-paste-transform), [Defuddle](https://github.com/kepano/defuddle), [Auto Link Title](https://github.com/zolrath/obsidian-auto-link-title), [Fix Math](https://github.com/loglux/fix-math-for-obsidian), [Paste as HTML](https://github.com/maotong06/obsidian-paste-as-html-plugin), [Better Paste](https://github.com/johansan/better-paste), [Paste Plus](https://github.com/jabaho9523/obsidian-paste-plus), [Paste Image Rename](https://github.com/reorx/obsidian-paste-image-rename) and [Smart Paste Image](https://github.com/acblbtpccc/obsidian-smart-paste-image) for their work and inspiration.

## 📜 License

[MIT License](LICENSE).

---

**✨ Paste smarter when you want. Paste exactly when you need.**
