# 已完成：右键“Open in Terax”传入文件夹地址

## 现状

- 右键菜单注册表项存在且有效（`installer-hooks.nsh` 写 `HKCU\...\Directory\shell\OpenInTerax`，
  命令为 `"terax.exe" "%V"`）。
- 根因已修：恢复分支在 active space 非空时丢弃 launch 路径的问题已解决。
- 无单实例转发机制：第二个进程是全新进程，不会把路径发给已运行实例（独立决策，先不做）。

## 根因（已修）

两层：

1. `useSpacesBoot.ts` 恢复分支 active space 非空时根本不看 launch 路径（已修：
   有 CLI 显式目录时追加一个终端 tab 并激活）。
2. 触发条件不能用 `launchCwd`（`workspace_current_dir` 在普通启动下也会回退到
   home/进程 cwd，非空是常态），必须用纯 CLI 目录。`get_launch_dir` 在无参数
   启动时为 null，正好当判据。

之前 `freshTabCwd` 的修改（local 下 `launchCwd ?? restoredHome ?? home`）只覆盖
active space 为空的分支，保留。

## 改动（已提交）

- `src/lib/launchDir.ts`：`initLaunchDir` 缓存拆分，新增 `getCliLaunchDir()`
 （纯 CLI 目录，无参数启动时为 undefined；`getLaunchDir()` 语义不变，
  仍带 `workspace_current_dir` 回退）。
- `src/modules/spaces/lib/activeSpace.ts`：新增纯函数 `launchCwdForRestore`
 （local + 有 CLI 目录 + active space 非空才返回目录；WSL 永远 null）。
- `src/modules/spaces/lib/useSpacesBoot.ts`：恢复分支接入 `cliLaunchCwd`，
  有值时追加 `freshTerminalTab(active, dir)` 并激活（磁盘上的 activeTabIndex
  不改，下次普通启动恢复顺序不变）；新 tab 同样走 `workspaceAuthorize`。
- `src/app/App.tsx`：`useSpacesBoot` 传入 `cliLaunchCwd: getCliLaunchDir() ?? null`。
- `src/modules/spaces/lib/activeSpace.test.ts`：`launchCwdForRestore` 4 个测试
  （命中 / 无参数 / WSL / active 为空）。

## 验证

- `pnpm exec vitest run src/modules/spaces src/lib`：8 文件 116 测试通过。
- `pnpm test`：232 文件 2501 测试通过。
- `pnpm check-types`：通过。
- `pnpm lint`：改动文件 warnings 与基线一致（4 个，均为 App.tsx 既有）。
- 真机验证待用户做：关掉旧实例，用右键从某目录启动，看新窗口是否落在该目录；
  再测已有实例运行时右键是否只开新窗口不干扰旧窗口。

## 风险提示

- 改动 `useSpacesBoot.ts` 恢复分支会影响所有带已保存会话的冷启动，
  `cliLaunchCwd` 为空时零行为变化（`launchCwdForRestore` 返回 null，
  激活逻辑走原分支）。
- WSL space 下 CLI 目录继续被忽略。
