# 全局快捷键插件 —— 开发交接文档

> 目标：给 DeepSeek Harness Web GUI（`dsh web`，127.0.0.1:3080）做一个**全局快捷键 client 插件**。
> 背景：官方 220+ 插件中**没有**快捷键插件；键盘处理目前散落在各 UI 组件里硬编码（Enter 发送、Escape 关浮层、Cmd+Z 撤销输入等），没有集中注册机制。

---

## 〇、开发状态（2026-08-13 完成）

**方向 1 已落地**：包 `packages/client/shortcuts/` 已建齐并构建、测试、挂载。

- 包名 `@deepseek-ai/dsh-client-shortcuts`；node half 空 apply，client half 提供 `ctx.shortcuts`（`ShortcutRegistry`：捕获阶段 keydown、`register(combo, handler, { allowInTextField })` 返回 disposer、焦点在 textarea/input/contentEditable 时默认放行）；
- 默认绑定：`mod+l` 聚焦 composer（`textarea[data-phase]` DOM 定位）、`mod+k` 新建会话（`ctx.workspaces.startSession()`，输入框内可用）、`mod+shift+c` 停止当前生成（session scope 的 `conversation.cancel()`，输入框内可用）；`mod` = `ctrlKey || metaKey`；
- 动作接入点确认：新建会话是 `IWorkspaces.startSession` 公开契约；停止是 ui-conversation 的 per-session `conversation` 服务（`ctx.get` 服务通道，未跨包值导入）；聚焦 composer 无服务可走，用 DOM 查询（README 已记 Known Limitation）；
- 关键坑位（比文档预估多踩的）：`dsh plugin add` 在 profile 目录（单成员 pnpm workspace）跑 pnpm，**deps 不能用 workspace:^ 协议** → 包 dependencies 为空、peer 用 registry 版本（cordis `^4.0.1` 与 healed 一致、invariants `^0.1.0-rc.6`），devDeps 才用 workspace:^；tsdown 构建前必须先 `tsc -b packages/client/shortcuts/tsconfig.json` 生成 lib/types（root build 不含方向 1 包）；`dev:web` 会通过 `dsh.client.platform === 'web'` 自动发现本包（无需注册 aggregate）；测试 25 个全绿、src per-file 100% 覆盖（vitest glob 会自动扫到包内 tests）；
- 挂载：`dsh plugin --profile web add ./packages/client/shortcuts` → profile dependencies `link:` 符号链接 + `dsh.profile.bundles` 追加本包；`--dump-config` 已确认 `shortcuts` 行进入组合树；
- 待办：重启 `dsh web`（插件行新增必须重启，扫描缓存不失效）后浏览器验证；后续改源码 `pnpm run dev:web` + 重建即热更新。

**验证已通过（同日）**：dsh web 已重启（新 PID）；`--dump-config` 含 shortcuts 行；`/plugins/@deepseek-ai/dsh-client-shortcuts/client.js` serve 200、首页 `__DSH_BOOT__` 注入带 rev；CDP 连 hibox 临时 Chrome 开 fixture 页面实测：bundle 执行零错误、`mod+l` 捕获命中（defaultPrevented）且 composer textarea 成功聚焦。验证期坑：fixture 页面「内测声明」浮层残留 `inert` 导致 focus 全部失效（页面自身状态机问题），解除 inert 后聚焦即正常；`mod+k`/`mod+shift+c` 依赖真实 services，fixture 下仅验证到 handler 命中（preventDefault），真实链路由 blue 实际按键验收。

**已提交 GitHub（同日）**：fork 至 blue-a11y/deepseek-harness，分支 `feat/client-shortcuts`（提交信息 feat(client-shortcuts): add global keyboard shortcuts plugin）。提交前补齐两处官方门禁兼容（方向 1 原预估的遗漏）：①`tsconfig.client.json` 的 references 需加本包条目（否则官方 typecheck 的 glob 认领报 TS6307）；②`packages/client` 下测试文件必须带 `.client.`/`.host.` 面后缀（`invariant.spec.ts` → `invariant.client.spec.ts`），否则被 host aggregate 吃掉。fork 的 Actions 默认禁用（GitHub 对新 fork 的标准行为），跑 CI 需在 fork 的 Actions 页启用。

