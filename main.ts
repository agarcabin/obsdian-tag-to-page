import {
	App,
	MarkdownView,
	normalizePath,
	Plugin,
	PluginSettingTab,
} from "obsidian";
import type { SettingDefinitionItem, TFile, WorkspaceLeaf } from "obsidian";
import {
	autocompletion,
	CompletionContext,
	CompletionResult,
} from "@codemirror/autocomplete";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

// ────────────────────────── i18n ──────────────────────────

type Lang = "zh" | "en";
type LanguagePreference = "auto" | Lang;
type MissingPageAction = "create" | "openTag" | "edit" | "none";
type SettingKey =
	| "language"
	| "clickToPage"
	| "missingPageAction"
	| "autocompleteOn"
	| "autocompleteAliases";

const LANG: Record<Lang, Record<string, string>> = {
	zh: {
		settingHeader: "Tag to Page",
		pluginDesc:
			"点击 #标签 时直接跳转到 [[页面]]，而不是打开标签搜索面板。结合反链面板使用，还原 Logseq 的标签浏览体验。",
		settings: "设置",
		language: "界面语言",
		languageDesc: "自动跟随系统，也可固定使用中文或 English。",
		languageAuto: "自动（跟随系统）",
		clickToPageName: "点击标签跳转到同名页面",
		clickToPageDesc:
			"点击 #标签 时打开同名页面，类似Logseq的标签浏览体验。",
		missingPageActionName: "页面不存在时动作",
		missingPageActionDesc: "选择标签没有同名页面时执行的操作。",
		missingPageActionCreate: "自动创建同名页面",
		missingPageActionOpenTag: "打开对应标签",
		missingPageActionEdit: "进入编辑状态",
		missingPageActionNone: "无任何动作",
		autocompleteName: "输入#后页面补全",
		autocompleteDesc:
			"输入 # 后显示匹配的页面名称。切换后插件会自动重载以应用设置。",
		autocompleteAliasesName: "输入#后的页面补全 额外支持页面别称",
		autocompleteAliasesDesc:
			"补全结果同时包含页面属性中的 alias 和 aliases；需先开启页面补全。",
		repository: "GitHub 项目主页",
	},
	en: {
		settingHeader: "Tag to Page",
		pluginDesc:
			"Click #tag to navigate directly to [[page]] instead of opening the tag search panel. Use with the Backlinks pane for a Logseq-like tag browsing experience.",
		settings: "Settings",
		language: "Interface language",
		languageDesc:
			"Follow the system language automatically, or always use Chinese or English.",
		languageAuto: "Auto (follow system)",
		clickToPageName: "Open the same-name page when clicking a tag",
		clickToPageDesc:
			"Click #tag to open the page with the same name for a Logseq-like tag browsing experience.",
		missingPageActionName: "When the page does not exist",
		missingPageActionDesc:
			"Choose what happens when a tag has no page with the same name.",
		missingPageActionCreate: "Create the same-name page",
		missingPageActionOpenTag: "Open the corresponding tag",
		missingPageActionEdit: "Enter editing mode",
		missingPageActionNone: "Do nothing",
		autocompleteName: "Page completion after #",
		autocompleteDesc:
			"Show matching page names after typing #. The plugin reloads automatically after this setting changes.",
		autocompleteAliasesName: "Also include page aliases in # completion",
		autocompleteAliasesDesc:
			"Also suggest alias and aliases values from page properties. Page completion must be enabled.",
		repository: "GitHub repository",
	},
};

// ──────────────────────────── Settings ────────────────────────────

interface TagToPageSettings {
	clickToPage: boolean;
	missingPageAction: MissingPageAction;
	autocompleteOn: boolean;
	autocompleteAliases: boolean;
	language: LanguagePreference;
}

interface PluginManager {
	disablePlugin(id: string): Promise<void>;
	enablePlugin(id: string): Promise<void>;
}

const DEFAULT_SETTINGS: TagToPageSettings = {
	clickToPage: true,
	missingPageAction: "create",
	autocompleteOn: false,
	autocompleteAliases: true,
	language: "auto",
};

const TAG_COMPLETION_PATTERN = new RegExp(
	String.raw`#[-\p{L}\p{N}\p{Script=Han}_/]*$`,
	"u",
);
const COMPLETION_TOOLTIP_CLASS = "tag-to-page-completion-tooltip";
const COMPLETION_TOOLTIP_GAP = 8;
const COMPLETION_TOOLTIP_EDGE_GAP = 8;
const COMPLETION_TOOLTIP_MIN_HEIGHT = 96;

