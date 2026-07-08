var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TagToPagePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_autocomplete = require("@codemirror/autocomplete");
var LANG = {
  zh: {
    settingHeader: "Tag to Page",
    pluginDesc: "\u70B9\u51FB #\u6807\u7B7E \u65F6\u76F4\u63A5\u8DF3\u8F6C\u5230 [[\u9875\u9762]]\uFF0C\u800C\u4E0D\u662F\u6253\u5F00\u6807\u7B7E\u641C\u7D22\u9762\u677F\u3002\u7ED3\u5408\u53CD\u94FE\u9762\u677F\u4F7F\u7528\uFF0C\u8FD8\u539F Logseq \u7684\u6807\u7B7E\u6D4F\u89C8\u4F53\u9A8C\u3002",
    language: "\u8BED\u8A00",
    autocompleteName: "\u8F93\u5165#\u65F6\u663E\u793A[[\u9875\u9762]]\u8865\u5168\u5EFA\u8BAE",
    autocompleteDesc: "\u5F00\u542F\u540E\uFF0C\u8F93\u5165#\u4F1A\u81EA\u52A8\u63D0\u793A\u5339\u914D\u7684\u7B14\u8BB0\u6587\u4EF6\u540D\u548C\u522B\u540D\u3002\u6CE8\u610F:\u5F00\u542F\u540E\u4F7F\u7528#\u65F6\u4F1A\u6709\u4E00\u5B9A\u7684\u6027\u80FD\u6D88\u8017\uFF0C\u5982\u679C\u9047\u5230\u95EE\u9898\u8BF7\u5173\u95ED\u5F00\u5173\u5E76\u91CD\u8F7D\u63D2\u4EF6\u6062\u590D"
  },
  en: {
    settingHeader: "Tag to Page",
    pluginDesc: "Click #tag to navigate directly to [[page]] instead of opening the tag search panel. Use with the Backlinks pane for a Logseq-like tag browsing experience.",
    language: "Language",
    autocompleteName: "Page-name suggestions with #",
    autocompleteDesc: "When on, typing # followed by text suggests matching file names and frontmatter aliases from your vault. Note: the [[ link picker may not work while active. Toggle off and reload to restore defaults."
  }
};
var DEFAULT_SETTINGS = {
  autocompleteOn: false,
  language: "zh"
};
var TagToPagePlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.registerDomEvent(document, "click", this.onTagClick.bind(this), true);
    if (this.settings.autocompleteOn) {
      this.registerAutocompleteOverride();
    }
    this.addSettingTab(new TagToPageSettingTab(this.app, this));
  }
  // ── click handler (Reading View + Live Preview) ──
  onTagClick(evt) {
    var _a;
    if (evt.button !== 0)
      return;
    const target = evt.target;
    const tagEl = target.closest(".tag, .cm-hashtag");
    if (!tagEl)
      return;
    const contentArea = tagEl.closest(
      ".markdown-preview-view, .cm-editor, .markdown-source-view"
    );
    if (!contentArea)
      return;
    evt.stopPropagation();
    evt.preventDefault();
    let tagName = ((_a = tagEl.textContent) != null ? _a : "").trim();
    tagName = tagName.replace(/^#/, "").trim();
    if (!tagName)
      return;
    this.navigateToTagPage(tagName, evt.ctrlKey || evt.metaKey);
  }
  // ── navigation ──
  async navigateToTagPage(tagName, openInNewLeaf) {
    const { vault, metadataCache, workspace } = this.app;
    try {
      let file = metadataCache.getFirstLinkpathDest(tagName, "");
      if (!file)
        file = this.findFileByAlias(tagName);
      if (!file) {
        await this.ensureParentDirectories(tagName);
        file = await vault.create(tagName + ".md", "");
      }
      await workspace.openLinkText(file.basename, "", openInNewLeaf);
    } catch (err) {
      console.error("Tag to Page: failed to navigate", err);
    }
  }
  findFileByAlias(alias) {
    const { vault, metadataCache } = this.app;
    const target = alias.toLowerCase();
    for (const file of vault.getMarkdownFiles()) {
      const cache = metadataCache.getCache(file.path);
      const fm = cache == null ? void 0 : cache.frontmatter;
      if (!fm)
        continue;
      for (const key of ["alias", "aliases"]) {
        const val = fm[key];
        const list = typeof val === "string" ? [val] : Array.isArray(val) ? val.filter((v) => typeof v === "string") : [];
        if (list.some((a) => a.toLowerCase() === target))
          return file;
      }
    }
    return null;
  }
  async ensureParentDirectories(tagName) {
    const parts = tagName.split("/");
    if (parts.length <= 1)
      return;
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (!this.app.vault.getAbstractFileByPath(dirPath)) {
        await this.app.vault.createFolder(dirPath);
      }
    }
  }
  // ── # autocomplete ──
  registerAutocompleteOverride() {
    this.registerEditorExtension(
      (0, import_autocomplete.autocompletion)({
        override: [this.getPageCompletion.bind(this)]
      })
    );
  }
  getPageCompletion(context) {
    const match = context.matchBefore(/#[-\p{L}\p{N}\p{Script=Han}_\/]*$/u);
    if (!match || match.text === "#" && !context.explicit)
      return null;
    const query = match.text.slice(1).toLowerCase();
    const { vault, metadataCache } = this.app;
    const seen = /* @__PURE__ */ new Set();
    const suggestions = [];
    for (const file of vault.getMarkdownFiles()) {
      if (file.basename.toLowerCase().includes(query) && !seen.has(file.basename)) {
        seen.add(file.basename);
        suggestions.push({ label: file.basename, apply: file.basename });
      }
      const cache = metadataCache.getCache(file.path);
      const fm = cache == null ? void 0 : cache.frontmatter;
      if (!fm)
        continue;
      for (const key of ["alias", "aliases"]) {
        const val = fm[key];
        const list = typeof val === "string" ? [val] : Array.isArray(val) ? val.filter((v) => typeof v === "string") : [];
        for (const alias of list) {
          if (seen.has(alias))
            continue;
          if (alias.toLowerCase().includes(query)) {
            seen.add(alias);
            suggestions.push({
              label: alias,
              apply: alias,
              detail: `\u2192 ${file.basename}`
            });
          }
        }
      }
    }
    if (suggestions.length === 0)
      return null;
    suggestions.sort((a, b) => {
      const aLC = a.label.toLowerCase();
      const bLC = b.label.toLowerCase();
      if (aLC === query)
        return -1;
      if (bLC === query)
        return 1;
      if (aLC.startsWith(query) && !bLC.startsWith(query))
        return -1;
      if (!aLC.startsWith(query) && bLC.startsWith(query))
        return 1;
      return aLC.localeCompare(bLC);
    });
    return {
      from: match.from + 1,
      options: suggestions.slice(0, 20).map((s) => ({
        label: s.label,
        detail: s.detail,
        apply: s.apply
      }))
    };
  }
  // ── settings persistence ──
  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var TagToPageSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  /** Get translated string for the current language. */
  t(key) {
    var _a, _b, _c, _d;
    const lang = this.plugin.settings.language;
    return (_d = (_c = (_a = LANG[lang]) == null ? void 0 : _a[key]) != null ? _c : (_b = LANG["en"]) == null ? void 0 : _b[key]) != null ? _d : key;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: this.t("settingHeader") });
    containerEl.createEl("p", {
      text: this.t("pluginDesc"),
      cls: "setting-item-description"
    });
    new import_obsidian.Setting(containerEl).setName(this.t("language")).addDropdown(
      (dropdown) => dropdown.addOption("zh", "\u4E2D\u6587").addOption("en", "English").setValue(this.plugin.settings.language).onChange(async (value) => {
        this.plugin.settings.language = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );
    new import_obsidian.Setting(containerEl).setName(this.t("autocompleteName")).setDesc(this.t("autocompleteDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autocompleteOn).onChange(async (value) => {
        this.plugin.settings.autocompleteOn = value;
        await this.plugin.saveSettings();
        const id = "tag-to-page";
        await this.plugin.app.plugins.disablePlugin(id);
        await this.plugin.app.plugins.enablePlugin(id);
      })
    );
  }
};