**已拆独立仓库（2026-08-14，最终形态）**：blue 拍板拆库（官方推荐形态 = 独立 bundle 包，见 `docs/user/develop/basic/publish.zh.md`）。新家 **blue-a11y/dsh-client-shortcuts**（`dev/blue/dsh-client-shortcuts`，main 分支）：包名换 `@blue-a11y/dsh-client-shortcuts`，自包含构建（tsconfig + 独立 tsdown 配置照官方 `clientBundle` 参数：node half ESM `fixedExtension: false`、client bundle CJS banner/footer + `__ModuleLoader__.load`）+ `prepare` 脚本（git 安装自构建）+ 自带 vitest；25 测试全绿、零运行时依赖；本机 GUI 已重挂该仓库（`dsh plugin --profile web` remove 旧包 + add 新路径）并重启、CDP 回归 `mod+l` 聚焦通过。monorepo 已还原官方纯净状态（删 `packages/client/shortcuts/`、tsconfig.client.json 与 lockfile 还原、fork 分支已删）；本文件随插件迁移至此作为开发历程档案。

---

## 一、已确认的调研结论（本会话完成）

### 1. client 插件识别契约（host 端扫描）

`packages/client/modules/src/index.ts`（`ClientModuleRegistry`）：

- 监听 loader 的 `internal/plugin` 事件，增量扫描所有插件行的 `name`；
- 对每行 `require.resolve('<name>/package.json')`（锚点 = `ctx.baseUrl` = **profile 目录**的 cordis.yml）读 `package.json`；
- 校验 `dsh.client` 声明：
  - `platform: 'web'` —— 必需，否则忽略该包；
  - `inject: string[]` —— **纯信息性**（preflight 展示 / HMR diff），不影响激活顺序；
  - `immediately: boolean` —— 仅 stage-one 预取的基础设施行才用（如 runtime），普通 UI 插件**不要设**；
- 从 `exports["./client"]` 取 bundle 路径（约定 `lib/client.js`）→ 按内容 hash 出 `rev` → 注入 `window.__DSH_BOOT__` + serve `/plugins/<id>/client.js?rev=...`（含 `.map`）；
- **包名解析结果缓存永不失效** → 插件行增删要重启 `dsh web`；bundle 内容变化走 HMR `rebuilt()` 路径。

### 2. 构建

共享预设 `clientBundle(id, ['lib/types/index.js', 'lib/types/invariant.js'])`（`packages/client/tsdown.client.ts`）：

- node half：`lib/index.js`（ESM）—— host loader 必须能 import，至少要有这个产物；
- client bundle：`lib/client.js`（CJS），banner/footer 自动包成 `window.__ModuleLoader__.load({id, factory})`；
- **纯度门禁**：跨插件**值导入**在构建期直接报错；协作只能走 cordis 服务或 type-only 导入；
- serve 的是 `lib/client.js` 不是源码 → 改源码必须重建 bundle。

### 3. 浏览器端执行

- shell kernel 解析 `window.__DSH_BOOT__` → lazy CJS module table；
- bundle 脚本执行只**注册 factory**（零副作用），首次 import 才材质化执行 `apply`；
- 插件激活顺序 = cordis fiber 对 **services** 的 inject 等待（与 manifest inject 无关）。

### 4. 本地挂载与热更新

- ❌ 不能像 host 插件那样用**绝对路径 .ts 文件**挂载（`<spec>/package.json` 拼接必失败 → 被当成非 client 行）；
- ✅ 必须是一个**可解析的 npm 包**；官方路径：`dsh plugin --profile web add ./pkg`（pnpm 链接进 profile 的 node_modules + 自动追加 bundle 层）；
- 热更新链路（已内置）：`pnpm run dev:web`（tsdown watch 重建所有 `dsh.client` 包）→ host `client-hmr` 每 500ms stat-poll → `rebuilt()` → SSE `/plugins/events` → 浏览器 invalidate + 换新模块（**不刷新页面**）。