function isVisibleElement(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	const style = element.ownerDocument.defaultView?.getComputedStyle(element);
	return (
		rect.width > 0 &&
		rect.height > 0 &&
		style?.display !== "none" &&
		style?.visibility !== "hidden"
	);
}

function distanceToRect(
	x: number,
	y: number,
	rect: DOMRect,
): number {
	const dx = Math.max(rect.left - x, 0, x - rect.right);
	const dy = Math.max(rect.top - y, 0, y - rect.bottom);
	return Math.hypot(dx, dy);
}

class CompletionTooltipPositioner {
	private animationFrame: number | null = null;
	private readonly doc: Document;
	private readonly win: Window;
	private readonly observer: MutationObserver;

	constructor(private readonly view: EditorView) {
		this.doc = view.dom.ownerDocument;
		this.win = this.doc.defaultView ?? window;
		this.observer = new MutationObserver((mutations) => {
			if (
				mutations.some(
					(mutation) =>
						mutation.type === "childList" ||
						(mutation.target.nodeType === 1 &&
							(mutation.target as Element).matches(
								".suggestion-container",
							)),
				)
			) {
				this.schedule();
			}
		});

		this.observer.observe(this.doc.body, {
			attributes: true,
			attributeFilter: ["class", "style"],
			childList: true,
			subtree: true,
		});
		this.win.addEventListener("resize", this.schedule);
		this.doc.addEventListener("scroll", this.schedule, true);
		this.schedule();
	}

	update(update: ViewUpdate) {
		if (
			update.docChanged ||
			update.selectionSet ||
			update.viewportChanged ||
			update.geometryChanged ||
			update.focusChanged
		) {
			this.schedule();
		}
	}

	destroy() {
		this.observer.disconnect();
		this.win.removeEventListener("resize", this.schedule);
		this.doc.removeEventListener("scroll", this.schedule, true);
		if (this.animationFrame !== null) {
			this.win.cancelAnimationFrame(this.animationFrame);
		}
	}

	private readonly schedule = () => {
		if (this.animationFrame !== null) return;
		this.animationFrame = this.win.requestAnimationFrame(() => {
			this.animationFrame = null;
			this.positionTooltip();
		});
	};

	private findTooltip(): HTMLElement | null {
		const localTooltip = this.view.dom.querySelector<HTMLElement>(
			`.${COMPLETION_TOOLTIP_CLASS}`,
		);
		if (localTooltip) return localTooltip;
		if (!this.view.hasFocus) return null;

		const cursor = this.view.coordsAtPos(this.view.state.selection.main.head);
		if (!cursor) return null;
		const candidates = Array.from(
			this.doc.querySelectorAll<HTMLElement>(`.${COMPLETION_TOOLTIP_CLASS}`),
		).filter(isVisibleElement);
		return (
			candidates.sort(
				(a, b) =>
					distanceToRect(cursor.left, cursor.bottom, a.getBoundingClientRect()) -
					distanceToRect(cursor.left, cursor.bottom, b.getBoundingClientRect()),
			)[0] ?? null
		);
	}

	private findNativeSuggestion(tooltip: HTMLElement): HTMLElement | null {
		if (!this.view.hasFocus) return null;
		const cursor = this.view.coordsAtPos(this.view.state.selection.main.head);
		if (!cursor) return null;

		const candidates = Array.from(
			this.doc.querySelectorAll<HTMLElement>(".suggestion-container"),
		).filter(isVisibleElement);
		const nearest = candidates.sort(
			(a, b) =>
				distanceToRect(cursor.left, cursor.bottom, a.getBoundingClientRect()) -
				distanceToRect(cursor.left, cursor.bottom, b.getBoundingClientRect()),
		)[0];
		if (!nearest) return null;

		const tooltipRect = tooltip.getBoundingClientRect();
		const nativeRect = nearest.getBoundingClientRect();
		const proximityLimit = Math.max(320, Math.min(this.win.innerWidth * 0.4, 520));
		const closeToCursor =
			distanceToRect(cursor.left, cursor.bottom, nativeRect) <= proximityLimit;
		const closeToTooltip =
			distanceToRect(tooltipRect.left, tooltipRect.top, nativeRect) <=
			proximityLimit;
		return closeToCursor && closeToTooltip ? nearest : null;
	}

