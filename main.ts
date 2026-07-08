import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { TFile } from "obsidian";
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
		language: "语言",
		autocompleteName: "输入#时显示[[页面]]补全建议",
		autocompleteDesc:
			"开启后，输入#会自动提示匹配的笔记文件名和别名。注意:开启后使用#时会有一定的性能消耗，如果遇到问题请关闭开关并重载插件恢复",
	},
	en: {
		settingHeader: "Tag to Page",
		pluginDesc:
			"Click #tag to navigate directly to [[page]] instead of opening the tag search panel. Use with the Backlinks pane for a Logseq-like tag browsing experience.",
		language: "Language",
		autocompleteName: "Page-name suggestions with #",
		autocompleteDesc:
			"When on, typing # followed by text suggests matching file names and frontmatter aliases from your vault. Note: the [[ link picker may not work while active. Toggle off and reload to restore defaults.",
	},
};

// ──────────────────────────── Settings ────────────────────────────

interface TagToPageSettings {
	autocompleteOn: boolean;
	language: Lang;
}

const DEFAULT_SETTINGS: TagToPageSettings = {
	autocompleteOn: false,
	language: "zh",
};

// ────────────────────────── Plugin class ──────────────────────────

export default class TagToPagePlugin extends Plugin {
	settings: TagToPageSettings;

	async onload() {
		await this.loadSettings();

		this.registerDomEvent(document, "click", this.onTagClick.bind(this), true);

		if (this.settings.autocompleteOn) {
			this.registerAutocompleteOverride();
		}

		this.addSettingTab(new TagToPageSettingTab(this.app, this));
	}

	// ── click handler (Reading View + Live Preview) ──

	private onTagClick(evt: MouseEvent) {
		if (evt.button !== 0) return;
		const target = evt.target as HTMLElement;

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

		this.navigateToTagPage(tagName, evt.ctrlKey || evt.metaKey);
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

			for (const key of ["alias", "aliases"] as const) {
				const val = fm[key];
				const list: string[] =
					typeof val === "string"
						? [val]
						: Array.isArray(val)
							? val.filter((v): v is string => typeof v === "string")
							: [];
				if (list.some((a) => a.toLowerCase() === target)) return file;
			}
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
		const match = context.matchBefore(/#[-\p{L}\p{N}\p{Script=Han}_\/]*$/u);
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

			for (const key of ["alias", "aliases"] as const) {
				const val = fm[key];
				const list: string[] =
					typeof val === "string"
						? [val]
						: Array.isArray(val)
							? val.filter((v): v is string => typeof v === "string")
							: [];
				for (const alias of list) {
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
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: this.t("settingHeader") });

		containerEl.createEl("p", {
			text: this.t("pluginDesc"),
			cls: "setting-item-description",
		});

		// Language selector
		new Setting(containerEl)
			.setName(this.t("language"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("zh", "中文")
					.addOption("en", "English")
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value as "zh" | "en";
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		// Autocomplete toggle
		new Setting(containerEl)
			.setName(this.t("autocompleteName"))
			.setDesc(this.t("autocompleteDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autocompleteOn)
					.onChange(async (value) => {
						this.plugin.settings.autocompleteOn = value;
						await this.plugin.saveSettings();
						const id = "tag-to-page";
						await this.plugin.app.plugins.disablePlugin(id);
						await this.plugin.app.plugins.enablePlugin(id);
					}),
			);
	}
}