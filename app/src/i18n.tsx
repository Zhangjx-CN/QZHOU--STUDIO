import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Language = "zh-CN" | "en-US";

const messages = {
  "zh-CN": {
    brand: "轻舟", caption: "AI 工作台", workspace: "工作空间", chat: "工作台", agents: "智能体", models: "连接管理", dashboard: "调用概览", files: "项目文件", projects: "项目", new: "新建", projectOptions: "项目选项", localWork: "你的工作，留在这里", localWorkSub: "项目与产物保存在本机", noActive: "最近 14 天没有活跃项目", firstProject: "＋ 创建你的第一个项目", language: "语言", chinese: "简体中文", english: "English", editProject: "编辑项目", createProject: "创建新项目", projectName: "项目名称", projectDescription: "项目说明", projectFolder: "项目文件夹", cancel: "取消", save: "保存修改", saving: "保存中…", creating: "创建中…", history: "历史项目管理", historySub: "所有项目和对应的对话记录", noHistory: "还没有历史项目", open: "打开", done: "完成", newChat: "新对话", blankChat: "开始一段空白对话", newProject: "新建项目", openProject: "创建并打开一个项目", group: "分组", recent: "最近更新", byName: "名称", filter: "对话筛选", all: "全部", active: "活跃", expand: "展开全部项目", collapse: "收起全部项目", rename: "重命名", remove: "删除", confirmRemove: "确认删除", unset: "（未设置）", outputFiles: "产出文件", openFileList: "打开文件列表", selectProject: "请在左侧选择项目以查看产出文件。", noFolder: "可留空"
  },
  "en-US": {
    brand: "QZHOU", caption: "AI Workspace", workspace: "WORKSPACE", chat: "Workspace", agents: "Agents", models: "Connections", dashboard: "Overview", files: "Project files", projects: "Projects", new: "New", projectOptions: "Project options", localWork: "Your work stays here", localWorkSub: "Projects and artifacts are stored locally", noActive: "No active projects in the last 14 days", firstProject: "+ Create your first project", language: "Language", chinese: "简体中文", english: "English", editProject: "Edit project", createProject: "Create project", projectName: "Project name", projectDescription: "Description", projectFolder: "Project folder", cancel: "Cancel", save: "Save changes", saving: "Saving…", creating: "Creating…", history: "Project history", historySub: "All projects and their conversations", noHistory: "No project history yet", open: "Open", done: "Done", newChat: "New chat", blankChat: "Start a blank conversation", newProject: "New project", openProject: "Create and open a project", group: "Group", recent: "Recently updated", byName: "Name", filter: "Conversation filter", all: "All", active: "Active", expand: "Show all projects", collapse: "Collapse all projects", rename: "Rename", remove: "Delete", confirmRemove: "Confirm delete", unset: "Not set", outputFiles: "Artifacts", openFileList: "Open file list", selectProject: "Select a project on the left to view its artifacts.", noFolder: "Optional"
  }
} as const;

type I18nValue = { language: Language; setLanguage: (language: Language) => void; t: (key: keyof typeof messages["zh-CN"]) => string };
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem("qzhou-language");
    if (saved === "zh-CN" || saved === "en-US") return saved;
    return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  });
  const setLanguage = (next: Language) => { setLanguageState(next); localStorage.setItem("qzhou-language", next); };
  const value = useMemo(() => ({ language, setLanguage, t: (key: keyof typeof messages["zh-CN"]) => messages[language][key] }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