	private positionTooltip() {
		const tooltip = this.findTooltip();
		if (!tooltip) return;
		const nativeSuggestion = this.findNativeSuggestion(tooltip);
		if (!nativeSuggestion) {
			tooltip.style.removeProperty("--tag-to-page-native-offset");
			tooltip.style.removeProperty("--tag-to-page-completion-max-height");
			return;
		}

		const currentOffset = Number.parseFloat(
			tooltip.style.getPropertyValue("--tag-to-page-native-offset"),
		) || 0;
		const tooltipRect = tooltip.getBoundingClientRect();
		const nativeRect = nativeSuggestion.getBoundingClientRect();
		const baseTop = tooltipRect.top - currentOffset;
		const belowTop = nativeRect.bottom + COMPLETION_TOOLTIP_GAP;
		const spaceBelow =
			this.win.innerHeight - belowTop - COMPLETION_TOOLTIP_EDGE_GAP;

		let desiredTop = belowTop;
		let maxHeight = spaceBelow;
		if (spaceBelow < COMPLETION_TOOLTIP_MIN_HEIGHT) {
			const aboveBottom = nativeRect.top - COMPLETION_TOOLTIP_GAP;
			const spaceAbove = aboveBottom - COMPLETION_TOOLTIP_EDGE_GAP;
			if (spaceAbove > spaceBelow) {
				maxHeight = spaceAbove;
				desiredTop = Math.max(
					COMPLETION_TOOLTIP_EDGE_GAP,
					aboveBottom - Math.min(tooltipRect.height, spaceAbove),
				);
			}
		}

		tooltip.style.setProperty(
			"--tag-to-page-native-offset",
			`${Math.round(desiredTop - baseTop)}px`,
		);
		tooltip.style.setProperty(
			"--tag-to-page-completion-max-height",
			`${Math.max(72, Math.floor(maxHeight))}px`,
		);
	}
}

