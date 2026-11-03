# 私有 Fork 维护说明

本仓库是 [crynta/terax-ai](https://github.com/crynta/terax-ai) 的**私有下游 fork**：

- **订阅上游**：定期同步 upstream 修复与功能，本地构建自用
- **不提 PR**：所有本地补丁只活在本 fork，不向上游回馈（明确决定，非遗漏）

## 分支结构

| 分支 | 角色 |
|---|---|
| `main` | 上游镜像，跟随 `upstream/main`；唯一例外：`.github/` 下的 fork 基建（workflow_dispatch 的 workflow 必须在默认分支注册），不碰产品代码 |
| `fix/default-model-and-compat-context` | 本地定制构建线，叠加全部私有补丁，定期 `git merge main` 吸收上游 |

## 同步流程

```bash
git fetch upstream main
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout fix/default-model-and-compat-context
git merge main   # 冲突时以本分支语义为准逐文件解决
git push origin fix/default-model-and-compat-context
```

网络：GitHub 直连不稳时走代理 `git -c http.proxy=http://127.0.0.1:7890 fetch upstream main`。

## 构建

GitHub Actions 手动触发 Release workflow（`gh workflow run release.yml -R 1932606956/terax-ai --ref <分支>`），
云端出 Windows/macOS/Linux 产物，从 run 的 artifacts/releases 下载替换本机。

## 本地补丁清单

- `0e420b8` fix(ai): honor custom-endpoint models as default model
  - settings store 启动校验接受 compat-<id>（端点存活时），默认模型不再回落 gpt-5.4-mini
  - favorite/recent 模型 id 过滤放宽 compat-<id>（此前每次启动被洗掉）
  - AiMiniWindow 上下文指示器按当前端点 contextLimit 取值（不再恒 128k 兜底）
