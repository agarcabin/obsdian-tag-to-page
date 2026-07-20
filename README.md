[English](#english) | [中文](#中文)

# Obsdian Tag to Page

## English

Obsdian Tag to Page is an Obsidian plugin that makes `#tags` behave more like Logseq: click a tag to open its `[[tag]]` note instead of opening the tag search pane.

> Current release: `1.2.3`

### Features

- **Open a note from `#tag`** — Click tags in Reading view and Live Preview to open the note with the matching name.
- **Create missing notes automatically** — If the target note does not exist, the plugin creates an empty Markdown note.
- **Resolve aliases** — Frontmatter `alias` and `aliases` values are checked when resolving a tag.
- **Support nested tags** — A tag such as `#parent/child` creates `parent/child.md` and its parent directory when needed.
- **Open in a new pane** — Hold `Ctrl` on Windows/Linux or `Cmd` on macOS while clicking.
- **Optional page completion** — Type `#` to search note names and aliases for completion suggestions.
- **Bilingual settings** — Switch the plugin interface between Chinese and English.
- **Responsive settings UI** — Clear sections, contextual guidance, and a compact layout for narrow windows and mobile screens.

### Installation

#### Using BRAT (recommended)

1. Install the [Obsidian BRAT](https://obsidian.md/plugins?id=obsidian42-brat) plugin.
2. Add `agarcabin/obsdian-tag-to-page` in BRAT settings.
3. Enable **Tag to Page** in the list of installed community plugins.

#### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [Releases](https://github.com/agarcabin/obsdian-tag-to-page/releases) page.
2. Copy them to `<your vault>/.obsidian/plugins/tag-to-page/`.
3. Enable **Tag to Page** under **Settings → Community plugins**.

The repository name is `obsdian-tag-to-page`; the plugin ID and installation directory remain `tag-to-page` for compatibility with existing installations.

### Usage

Click a `#tag` in a note. The plugin:

1. Looks for a note named `tag`.
2. Checks frontmatter `alias` and `aliases` values if the note is not found.
3. Creates `tag.md` if no matching note exists.
4. Opens the resolved note.

Together with Obsidian's backlinks pane, this provides a Logseq-like way to discover related notes through tags.

### Settings

| Setting | Description |
| --- | --- |
| Language | Switch the interface between Chinese and English. |
| Show page completion when typing `#` | Suggest matching note names and aliases. This may add some scanning overhead. |

### How it works

- **Click interception** — Captures clicks on `.tag` and `.cm-hashtag` elements during the DOM capture phase and prevents the default tag-search behavior.
- **Note resolution** — Uses `metadataCache.getFirstLinkpathDest()` and scans frontmatter aliases to resolve the destination.
- **Completion** — Uses CodeMirror 6 autocomplete to provide suggestions from Markdown note names and aliases.

### Known limitations

- Enabling `#` page completion replaces the default `[[` page completion provider.
- Tag clicks are not supported in Source mode.

### Development

```bash
git clone https://github.com/agarcabin/obsdian-tag-to-page.git
cd obsdian-tag-to-page
npm install
npm run dev    # watch mode
npm run build  # production build
```

## 中文

Obsdian Tag to Page 是一个 Obsidian 插件，让 `#标签` 的行为更像 Logseq：点击标签后直接打开对应的 `[[标签]]` 页面，而不是打开标签搜索面板。

> 当前版本：`1.2.3`

### 功能

- **点击 `#tag` 打开页面** — 在阅读视图和实时预览中点击标签，直接打开同名笔记。
- **自动创建不存在的页面** — 目标笔记不存在时，自动创建空白 Markdown 笔记。
- **支持别名解析** — 查找目标时会检查 frontmatter 中的 `alias` 和 `aliases`。
- **支持嵌套标签** — `#parent/child` 会按需创建 `parent/child.md` 及其父目录。
- **在新窗格打开** — Windows/Linux 按住 `Ctrl`，macOS 按住 `Cmd` 后点击。
- **可选页面补全** — 输入 `#` 时，可从笔记名和别名中搜索补全建议。
- **双语设置界面** — 可在中文和 English 之间切换插件界面。
- **响应式设置界面** — 通过清晰分组、上下文提示和窄屏布局，提升桌面与移动端的使用体验。

### 安装

#### 通过 BRAT 安装（推荐）

1. 安装 [Obsidian BRAT](https://obsidian.md/plugins?id=obsidian42-brat) 插件。
2. 在 BRAT 设置中添加 `agarcabin/obsdian-tag-to-page`。
3. 在已安装的社区插件列表中启用 **Tag to Page**。

#### 手动安装

1. 从 [Releases](https://github.com/agarcabin/obsdian-tag-to-page/releases) 页面下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 将它们复制到 `<你的库>/.obsidian/plugins/tag-to-page/`。
3. 在 **设置 → 社区插件** 中启用 **Tag to Page**。

仓库名称是 `obsdian-tag-to-page`；为兼容已有安装，插件 ID 和安装目录仍保持为 `tag-to-page`。

### 使用方法

点击笔记中的 `#tag` 后，插件会：

1. 查找名为 `tag` 的笔记。
2. 如果找不到，检查 frontmatter 中的 `alias` 和 `aliases`。
3. 如果仍未找到，创建 `tag.md`。
4. 打开解析到的目标笔记。

配合 Obsidian 内置的反链面板，可以像 Logseq 一样通过标签发现相关笔记。

### 设置

| 设置项 | 说明 |
| --- | --- |
| 语言 | 在中文和 English 之间切换界面语言。 |
| 输入 `#` 时显示页面补全 | 开启后，根据笔记名和别名提供补全建议；扫描会增加一定性能开销。 |

### 工作原理

- **点击拦截** — 在 DOM 捕获阶段拦截 `.tag` 和 `.cm-hashtag` 元素的点击，阻止 Obsidian 默认的标签搜索行为。
- **页面解析** — 使用 `metadataCache.getFirstLinkpathDest()`，并扫描 frontmatter 别名来解析目标页面。
- **自动补全** — 使用 CodeMirror 6 autocomplete，从 Markdown 笔记名和别名中生成建议。

### 已知限制

- 开启 `#` 页面补全后，会替换默认的 `[[` 页面补全提供器。
- 源码模式暂不支持标签点击跳转。

### 开发

```bash
git clone https://github.com/agarcabin/obsdian-tag-to-page.git
cd obsdian-tag-to-page
npm install
npm run dev    # 监听模式
npm run build  # 正式构建
```