### 5. 环境事实

- 本机 `~/.dsh/profiles/web/` 是当前 GUI 的 profile（bundles: `dsh-base` + `dsh-web-app`），`package.json` 的 dependencies 为空；
- healed 共享模块目录：`~/.dsh/profiles/node_modules`（含 `@deepseek-ai/*`）；
- 官方仓库 clone：`/Users/bytedance/Documents/dev/blue/deepseek-harness`（浅克隆 depth=1）。

---

## 二、落地方向（已选：方向 1）

**方向 1：独立包 + workspace 成员开发 + `dsh plugin add` 挂载（不污染官方组合）**

1. 在仓库 `packages/client/shortcuts/` 建包（pnpm-workspace 已 glob `packages/*/*`），这样能吃仓库的 TS 类型、tsdown 预设和 `@deepseek-ai/cordis` peer dep；
2. **不要**做「新插件包三处注册」（tsconfig.client.json aggregate / web-app cordis.patch.yml / web-app package.json dependency）——那是给官方仓库贡献的路径；
3. 构建出 `lib/` 后：`dsh plugin --profile web add ./packages/client/shortcuts` 链接进 web profile（包自带 `dsh.bundle` + `cordis.patch.yml` 注册 client 行）；
4. 开发期跑 `pnpm run dev:web` 获得不刷新热更新；新增/删行后重启 `dsh web`。

> 备选方向 2（给官方提 PR）：同上建包 + 补三处注册 + 走 repo 的 AGENTS.md 全套门禁（test:gui、快照、Agent Note 等）。

---

## 三、包骨架清单（开发时按此创建）

```
packages/client/shortcuts/
├── package.json        # name: @deepseek-ai/dsh-client-shortcuts
│                       # exports: "." / "./invariant" / "./client" / "./src/*" / "./package.json"
│                       # dsh.client: { platform: 'web' }        ← 不设 immediately
│                       # dsh.bundle: { patch: './cordis.patch.yml' }
│                       # peerDeps: @deepseek-ai/cordis (workspace:^)
│                       # files: lib/index.js, lib/invariant.js, lib/client.js, lib/types/**/*.d.ts, cordis.patch.yml
├── cordis.patch.yml    # - insert: [{ id: shortcuts, name: '@deepseek-ai/dsh-client-shortcuts' }]
├── tsconfig.json       # extends tsconfig.base.client.json; rootDir src; outDir lib/types
│                       # references: 每个 workspace 依赖 + runtime-diagnostics/invariants
├── tsdown.config.ts    # clientBundle('@deepseek-ai/dsh-client-shortcuts', ['lib/types/index.js', 'lib/types/invariant.js'])
└── src/
    ├── index.ts        # node half：最小 apply（可为空体）；invariant 需要的导出
    ├── invariant.ts    # package-invariants 要求的伴随件（空安装器 + 合理说明）
    └── client/
        └── index.ts    # 浏览器端：apply(ctx) 里 provide 'shortcuts' 服务 + window keydown 监听
```

参照包：`packages/client/locale`（完整 client 插件样例）、`packages/client/ui-theme`。

---

## 四、快捷键插件设计要点

### 服务形态（Harness 风格）

```ts
// src/client/index.ts 骨架（已在会话中确认可行）
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    shortcuts: ShortcutRegistry   // 类型合并：其他插件可用 ctx.shortcuts 注册
  }
}

export class ShortcutRegistry {
  constructor(private ctx: Context) {
    ctx.effect(() => {
      const onKeyDown = (e: KeyboardEvent) => this.handle(e)
      window.addEventListener('keydown', onKeyDown, true)   // 捕获阶段
      return () => window.removeEventListener('keydown', onKeyDown, true)
    })
  }
  register(combo: string, handler: () => void): void { /* 'mod+k'，mod=Cmd/Alt? 见下 */ }
  private handle(e: KeyboardEvent): void { /* 解析组合键 + 触发 */ }
}

export function apply(ctx: Context): void {
  ctx.provide('shortcuts', new ShortcutRegistry(ctx))
}
```

