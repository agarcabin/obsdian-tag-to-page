import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem, TFile } from "obsidian";
import {
	autocompletion,
	CompletionContext,
	CompletionResult,
} from "@codemirror/autocomplete";

// ────────────────────────── i18n ──────────────────────────

type Lang = "zh" | "en";

const LANG: Record<Lang, Record<string, string>> = {
	zh: {
		settingHeader: "Tag to Page",
		pluginDesc:
			"点击 #标签 时直接跳转到 [[页面]]，而不是打开标签搜索面板。结合反链面板使用，还原 Logseq 的标签浏览体验。",
		preferences: "偏好设置",
		preferencesDesc: "选择设置界面语言，并按需调整标签页面行为。",
		language: "界面语言",
		languageDesc: "选择插件设置界面使用的语言。",
		behavior: "标签行为",
		behaviorDesc: "控制点击标签和输入 # 时的页面跳转体验。",
		autocompleteName: "输入 # 时显示页面补全",
		autocompleteDesc:
			"开启后，输入 # 会提示匹配的笔记文件名和别名。切换开关后插件会自动重载以应用设置。",
		autocompleteNotice: "使用提示",
		autocompleteNoticeDesc:
			"页面补全会替换 Obsidian 默认的 [[ 页面选择器，并可能增加扫描开销；遇到异常时可关闭此选项。",
		repository: "GitHub 项目主页",
	},
	en: {
		settingHeader: "Tag to Page",
		pluginDesc:
			"Click #tag to navigate directly to [[page]] instead of opening the tag search panel. Use with the Backlinks pane for a Logseq-like tag browsing experience.",
		preferences: "Preferences",
		preferencesDesc: "Choose the settings language and adjust tag-page behavior.",
		language: "Interface language",
		languageDesc: "Choose the language used by this settings page.",
		behavior: "Tag behavior",
		behaviorDesc: "Control tag clicks and page suggestions while typing #.",
		autocompleteName: "Page-name suggestions with #",
		autocompleteDesc:
			"When on, typing # suggests matching file names and frontmatter aliases. The plugin reloads automatically after this setting changes.",
		autocompleteNotice: "Please note",
		autocompleteNoticeDesc:
			"Page completion replaces Obsidian's default [[ link picker and may add scanning overhead. Turn it off if you notice unexpected behavior.",
		repository: "GitHub repository",
	},
};

// ──────────────────────────── Settings ────────────────────────────

interface TagToPageSettings {
	autocompleteOn: boolean;
	language: Lang;
}

interface PluginManager {
	disablePlugin(id: string): Promise<void>;
	enablePlugin(id: string): Promise<void>;
}

const DEFAULT_SETTINGS: TagToPageSettings = {
	autocompleteOn: false,
	language: "zh",
};

const TAG_COMPLETION_PATTERN = new RegExp(
	String.raw`#[-\p{L}\p{N}\p{Script=Han}_/]*$`,
	"u",
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringValues(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}
	return [];
}

function frontmatterAliases(frontmatter: unknown): string[] {
	if (!isRecord(frontmatter)) return [];
	return [
		...stringValues(frontmatter.alias),
		...stringValues(frontmatter.aliases),
	];
}

// ────────────────────────── Plugin class ──────────────────────────

export default class TagToPagePlugin extends Plugin {
	settings: TagToPageSettings;

	async onload() {
		await this.loadSettings();

		this.registerDomEvent(document, "click", this.onTagClick.bind(this), true);
		// Mobile: intercept touchend before Obsidian handles it
		this.registerDomEvent(document, "touchend", this.onTagTouchEnd.bind(this), {
			capture: true,
			passive: false,
		});

		if (this.settings.autocompleteOn) {
			this.registerAutocompleteOverride();
		}

		this.addSettingTab(new TagToPageSettingTab(this.app, this));
	}

	// ── click handler (Reading View + Live Preview) ──

