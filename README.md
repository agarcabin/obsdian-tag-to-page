# Tag to Page

一个 Obsidian 插件，让 #标签 的行为像 Logseq 一样——点击 #tag 直接跳转到 [[tag]] 页面，而不是打开标签搜索面板。

## 功能

- **点击 #tag → [[tag]]**：阅读视图和实时预览中点击 #标签 直接跳转到同名笔记页面
- **自动创建页面**：如果 [[tag]] 页面不存在，自动创建空白笔记
- **别名支持**：自动解析 frontmatter 中的 alias/aliases，跳转到正确的笔记
- **嵌套标签**：#parent/child 自动创建 parent/child.md 和对应目录
- **Ctrl/Cmd+Click**：在新窗格打开
- **# 自动补全**（可选开关）：输入 # 时提示匹配的笔记文件名和别名
- **双语界面**：支持中文和 English

## 安装

### 通过 BRAT（推荐）

1. 安装 [Obsidian BRAT](https://obsidian.md/plugins?id=obsidian42-brat) 插件
2. 在 BRAT 设置中添加 `你的GitHub用户名/tag-to-page`
3. 在已安装插件列表中启用 **Tag to Page**

### 手动安装

1. 在 [Releases](链接) 页面下载最新版 `main.js`、`manifest.json`、`styles.css`
2. 复制到 `<你的库>/.obsidian/plugins/tag-to-page/`
3. 在 Obsidian 设置 → 社区插件 → 已安装插件中启用 **Tag to Page**

## 使用

### 基础用法

点击笔记中的 `#tag`，插件会：

1. 查找名为 `tag` 的笔记
2. 如果不存在，检查其他笔记的 frontmatter alias/aliases 是否包含 `tag`
3. 如果仍未找到，自动创建 `tag.md`
4. 跳转到该笔记

配合 Obsidian 内置的反链面板使用，可以像 Logseq 一样通过标签发现相关内容。

### 设置

| 设置项 | 说明 |
|---|---|
| 语言 | 切换界面语言（中文 / English） |
| 输入#时显示[[页面]]补全建议 | 开启后输入 # 会提示匹配的笔记文件名和别名。注意有一定性能开销 |

## 工作原理

- **点击拦截**：在 DOM 捕获阶段拦截 `.tag` 和 `.cm-hashtag` 元素的点击，阻止 Obsidian 默认的标签搜索行为
- **页面跳转**：通过 `metadataCache.getFirstLinkpathDest()` + frontmatter 别名扫描 解析目标页面
- **自动补全**：通过 CodeMirror 6 的 `autocompletion({ override })` 替换原生标签补全

## 已知限制

- 开启「# 自动补全」后，`[[` 的页面选择器会被替换
- 源码模式不支持标签点击跳转

## 开发

```bash
git clone https://github.com/你的GitHub用户名/tag-to-page.git
cd tag-to-page
npm install
npm run dev    # 监听模式
npm run build  # 正式构建
```
