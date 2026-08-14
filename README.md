# @blue-a11y/dsh-client-shortcuts

dsh web GUI 的全局键盘快捷键插件。`ShortcutRegistry`（即 `ctx.shortcuts` 服务）在 `window` 上挂一个捕获阶段的 `keydown` 监听并分发已注册的组合键；焦点在文本输入框内时默认放行（除非绑定显式声明输入框内可用）。设置面板提供 **「快捷键」页**（注册于 `settings.section`，基于 `@deepseek-ai/dsh-client-ui-primitives` 构建），列出全部可绑定动作，支持录制/重置改键、冲突检测与保留组合键拦截。node half 刻意为空——整个功能都是浏览器 UI。

`mod` 在 macOS 上匹配 Cmd、其他平台匹配 Ctrl（`e.metaKey || e.ctrlKey`），与 composer 的约定一致。UI 与本文档以 cmd 友好形式书写组合键（`cmd+l` ≡ `mod+l`）。

---

## 安装（给使用本插件的用户）

### 前置

- 已安装 `dsh` CLI（`npm i -g @deepseek-ai/dsh`）
- Node ≥ 22.19 与 pnpm 就绪

### 安装

本包是一个**组合包**（声明了 `dsh.bundle`），安装即自动激活其配置层。**推荐从 npm 安装**（预构建产物，零安装授权）：

```sh
dsh plugin --profile web add @blue-a11y/dsh-client-shortcuts
```

其他方式：

```sh
# 本地 checkout（开发期，改源码重建即热更新）
dsh plugin --profile web add ./dsh-client-shortcuts

# 打包产物 tarball
dsh plugin --profile web add ./dsh-client-shortcuts-0.1.0.tgz
```

### 激活与验证

新增插件行后需**重启一次 `dsh web`**（插件行发现在每次启动时缓存）：

```sh
dsh --profile web --dump-config   # 应看到 id: shortcuts 行
dsh web
```

浏览器打开后，在 设置 → 快捷键 应能看到设置页。之后每次源码重建，client HMR 链路会自动换新模块，无需重启。

### 卸载 / 更新

```sh
dsh plugin --profile web remove @blue-a11y/dsh-client-shortcuts   # 同时移除依赖与配置层
dsh plugin --profile web add @blue-a11y/dsh-client-shortcuts      # 更新 = 重新 add（锁定版本需指定版本号）
```

---

## 使用

### 可绑定动作

| 动作 | 默认键位 | 输入框内可用 |
| --- | --- | --- |
| 聚焦输入框 | `cmd+l` | — |
| 新建会话 | `cmd+shift+k` | ✅ |
| 切换侧栏 | `cmd+b` | ✅ |
| 切换详情面板 | `cmd+shift+e` | ✅ |
| 上一个会话 | `cmd+[` | ✅ |
| 下一个会话 | `cmd+]` | ✅ |
| 切换浅色/深色主题 | 未绑定 | — |
| 滚动到对话顶部 | 未绑定 | — |
| 滚动到对话底部 | 未绑定 | — |
| 分叉当前会话 | 未绑定 | — |

会话切换镜像侧栏的完整显示顺序（工作区按注册表顺序、组内按最近活动排序、未分组桶垫底），跳过「新建任务」空白条目与归档会话，并在两端**循环**（到底再切回第一个）。

### 改键与键位约束

无安全默认值的动作默认不绑定；在设置页录制组合键即可启用，重置则清回未绑定。

设置页会拒绝两类**永远无法触发**的组合键：

- **浏览器保留组合键**（`cmd+n/t/w`、`cmd+shift+n/t/w/i/j/c`、`cmd+alt+i/j/u`）：它们在页面监听器 `preventDefault` 之前就被浏览器消费，web 插件绑不住（Codex 这类桌面应用可以，所以它的键位不能照搬）。
- **macOS 的 Option/Alt 改写组合**：Option 会改写产出字符（`cmd+alt+c` 实际是 `ç`），导致 `event.key` 与注册键不再匹配。

