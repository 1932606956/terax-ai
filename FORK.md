# 私有 Fork 维护说明

本仓库是 [crynta/terax-ai](https://github.com/crynta/terax-ai) 的**私有下游 fork**：

- **订阅上游**：定期同步 upstream 修复与功能，本地构建自用
- **不提 PR**：所有本地补丁只活在本 fork，不向上游回馈（明确决定，非遗漏）
- **汉化**：中文界面文案走 `l10n/zh-cn` 独立层，不与逻辑补丁混合

## 分支结构

| 分支 | 角色 |
|---|---|
| `main` | 上游镜像，跟随 `upstream/main`；唯一例外：`.github/` 下的 fork 基建（workflow_dispatch 的 workflow 必须在默认分支注册），不碰产品代码 |
| `l10n/zh-cn` | 汉化层，基于 `main`，只含 UI 文案改动（`src/i18n/zh.ts` 词典 + 组件 `t()` 接入），不含任何逻辑修改 |
| `fix/default-model-and-compat-context` | 本地定制构建线，叠加全部私有逻辑补丁，并 merge `l10n/zh-cn` 吸收汉化 |

```text
upstream/main
   │ ff-only
   ▼
main ──────────────┐
   │ merge         │ merge
   ▼               ▼
l10n/zh-cn ──merge──► fix/default-model-and-compat-context
(纯文案层)            (逻辑补丁 + 汉化, 出构建)
```

## 同步流程

```bash
git fetch upstream main
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout l10n/zh-cn
git merge main        # 文案冲突在此层解决：以本分支译名语义为准
git checkout fix/default-model-and-compat-context
git merge main        # 逻辑冲突在此层解决
git merge l10n/zh-cn  # 汉化层推进后吸收（通常无冲突）
git push origin l10n/zh-cn fix/default-model-and-compat-context
```

网络：GitHub 直连不稳时走代理 `git -c http.proxy=http://127.0.0.1:7890 fetch upstream main`。

## 汉化约定

- 词典唯一入口 `src/i18n/zh.ts`：`t(key)`，可选插值 `t(key, arg)` 替换 `{n}`；未知键回退为键名本身
- 组件接入：`import { t } from "@/i18n/zh"`（局部变量名 `t` 冲突时用 `t as tr`，见 TabBar.tsx）
- 新增文案：先加词典条目，再在组件引用；不在组件里写裸中文
- 上游改了同一行英文文案时，merge 冲突落在组件行；解决时保留 `t()` 调用形式，按新语义更新词典
- 第一批覆盖：设置窗口导航、命令面板、新建标签菜单、标签右键菜单、侧栏/顶栏、常用 toast。设置 sections 内部、AI 聊天区、diff 视图尚未翻译，按需在 `l10n/zh-cn` 上继续追加

## 构建

GitHub Actions 手动触发 Release workflow（`gh workflow run release.yml -R 1932606956/terax-ai --ref <分支>`），
云端出 Windows/macOS/Linux 产物，从 run 的 artifacts/releases 下载替换本机。

## 本地补丁清单

- `0e420b8` fix(ai): honor custom-endpoint models as default model
  - settings store 启动校验接受 compat-<id>（端点存活时），默认模型不再回落 gpt-5.4-mini
  - favorite/recent 模型 id 过滤放宽 compat-<id>（此前每次启动被洗掉）
  - AiMiniWindow 上下文指示器按当前端点 contextLimit 取值（不再恒 128k 兜底）
- `82383f0` feat(i18n): zh-CN 词典与高频界面汉化（在 `l10n/zh-cn` 上）
