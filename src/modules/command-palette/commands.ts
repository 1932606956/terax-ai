import { t } from "@/i18n/zh";
import type { SearchTarget } from "@/modules/header";
import { MAX_PANES_PER_TAB, type Tab } from "@/modules/tabs";
import { leafIds } from "@/modules/terminal";
import {
  Cancel01Icon,
  DashboardSquare01Icon,
  FileEditIcon,
  FileSearchIcon,
  Globe02Icon,
  IncognitoIcon,
  KeyboardIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  PaintBoardIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeftIcon,
  SourceCodeIcon,
  SparklesIcon,
  TerminalIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import type { PaletteItem } from "./types";

export const COMMAND_GROUPS = [
  t("palette.group.general"),
  t("palette.group.spaces"),
  t("palette.group.tabs"),
  t("palette.group.panes"),
  t("palette.group.git"),
  t("palette.group.search"),
  t("palette.group.view"),
  t("palette.group.ai"),
] as const;

export type CommandPaletteActionContext = {
  tabs: Tab[];
  activeId: number;
  searchTarget: SearchTarget;
  explorerRoot: string | null;
  home: string | null;
  openNewTab: () => void;
  openNewBlock: () => void;
  openNewPrivate: () => void;
  openNewEditor: () => void;
  openNewPreview: () => void;
  openGitGraph: () => void;
  toggleSourceControl: () => void;
  closeActiveTabOrPane: () => void;
  splitPaneRight: () => void;
  splitPaneDown: () => void;
  focusSearch: () => void;
  focusExplorerSearch: () => void;
  toggleSidebar: () => void;
  toggleHiddenFiles: () => void;
  toggleAi: () => void;
  askAiSelection: () => void;
  openSettings: () => void;
  openKeyboardShortcuts: () => void;
  spaces: { id: string; name: string }[];
  activeSpaceId: string | null;
  openSpacesOverview: () => void;
  newSpace: () => void;
  switchSpace: (id: string) => void;
};

const noop = () => {};

export function createCommandItems(
  ctx: CommandPaletteActionContext,
): PaletteItem[] {
  const activeTab = ctx.tabs.find((tab) => tab.id === ctx.activeId);
  const activeTerminalTab = activeTab?.kind === "terminal" ? activeTab : null;
  const activePaneCount = activeTerminalTab
    ? leafIds(activeTerminalTab.paneTree).length
    : 0;
  const onlyOneTab = ctx.tabs.length < 2;
  const noWorkspaceRoot = !ctx.explorerRoot && !ctx.home;
  const splitDisabled = !activeTerminalTab
    ? t("palette.reason.noTerminalTab")
    : activePaneCount >= MAX_PANES_PER_TAB
      ? t("palette.reason.paneLimit")
      : undefined;
  const closeDisabled =
    onlyOneTab && activePaneCount < 2 ? t("palette.reason.lastTab") : undefined;

  return [
    {
      id: "settings.open",
      title: t("palette.openSettings"),
      group: t("palette.group.general"),
      keywords: ["preferences", "config"],
      icon: Settings01Icon,
      shortcutId: "settings.open",
      run: ctx.openSettings,
    },
    {
      id: "theme.pick",
      title: t("palette.changeTheme"),
      group: t("palette.group.general"),
      keywords: ["theme", "appearance", "color", "dark", "light"],
      icon: PaintBoardIcon,
      run: noop,
    },
    {
      id: "shortcuts.open",
      title: t("palette.keyboardShortcuts"),
      group: t("palette.group.general"),
      keywords: ["keys", "keybindings", "settings"],
      icon: KeyboardIcon,
      run: ctx.openKeyboardShortcuts,
    },
    {
      id: "spaces.overview",
      title: t("palette.spacesOverview"),
      group: t("palette.group.spaces"),
      keywords: [
        "spaces",
        "sessions",
        "overview",
        "organize",
        "manage",
        "move",
      ],
      icon: DashboardSquare01Icon,
      run: ctx.openSpacesOverview,
    },
    {
      id: "spaces.new",
      title: t("palette.newSpace"),
      group: t("palette.group.spaces"),
      keywords: ["space", "session", "workspace", "group", "create"],
      icon: DashboardSquare01Icon,
      run: ctx.newSpace,
    },
    ...ctx.spaces.map((sp) => ({
      id: `spaces.switch.${sp.id}`,
      title: `${t("palette.switchTo")} ${sp.name}`,
      group: t("palette.group.spaces"),
      keywords: ["space", "switch", "session", sp.name],
      icon: DashboardSquare01Icon,
      disabledReason:
        sp.id === ctx.activeSpaceId
          ? t("palette.reason.currentSpace")
          : undefined,
      run: () => ctx.switchSpace(sp.id),
    })),
    {
      id: "tab.new",
      title: t("palette.newTerminal"),
      group: t("palette.group.tabs"),
      keywords: ["shell", "terminal", "new tab"],
      icon: TerminalIcon,
      shortcutId: "tab.new",
      run: ctx.openNewTab,
    },
    {
      id: "tab.newBlock",
      title: t("palette.newBlockTerminal"),
      group: t("palette.group.tabs"),
      keywords: ["blocks", "warp", "command blocks", "terminal"],
      icon: DashboardSquare01Icon,
      run: ctx.openNewBlock,
    },
    {
      id: "tab.newPrivate",
      title: t("palette.newPrivateTerminal"),
      group: t("palette.group.tabs"),
      keywords: ["privacy", "private", "incognito", "hidden from ai"],
      icon: IncognitoIcon,
      shortcutId: "tab.newPrivate",
      run: ctx.openNewPrivate,
    },
    {
      id: "tab.newEditor",
      title: t("palette.newEditorTab"),
      group: t("palette.group.tabs"),
      keywords: ["file", "editor", "create"],
      icon: FileEditIcon,
      shortcutId: "tab.newEditor",
      disabledReason: noWorkspaceRoot
        ? t("palette.reason.noWorkspaceRoot")
        : undefined,
      run: ctx.openNewEditor,
    },
    {
      id: "tab.newPreview",
      title: t("palette.newWebPreview"),
      group: t("palette.group.tabs"),
      keywords: ["browser", "web", "localhost", "preview"],
      icon: Globe02Icon,
      shortcutId: "tab.newPreview",
      run: ctx.openNewPreview,
    },
    {
      id: "tab.close",
      title: t("palette.closeTabOrPane"),
      group: t("palette.group.tabs"),
      keywords: ["close", "remove", "pane"],
      icon: Cancel01Icon,
      shortcutId: "tab.close",
      disabledReason: closeDisabled,
      run: ctx.closeActiveTabOrPane,
    },
    {
      id: "pane.splitRight",
      title: t("palette.splitPaneRight"),
      group: t("palette.group.panes"),
      keywords: ["terminal", "pane", "split", "right", "column"],
      icon: LayoutTwoColumnIcon,
      shortcutId: "pane.splitRight",
      disabledReason: splitDisabled,
      run: ctx.splitPaneRight,
    },
    {
      id: "pane.splitDown",
      title: t("palette.splitPaneDown"),
      group: t("palette.group.panes"),
      keywords: ["terminal", "pane", "split", "down", "row"],
      icon: LayoutTwoRowIcon,
      shortcutId: "pane.splitDown",
      disabledReason: splitDisabled,
      run: ctx.splitPaneDown,
    },
    {
      id: "git.graph",
      title: t("palette.openGitGraph"),
      group: t("palette.group.git"),
      keywords: ["git", "graph", "history", "log", "commits"],
      icon: SourceCodeIcon,
      run: ctx.openGitGraph,
    },
    {
      id: "git.source",
      title: t("palette.toggleSourceControl"),
      group: t("palette.group.git"),
      keywords: ["git", "source control", "changes", "staging", "diff"],
      icon: SourceCodeIcon,
      shortcutId: "pane.source",
      run: ctx.toggleSourceControl,
    },
    {
      id: "search.content",
      title: t("palette.findContentInFiles"),
      group: t("palette.group.search"),
      keywords: ["grep", "ripgrep", "text", "contents", "search in files"],
      icon: FileSearchIcon,
      trailing: "#",
      run: noop,
    },
    {
      id: "history.open",
      title: t("palette.searchCommandHistory"),
      group: t("palette.group.search"),
      keywords: ["history", "shell", "rerun", "previous commands"],
      icon: TerminalIcon,
      trailing: ">",
      run: noop,
    },
    {
      id: "search.focus",
      title: t("palette.findInCurrentTab"),
      group: t("palette.group.search"),
      keywords: ["find", "terminal", "editor", "current"],
      icon: Search01Icon,
      shortcutId: "search.focus",
      disabledReason: ctx.searchTarget
        ? undefined
        : t("palette.reason.noSearchableView"),
      run: ctx.focusSearch,
    },
    {
      id: "explorer.search",
      title: t("palette.searchFilesByName"),
      group: t("palette.group.search"),
      keywords: ["explorer", "workspace", "file", "open"],
      icon: Search01Icon,
      shortcutId: "explorer.search",
      disabledReason: ctx.explorerRoot
        ? undefined
        : t("palette.reason.noWorkspaceRoot"),
      run: ctx.focusExplorerSearch,
    },
    {
      id: "sidebar.toggle",
      title: t("palette.toggleFileExplorer"),
      group: t("palette.group.view"),
      keywords: ["sidebar", "files", "explorer"],
      icon: SidebarLeftIcon,
      shortcutId: "sidebar.toggle",
      run: ctx.toggleSidebar,
    },
    {
      id: "explorer.toggleHidden",
      title: t("palette.toggleHiddenFiles"),
      group: t("palette.group.view"),
      keywords: ["dotfiles", "hidden", "explorer", "gitignore", "env"],
      icon: ViewIcon,
      shortcutId: "explorer.toggleHidden",
      run: ctx.toggleHiddenFiles,
    },
    {
      id: "ai.toggle",
      title: t("palette.toggleAiAgent"),
      group: t("palette.group.ai"),
      keywords: ["assistant", "chat", "agent"],
      icon: SparklesIcon,
      shortcutId: "ai.toggle",
      run: ctx.toggleAi,
    },
    {
      id: "ai.askSelection",
      title: t("palette.askAiAboutSelection"),
      group: t("palette.group.ai"),
      keywords: ["selection", "explain", "assistant", "chat"],
      icon: SparklesIcon,
      shortcutId: "ai.askSelection",
      run: ctx.askAiSelection,
    },
  ];
}