### 设置页

打开 设置 → 快捷键。每行展示动作、当前组合键与触发计数。录制控件会暂停注册中心分发（按下的组合键被捕获而不是触发），校验与现有绑定的冲突并拒绝非法组合键。改键仅在插件 fiber 生命周期内有效——刷新页面恢复默认（持久化存储属于后续阶段）。

![快捷键设置页](docs/images/settings-page.png)

---

## 开发（给贡献本插件的开发者）

### 环境与克隆

```sh
git clone https://github.com/blue-a11y/dsh-client-shortcuts.git
cd dsh-client-shortcuts
pnpm install
```

### 目录结构

```
src/
├── index.ts               # node half：空 apply（宿主 Loader 导入用）
├── invariant.ts           # 包级 invariant 伴随件
└── client/
    ├── registry.ts        # ShortcutRegistry：捕获监听、combo 解析/匹配、disposer
    ├── actions.tsx        # 动作集定义（id/默认键/run）+ ShortcutBindings（改键/重置/计数）
    ├── settings.tsx       # 设置页组件（settings.section 注册、录制、样式注入）
    └── index.ts           # 浏览器入口：provide shortcuts 服务 + 挂默认绑定 + 挂设置页
tests/                     # vitest（jsdom）spec
docs/                      # 文档与截图
```

### 常用命令

```sh
pnpm install
pnpm run build    # tsc 生成 lib/types → tsdown 打包 lib/index.js + lib/invariant.js + lib/client.js
pnpm test         # vitest
```

### 构建与加载链路

- **node half**：`tsc` 先把 `src/` 转成 `lib/types/`，`tsdown` 再从那里产出 ESM 的 `lib/index.js`、`lib/invariant.js`（宿主 Loader 启动时 import）。
- **client bundle**：`lib/client.js`（CJS）带 `window.__ModuleLoader__.load({ id, factory })` 的 banner/footer；`react` 与 `@deepseek-ai/dsh-client-ui-primitives` 被外部化，运行时从 shell 模块表解析。
- **`prepare`** 跑同一构建，git 安装（`dsh plugin add github:...`）会从源码构建；pnpm ≥ 10 会要求 profile 在 `pnpm-workspace.yaml` 的 `allowBuilds` 中一次性授权。

### 本地热更新

1. `dsh plugin --profile web add ./dsh-client-shortcuts`（link 到本地目录）
2. 改源码 → `pnpm run build` → host 的 client HMR 每 500ms 探测 `lib/client.js` 变化 → SSE 广播 → 浏览器不刷新换新模块
3. 只有**新增/删除插件行**才需要重启 `dsh web`

### 新增一个动作

在 `src/client/actions.tsx` 的 `createActions()` 返回数组里追加一项：

```tsx
{
  id: 'my-action',
  defaultCombo: 'cmd+shift+m',   // '' 表示默认不绑定，用户录制启用
  label: '我的动作',
  allowInTextField: true,        // 输入框内是否也响应
  icon: <IconSomeOutline16 size={16} />,
  run: () => { /* 从 ctx.get('服务名') 读取目标服务并调用 */ },
}
```

动作的 `run()` 在按键时读取目标服务，遵循「缺服务则静默 no-op」；组合键用 cmd 友好形式书写，`mod` 与 cmd/ctrl 的映射由 `toRegistryCombo` 统一处理。

### 发布

```sh
pnpm publish    # prepare 会自动构建 lib/，发布即预构建产物，安装方无需构建授权
```

---

## Model Experience

无。快捷键服务只把浏览器键盘手势转发为 UI 动作，不触及任何模型请求。

## 已知限制与后续工作

- **改键不持久化** —— 仅存活于插件 fiber，刷新即恢复默认；`settingsNamespace` schema 是持久绑定的规划归宿。
- **聚焦输入框依赖 `[data-phase]` DOM 查询** —— 因为没有 composer 暴露聚焦服务；若将来有，应迁移到服务通道。