	private onTagTouchEnd(evt: TouchEvent) {
		// Find the element under the finger
		const touch = evt.changedTouches[0];
		if (!touch) return;
		const target = document.elementFromPoint(touch.clientX, touch.clientY);
		if (!(target instanceof HTMLElement)) return;

		const tagEl = target.closest<HTMLElement>(".tag, .cm-hashtag");
		if (!tagEl) return;

		const contentArea = tagEl.closest(
			".markdown-preview-view, .cm-editor, .markdown-source-view",
		);
		if (!contentArea) return;

		evt.stopPropagation();
		evt.preventDefault();

		let tagName = (tagEl.textContent ?? "").trim();
		tagName = tagName.replace(/^#/, "").trim();
		if (!tagName) return;

		void this.navigateToTagPage(tagName, false);
	}

	private onTagClick(evt: MouseEvent) {
		if (evt.button !== 0) return;
		const target = evt.target;
		if (!(target instanceof HTMLElement)) return;

		const tagEl = target.closest<HTMLElement>(".tag, .cm-hashtag");
		if (!tagEl) return;

		const contentArea = tagEl.closest(
			".markdown-preview-view, .cm-editor, .markdown-source-view",
		);
		if (!contentArea) return;

		evt.stopPropagation();
		evt.preventDefault();

		let tagName = (tagEl.textContent ?? "").trim();
		tagName = tagName.replace(/^#/, "").trim();
		if (!tagName) return;

		void this.navigateToTagPage(tagName, evt.ctrlKey || evt.metaKey);
	}

	// ── navigation ──

	private async navigateToTagPage(tagName: string, openInNewLeaf: boolean) {
		const { vault, metadataCache, workspace } = this.app;
		try {
			let file = metadataCache.getFirstLinkpathDest(tagName, "");
			if (!file) file = this.findFileByAlias(tagName);
			if (!file) {
				await this.ensureParentDirectories(tagName);
				file = await vault.create(tagName + ".md", "");
			}
			await workspace.openLinkText(file.basename, "", openInNewLeaf);
		} catch (err) {
			console.error("Tag to Page: failed to navigate", err);
		}
	}

	private findFileByAlias(alias: string): TFile | null {
		const { vault, metadataCache } = this.app;
		const target = alias.toLowerCase();

		for (const file of vault.getMarkdownFiles()) {
			const cache = metadataCache.getCache(file.path);
			const fm = cache?.frontmatter;
			if (!fm) continue;

			const aliases = frontmatterAliases(fm);
			if (aliases.some((alias) => alias.toLowerCase() === target)) return file;
		}
		return null;
	}

	private async ensureParentDirectories(tagName: string) {
		const parts = tagName.split("/");
		if (parts.length <= 1) return;
		for (let i = 1; i < parts.length; i++) {
			const dirPath = parts.slice(0, i).join("/");
			if (!this.app.vault.getAbstractFileByPath(dirPath)) {
				await this.app.vault.createFolder(dirPath);
			}
		}
	}

	// ── # autocomplete ──

	private registerAutocompleteOverride() {
		this.registerEditorExtension(
			autocompletion({
				override: [this.getPageCompletion.bind(this)],
			}),
		);
	}

	private getPageCompletion(
		context: CompletionContext,
	): CompletionResult | null {
		const match = context.matchBefore(TAG_COMPLETION_PATTERN);
		if (!match || (match.text === "#" && !context.explicit)) return null;

		const query = match.text.slice(1).toLowerCase();
		const { vault, metadataCache } = this.app;
		const seen = new Set<string>();
		const suggestions: { label: string; apply: string; detail?: string }[] =
			[];

		for (const file of vault.getMarkdownFiles()) {
			if (
				file.basename.toLowerCase().includes(query) &&
				!seen.has(file.basename)
			) {
				seen.add(file.basename);
				suggestions.push({ label: file.basename, apply: file.basename });
			}

			const cache = metadataCache.getCache(file.path);
			const fm = cache?.frontmatter;
			if (!fm) continue;

			for (const alias of frontmatterAliases(fm)) {
				if (seen.has(alias)) continue;
				if (alias.toLowerCase().includes(query)) {
					seen.add(alias);
					suggestions.push({
						label: alias,
						apply: alias,
						detail: `→ ${file.basename}`,
					});
				}
			}
		}

		if (suggestions.length === 0) return null;

		suggestions.sort((a, b) => {
			const aLC = a.label.toLowerCase();
			const bLC = b.label.toLowerCase();
			if (aLC === query) return -1;
			if (bLC === query) return 1;
			if (aLC.startsWith(query) && !bLC.startsWith(query)) return -1;
			if (!aLC.startsWith(query) && bLC.startsWith(query)) return 1;
			return aLC.localeCompare(bLC);
		});

		return {
			from: match.from + 1,
			options: suggestions.slice(0, 20).map((s) => ({
				label: s.label,
				detail: s.detail,
				apply: s.apply,
			})),
		};
	}

	// ── settings persistence ──

	async loadSettings() {
		const loadedData: unknown = await this.loadData();
		const stored = isRecord(loadedData) ? loadedData : {};
		this.settings = {
			autocompleteOn: stored.autocompleteOn === true,
			language: stored.language === "en" ? "en" : DEFAULT_SETTINGS.language,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// ──────────────────────── Settings tab ────────────────────────

class TagToPageSettingTab extends PluginSettingTab {
	plugin: TagToPagePlugin;

	constructor(app: App, plugin: TagToPagePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Get translated string for the current language. */
	private t(key: string): string {
		const lang = this.plugin.settings.language;
		return LANG[lang]?.[key] ?? LANG["en"]?.[key] ?? key;
	}

	private refreshSettings(): void {
		this.display();
	}

	private async setLanguage(value: string): Promise<void> {
		if (value !== "zh" && value !== "en") return;
		this.plugin.settings.language = value;
		await this.plugin.saveSettings();
		this.refreshSettings();
	}

	private async setAutocompleteEnabled(value: boolean): Promise<void> {
		this.plugin.settings.autocompleteOn = value;
		await this.plugin.saveSettings();

		const id = this.plugin.manifest.id;
		const pluginManager = (this.plugin.app as App & {
			plugins: PluginManager;
		}).plugins;
		await pluginManager.disablePlugin(id);
		await pluginManager.enablePlugin(id);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: this.t("preferences"),
				cls: "tag-to-page-settings__declarative-section",
				items: [
					{
						name: this.t("language"),
						desc: this.t("languageDesc"),
						render: (setting) => {
							setting.settingEl.addClass("tag-to-page-settings__setting");
							setting.addDropdown((dropdown) =>
								dropdown
									.addOption("zh", "中文")
									.addOption("en", "English")
									.setValue(this.plugin.settings.language)
									.onChange((value) => this.setLanguage(value)),
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: this.t("behavior"),
				cls: "tag-to-page-settings__declarative-section",
				items: [
					{
						name: this.t("autocompleteName"),
						desc: this.t("autocompleteDesc"),
						render: (setting) => {
							setting.settingEl.addClass("tag-to-page-settings__setting");
							setting.addToggle((toggle) =>
								toggle
									.setValue(this.plugin.settings.autocompleteOn)
									.onChange((value) => this.setAutocompleteEnabled(value)),
							);
						},
					},
					{
						name: this.t("autocompleteNotice"),
						desc: this.t("autocompleteNoticeDesc"),
						render: (setting) => {
							setting.settingEl.addClass("tag-to-page-settings__notice");
						},
					},
				],
			},
		];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("tag-to-page-settings");

		const hero = containerEl.createDiv({ cls: "tag-to-page-settings__hero" });
		const icon = hero.createDiv({
			cls: "tag-to-page-settings__icon",
			text: "#",
		});
		icon.setAttr("aria-hidden", "true");

		const heroBody = hero.createDiv({ cls: "tag-to-page-settings__hero-body" });
		const heroHeading = new Setting(heroBody)
			.setName(this.t("settingHeader"))
			.setDesc(this.t("pluginDesc"))
			.setHeading();
		heroHeading.settingEl.addClass("tag-to-page-settings__hero-heading");
		const heroMeta = heroBody.createDiv({ cls: "tag-to-page-settings__hero-meta" });
		heroMeta.createSpan({
			cls: "tag-to-page-settings__version",
			text: `v${this.plugin.manifest.version}`,
		});
		const repositoryLink = heroMeta.createEl("a", {
			text: this.t("repository"),
			href: "https://github.com/agarcabin/obsdian-tag-to-page",
		});
		repositoryLink.setAttr("target", "_blank");
		repositoryLink.setAttr("rel", "noopener");

		const preferencesSection = containerEl.createDiv({
			cls: "tag-to-page-settings__section",
		});
		const preferencesHeader = new Setting(preferencesSection)
			.setName(this.t("preferences"))
			.setDesc(this.t("preferencesDesc"))
			.setHeading();
		preferencesHeader.settingEl.addClass("tag-to-page-settings__section-header");

		const languageSetting = new Setting(preferencesSection)
			.setName(this.t("language"))
			.setDesc(this.t("languageDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("zh", "中文")
					.addOption("en", "English")
					.setValue(this.plugin.settings.language)
					.onChange((value) => this.setLanguage(value)),
			);
		languageSetting.settingEl.addClass("tag-to-page-settings__setting");

		const behaviorSection = containerEl.createDiv({
			cls: "tag-to-page-settings__section",
		});
		const behaviorHeader = new Setting(behaviorSection)
			.setName(this.t("behavior"))
			.setDesc(this.t("behaviorDesc"))
			.setHeading();
		behaviorHeader.settingEl.addClass("tag-to-page-settings__section-header");

		const autocompleteSetting = new Setting(behaviorSection)
			.setName(this.t("autocompleteName"))
			.setDesc(this.t("autocompleteDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autocompleteOn)
					.onChange((value) => this.setAutocompleteEnabled(value)),
			);
		autocompleteSetting.settingEl.addClass("tag-to-page-settings__setting");

		const notice = behaviorSection.createDiv({
			cls: "tag-to-page-settings__notice",
		});
		notice.createDiv({
			cls: "tag-to-page-settings__notice-title",
			text: this.t("autocompleteNotice"),
		});
		notice.createDiv({
			cls: "tag-to-page-settings__notice-text",
			text: this.t("autocompleteNoticeDesc"),
		});
	}
}