const completionTooltipPositioner = ViewPlugin.fromClass(
	CompletionTooltipPositioner,
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

function resolveLanguage(preference: LanguagePreference): Lang {
	if (preference !== "auto") return preference;
	const systemLanguage = globalThis.navigator?.language.toLowerCase() ?? "en";
	return systemLanguage.startsWith("zh") ? "zh" : "en";
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
		if (!this.settings.clickToPage) return;
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

		let tagName = (tagEl.textContent ?? "").trim();
		tagName = tagName.replace(/^#/, "").trim();
		if (!tagName) return;

		const file = this.findTagPage(tagName);
		if (!file && this.settings.missingPageAction === "openTag") return;
		const sourceLeaf = this.findMarkdownLeaf(contentArea);

		evt.stopPropagation();
		evt.preventDefault();
		void this.activateTag(tagName, file, false, sourceLeaf);
	}

	private onTagClick(evt: MouseEvent) {
		if (!this.settings.clickToPage) return;
		if (evt.button !== 0) return;
		const target = evt.target;
		if (!(target instanceof HTMLElement)) return;

		const tagEl = target.closest<HTMLElement>(".tag, .cm-hashtag");
		if (!tagEl) return;

		const contentArea = tagEl.closest(
			".markdown-preview-view, .cm-editor, .markdown-source-view",
		);
		if (!contentArea) return;

		let tagName = (tagEl.textContent ?? "").trim();
		tagName = tagName.replace(/^#/, "").trim();
		if (!tagName) return;

		const file = this.findTagPage(tagName);
		if (!file && this.settings.missingPageAction === "openTag") return;
		const sourceLeaf = this.findMarkdownLeaf(contentArea);

		evt.stopPropagation();
		evt.preventDefault();
		void this.activateTag(
			tagName,
			file,
			evt.ctrlKey || evt.metaKey,
			sourceLeaf,
		);
	}

	// ── navigation ──

	private findTagPage(tagName: string): TFile | null {
		return (
			this.app.metadataCache.getFirstLinkpathDest(tagName, "") ??
			this.findFileByAlias(tagName)
		);
	}

	private findMarkdownLeaf(element: Element): WorkspaceLeaf | null {
		return (
			this.app.workspace
				.getLeavesOfType("markdown")
				.find((leaf) => leaf.view.containerEl.contains(element)) ?? null
		);
	}

	private async activateTag(
		tagName: string,
		file: TFile | null,
		openInNewLeaf: boolean,
		sourceLeaf: WorkspaceLeaf | null,
	) {
		try {
			if (file) {
				if (sourceLeaf) {
					this.app.workspace.setActiveLeaf(sourceLeaf, { focus: false });
				}
				await this.app.workspace.openLinkText(
					file.path,
					"",
					openInNewLeaf,
				);
				return;
			}

			switch (this.settings.missingPageAction) {
				case "create": {
					if (sourceLeaf) {
						this.app.workspace.setActiveLeaf(sourceLeaf, { focus: false });
					}
					await this.ensureParentDirectories(tagName);
					const createdFile = await this.app.vault.create(
						tagName + ".md",
						"",
					);
					await this.app.workspace.openLinkText(
						createdFile.path,
						"",
						openInNewLeaf,
					);
					return;
				}
				case "edit":
					await this.enterEditMode(sourceLeaf);
					return;
				case "openTag":
				case "none":
					return;
			}
		} catch (err) {
			console.error("Tag to Page: failed to handle tag", err);
		}
	}

	private async enterEditMode(sourceLeaf: WorkspaceLeaf | null): Promise<void> {
		const leaf = sourceLeaf ?? this.app.workspace.activeLeaf;
		if (!leaf || !(leaf.view instanceof MarkdownView)) return;
		this.app.workspace.setActiveLeaf(leaf, { focus: false });

		if (leaf.view.getMode() !== "source") {
			const viewState = leaf.getViewState();
			await leaf.setViewState({
				...viewState,
				state: { ...viewState.state, mode: "source" },
			});
		}

		if (leaf.view instanceof MarkdownView) leaf.view.editor.focus();
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
		this.registerEditorExtension([
			autocompletion({
				override: [this.getPageCompletion.bind(this)],
				tooltipClass: () => COMPLETION_TOOLTIP_CLASS,
			}),
			completionTooltipPositioner,
		]);
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
			const basenameKey = file.basename.toLowerCase();
			if (
				basenameKey.includes(query) &&
				!seen.has(basenameKey)
			) {
				seen.add(basenameKey);
				suggestions.push({ label: file.basename, apply: file.basename });
			}

			if (this.settings.autocompleteAliases) {
				const cache = metadataCache.getCache(file.path);
				const fm = cache?.frontmatter;
				if (!fm) continue;

				for (const alias of frontmatterAliases(fm)) {
					const aliasKey = alias.toLowerCase();
					if (seen.has(aliasKey)) continue;
					if (aliasKey.includes(query)) {
						seen.add(aliasKey);
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
		const loadedData: unknown = await this.loadData();
		const stored = isRecord(loadedData) ? loadedData : {};
		const storedLanguage = stored.language;
		const storedMissingPageAction = stored.missingPageAction;
		this.settings = {
			clickToPage: stored.clickToPage !== false,
			missingPageAction:
				storedMissingPageAction === "create" ||
				storedMissingPageAction === "openTag" ||
				storedMissingPageAction === "edit" ||
				storedMissingPageAction === "none"
					? storedMissingPageAction
					: DEFAULT_SETTINGS.missingPageAction,
			autocompleteOn: stored.autocompleteOn === true,
			autocompleteAliases: stored.autocompleteAliases !== false,
			language:
				storedLanguage === "zh" ||
				storedLanguage === "en" ||
				storedLanguage === "auto"
					? storedLanguage
					: DEFAULT_SETTINGS.language,
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
		this.containerEl.addClass("tag-to-page-settings");
	}

	private t(key: string): string {
		const lang = resolveLanguage(this.plugin.settings.language);
		return LANG[lang]?.[key] ?? LANG["en"]?.[key] ?? key;
	}

	private async readInstalledVersion(): Promise<string> {
		const { manifest } = this.plugin;
		const pluginDir =
			manifest.dir ??
			normalizePath(
				`${this.app.vault.configDir}/plugins/${manifest.id}`,
			);
		const manifestPath = normalizePath(`${pluginDir}/manifest.json`);

		try {
			const rawManifest = await this.app.vault.adapter.read(manifestPath);
			const parsed: unknown = JSON.parse(rawManifest.replace(/^\uFEFF/, ""));
			if (isRecord(parsed) && typeof parsed.version === "string") {
				const version = parsed.version.trim();
				if (version) return version;
			}
		} catch (err) {
			console.warn("Tag to Page: failed to read installed version", err);
		}

		return manifest.version;
	}

	private async updateVersionBadge(versionEl: HTMLElement): Promise<void> {
		const version = await this.readInstalledVersion();
		if (versionEl.isConnected) versionEl.setText(`v${version}`);
	}

	private async reloadPlugin(): Promise<void> {
		const id = this.plugin.manifest.id;
		const pluginManager = (this.plugin.app as App & {
			plugins: PluginManager;
		}).plugins;
		await pluginManager.disablePlugin(id);
		await pluginManager.enablePlugin(id);
	}

	async setControlValue(key: SettingKey, value: unknown): Promise<void> {
		if (
			key === "language" &&
			(value === "auto" || value === "zh" || value === "en")
		) {
			this.plugin.settings.language = value;
			await this.plugin.saveSettings();
			this.update();
			return;
		}

		if (
			key === "missingPageAction" &&
			(value === "create" ||
				value === "openTag" ||
				value === "edit" ||
				value === "none")
		) {
			this.plugin.settings.missingPageAction = value;
			await this.plugin.saveSettings();
			return;
		}

		if (typeof value !== "boolean") return;

		if (key === "clickToPage") {
			this.plugin.settings.clickToPage = value;
			await this.plugin.saveSettings();
			this.update();
			return;
		}

		if (key === "autocompleteAliases") {
			this.plugin.settings.autocompleteAliases = value;
			await this.plugin.saveSettings();
			return;
		}

		if (key === "autocompleteOn") {
			this.plugin.settings.autocompleteOn = value;
			await this.plugin.saveSettings();
			await this.reloadPlugin();
		}
	}

	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				name: this.t("settingHeader"),
				desc: this.t("pluginDesc"),
				searchable: false,
				render: (setting) => {
					const { settingEl } = setting;
					settingEl.empty();
					settingEl.addClass("tag-to-page-settings__hero");

					const icon = settingEl.createDiv({
						cls: "tag-to-page-settings__icon",
						text: "#",
					});
					icon.setAttr("aria-hidden", "true");

					const body = settingEl.createDiv({
						cls: "tag-to-page-settings__hero-body",
					});
					const heroTitle = body.createDiv({
						cls: "tag-to-page-settings__hero-title",
						text: this.t("settingHeader"),
					});
					heroTitle.setAttr("role", "heading");
					heroTitle.setAttr("aria-level", "2");
					body.createEl("p", {
						cls: "tag-to-page-settings__hero-description",
						text: this.t("pluginDesc"),
					});

					const meta = body.createDiv({
						cls: "tag-to-page-settings__hero-meta",
					});
					const versionBadge = meta.createSpan({
						cls: "tag-to-page-settings__version",
						text: `v${this.plugin.manifest.version}`,
					});
					void this.updateVersionBadge(versionBadge);
					const repositoryLink = meta.createEl("a", {
						text: this.t("repository"),
						href: "https://github.com/agarcabin/obsdian-tag-to-page",
					});
					repositoryLink.setAttr("target", "_blank");
					repositoryLink.setAttr("rel", "noopener");
				},
			},
			{
				type: "group",
				heading: this.t("settings"),
				cls: "tag-to-page-settings__declarative-section",
				items: [
					{
						name: this.t("language"),
						desc: this.t("languageDesc"),
						control: {
							type: "dropdown",
							key: "language",
							defaultValue: DEFAULT_SETTINGS.language,
							options: {
								auto: this.t("languageAuto"),
								zh: "中文",
								en: "English",
							},
						},
					},
					{
						name: this.t("clickToPageName"),
						desc: this.t("clickToPageDesc"),
						control: {
							type: "toggle",
							key: "clickToPage",
							defaultValue: DEFAULT_SETTINGS.clickToPage,
						},
					},
					{
						name: this.t("missingPageActionName"),
						desc: this.t("missingPageActionDesc"),
						control: {
							type: "dropdown",
							key: "missingPageAction",
							defaultValue: DEFAULT_SETTINGS.missingPageAction,
							disabled: () => !this.plugin.settings.clickToPage,
							options: {
								create: this.t("missingPageActionCreate"),
								openTag: this.t("missingPageActionOpenTag"),
								edit: this.t("missingPageActionEdit"),
								none: this.t("missingPageActionNone"),
							},
						},
					},
					{
						name: this.t("autocompleteName"),
						desc: this.t("autocompleteDesc"),
						control: {
							type: "toggle",
							key: "autocompleteOn",
							defaultValue: DEFAULT_SETTINGS.autocompleteOn,
						},
					},
					{
						name: this.t("autocompleteAliasesName"),
						desc: this.t("autocompleteAliasesDesc"),
						control: {
							type: "toggle",
							key: "autocompleteAliases",
							defaultValue: DEFAULT_SETTINGS.autocompleteAliases,
							disabled: () => !this.plugin.settings.autocompleteOn,
						},
					},
				],
			},
		];
	}
}