### 关键设计决策（开发时需落实）

1. **焦点冲突**：Escape/Enter/Cmd+Z 已被 composer keyboard machine（`ui-input-trigger`/`InputBar.tsx`）占用。全局监听用**捕获阶段**，且当焦点在 `textarea/input/contentEditable` 时**默认放行**（或按 combo 配置是否放行）——避免破坏现有输入体验；
2. **`mod` 键**：macOS 用 `metaKey`、Win/Linux 用 `ctrlKey`（参考 `InputBar.tsx` 的 `e.ctrlKey || e.metaKey` 写法）；
3. **可配置化**（可选二期）：走 `settings` 服务 + `settingsNamespace` 注册 schema（参照 `ui-theme`/`locale` 的做法），让用户自定义绑定；
4. **动作接入点**（开发时查 client 端可用服务）：聚焦输入框、新建会话、停止当前回合、切换会话等动作，需通过 client 端现有服务实现（`connection`/`sessions`/`ctx.slots` 等），不可绕开 slot 体系直接碰 DOM 组件状态；
5. **守门**：遵守 `packages/client/AGENTS.md` —— components 不见 ctx、跨插件值导入禁止、store 用工厂函数等（本包若纯 service + 少量监听，可能不需要组件）。

### 建议默认绑定（待 blue 拍板，避开已占用键）

| 快捷键 | 动作 | 备注 |
|---|---|---|
| `mod+l` | 聚焦 composer 输入框 | 最常用 |
| `mod+k` | 新建会话 | 文档站用 K 是搜索，GUI 内未占用 |
| `mod+shift+c` | 停止当前生成 | 需确认 client 端停止 API |
| `mod+j` / `mod+k` 冲突，改 `mod+↑/↓` | 切换会话 | 可选，二期 |

---

## 五、开发与验证步骤（按序）

1. `pnpm install`（首次，确保 workspace 链接与依赖就绪；node ^22.19 || >=24）；
2. 按「三」建包（包名、manifest、tsdown、源码）；
3. 构建：`pnpm --filter @deepseek-ai/dsh-client-shortcuts bundle`（或 `pnpm run dev:web` 持续 watch）；
4. 挂载：`dsh plugin --profile web add ./packages/client/shortcuts`；
5. 重启 `dsh web`（插件行是新增的，必须重启）→ 打开 http://127.0.0.1:3080 验证；
6. 后续改源码：`dev:web` watch 自动重建 → 页面不刷新生效（`client-hmr` 已在 base 层挂载）；
7. 验证快捷键在「焦点在输入框 vs 不在」两种场景的行为都符合预期。

### 坑位备忘

- `lib/client.js` 缺失或未重建 → 启动抛 `MissingClientBundleError`（提示 `run pnpm run build`）；
- `dsh.plugin` 包没有 `dsh.bundle` 声明 → `dsh plugin add` 只当普通依赖、不激活层（会打警告）；
- client 行挂了但 host import 失败（缺 `lib/index.js`）→ fiber FAILED，行不会被计入 client graph；
- profile 的 `cordis.patch.yml` 是用户层，`--patch` overlay 是最外层——按行 id 后写胜出、整段 config 替换（不深合并）。

---

## 六、参考文件索引（仓库内）

| 主题 | 位置 |
|---|---|
| client 扫描/serve/boot manifest | `packages/client/modules/src/index.ts`、`src/client/manifest.ts` |
| client bundle 构建预设 | `packages/client/tsdown.client.ts` |
| HMR（node+browser half） | `packages/client/hmr/src/` |
| client 插件开发规则 | `packages/client/AGENTS.md`（新插件包 checklist） |
| 完整 client 插件样例 | `packages/client/locale`、`packages/client/ui-theme` |
| composer 键盘 machine（冲突参照） | `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` |
| dev:web 编排 | `scripts/dev-web.ts` |
| 打包/安装官方教程 | `docs/user/develop/basic/publish.zh.md` |
| 仓库开发规范 | 根 `AGENTS.md`、`packages/AGENTS.md`、`docs/architecture.md` |
