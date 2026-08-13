# 快捷键设置页 —— 动态插件原型交接文档

> 时间：2026-08-14 ｜ 目标机器：blue 的个人电脑
> 本文件是「设置面板里的快捷键页面」的**动态 Cordis 插件原型**交接：完整代码、挂载步骤、设计要点、下一步计划。
> 配套档案：`docs/SHORTCUTS-PLUGIN.md`（持久插件开发全程档案）。

---

## 一、背景与定位

- 持久插件（本仓库）提供 `ctx.shortcuts` 服务：`register(combo, handler, options) → disposer`，默认绑定 `mod+l` / `mod+k` / `mod+shift+c`。
- 本原型用**动态 Cordis 插件**（`cordis_define` + `cordis_run`）在 GUI 设置面板注册一个「快捷键」页：
  - 展示三个默认绑定；
  - 提供**临时绑定**演示：输入 combo → 添加 → 按键触发计数 → 移除，全部内存态；
  - 完整演示「动态插件消费持久插件服务」的互通链路。
- **动态插件是临时的**：只存在于当前 dsh web 进程，重启即失；换机器必须重新 define + run（本文件就是为此准备的）。

## 二、本机状态（交接时点）

- 插件：`shcut-1`，当前版本 `pkg-2`（主题色修正版），已授权（双勾状态可免批后续版本）。
- 运行方式：Host 无代码，纯 Client 插件；设置面板导航「通用设置 → **快捷键** → 模型」。
- 更新流程：`cordis_define`（existing `shcut-1`）追加 package → `cordis_run`（mode `update`）。

## 三、挂载步骤（新机器照做）

1. 环境准备：装 Node（≥22.19）+ pnpm + `npm i -g @deepseek-ai/dsh`；挂载持久插件 `dsh plugin --profile web add ./dsh-client-shortcuts` 并重启 `dsh web`（详情见 `docs/SHORTCUTS-PLUGIN.md` 换机指南）。
2. 打开 GUI 会话，用 `cordis_define` 提交第四节的代码（`kind: "new"`，idPrefix 自定），拿到 pluginId/packageId。
3. `cordis_run` 激活；首次需要用户在 GUI 审批卡片点允许。
4. 验收：设置面板出现「快捷键」页；添加 `mod+t` 后任意位置按 Cmd/Ctrl+T，页面显示触发计数。

## 四、完整插件代码（Client half，直接可提交给 cordis_define）

```js
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const DEFAULT_BINDINGS = [
      ['mod+l', '聚焦输入框'],
      ['mod+k', '新建会话（输入框内也可用）'],
      ['mod+shift+c', '停止当前生成（输入框内也可用）'],
    ]
    const cell = { padding: '16px 20px', color: 'var(--dsw-alias-label-primary)' }
    const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' }
    const mono = { fontFamily: 'ui-monospace, monospace', fontSize: 13, background: 'var(--dsw-alias-bg-layer-2)', padding: '3px 9px', borderRadius: 6, color: 'var(--dsw-alias-label-primary)' }
    const descStyle = { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }
    const inputStyle = { flex: 1, background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '8px 10px', color: 'var(--dsw-alias-label-primary)', marginRight: 8 }
    const buttonStyle = { background: 'var(--dsw-alias-brand-primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' }
    const ghostStyle = { background: 'none', border: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-primary)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }

    function ShortcutsSection(props) {
      const [items, setItems] = React.useState([])
      const [combo, setCombo] = React.useState('')
      const [message, setMessage] = React.useState('')
      const [error, setError] = React.useState('')
      const registryRef = React.useRef([])
      React.useEffect(() => () => {
        for (const item of registryRef.current) item.dispose()
      }, [])

      const add = () => {
        const normalized = combo.trim()
        if (normalized === '') return
        const shortcuts = ctx.get('shortcuts')
        if (shortcuts === undefined) {
          setError('ctx.shortcuts 服务不可用，请确认持久插件已挂载')
          return
        }
        try {
          const entry = {
            combo: normalized,
            hits: 0,
            dispose: shortcuts.register(normalized, () => {
              entry.hits += 1
              setMessage('刚刚触发：' + normalized + '（第 ' + entry.hits + ' 次）')
            }, { allowInTextField: true }),
          }
          registryRef.current.push(entry)
          setItems(prev => [...prev, entry])
          setCombo('')
          setError('')
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }

      const remove = (target) => {
        target.dispose()
        registryRef.current = registryRef.current.filter(item => item !== target)
        setItems(prev => prev.filter(item => item !== target))
      }

      return React.createElement('div', { style: cell },
        React.createElement('h2', { style: { fontSize: 17, margin: '0 0 4px' } }, '快捷键'),
        React.createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12 } },
          '默认绑定由持久插件注册，本页可添加仅当前运行期有效的临时绑定。'),
        DEFAULT_BINDINGS.map(row => React.createElement('div', { key: row[0], style: rowStyle },
          React.createElement('span', { style: mono }, row[0]),
          React.createElement('span', { style: descStyle }, row[1]),
        )),
        React.createElement('div', { style: { margin: '18px 0 10px', display: 'flex' } },
          React.createElement('input', {
            style: inputStyle,
            value: combo,
            placeholder: '例如 mod+t 或 mod+shift+b',
            onChange: event => setCombo(event.target.value),
            onKeyDown: event => { if (event.key === 'Enter') add() },
          }),
          React.createElement('button', { style: buttonStyle, onClick: add }, '添加'),
        ),
        error !== '' ? React.createElement('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13, marginBottom: 8 } }, error) : null,
        message !== '' ? React.createElement('div', { style: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 13, marginBottom: 8 } }, message) : null,
        items.length > 0 ? items.map(item => React.createElement('div', { key: item.combo, style: rowStyle },
          React.createElement('span', { style: mono }, item.combo),
          React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            React.createElement('span', { style: descStyle }, '触发 ' + item.hits + ' 次'),
            React.createElement('button', { style: ghostStyle, onClick: () => remove(item) }, '移除'),
          ),
        )) : null,
      )
    }

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'shortcuts', order: 5, label: '快捷键' },
      props => React.createElement(ShortcutsSection, { close: props.close }),
    ))
  },
}
```

## 五、设计要点（踩坑记录）

1. **设置页入口**：`settings.section`（list slot）。注册项 `{ id, order, label }`，ownerProps 为 `{ close }`；fresh id（`shortcuts`）加在官方条目旁，order 5 排在「通用设置(0)」与「模型(10)」之间。单个小偏好用 `settings.general.item`，整页才用 section。
2. **主题色必须用 `--dsw-alias-*` 语义变量**：`label-primary/secondary`（文字）、`bg-layer-1/2`（表面）、`border-l1/l2`、`brand-primary`、`state-error/success/warn-primary`。第一版手写 `--dsw-text-primary` 等不存在 → fallback 浅色文字在浅色主题下「很浅」（blue 验收反馈后修正）。
3. **临时绑定的生命周期**：`register()` 的 disposer 存进 `useRef` 数组，组件卸载 cleanup 统一 dispose；插件 fiber dispose 时 slot 移除 → 组件卸载 → cleanup 兜底。双重清理，无泄漏。
4. **动态插件环境**：纯 JS，无 import/TS/JSX；`React.createElement` 全局可用；组件闭包可以直接捕获 `ctx`（动态插件无「components 不见 ctx」的仓库纪律）。
5. **验证手段**：`cordis_inspect_query`（Client `Slots.listSubTree` root=settings.section）看 occupants 是否含 `dyn/<pluginId>`；Client 查询需要页面应答，页面未打开会 `cancelled`。fixture 新标签页**不会**加载动态插件（会话级扩展），验收必须在当前页面做。
6. **持久插件服务消费**：`ctx.get('shortcuts')`（可选依赖，undefined 时给用户可见错误提示）。combo 语法与默认绑定一致（`mod`=ctrl/meta）。

## 六、下一步（固化方向）

把设置页从「动态原型」升级为持久插件的正式功能：

1. `src/client/` 增加设置 UI 组件 + `settings.section` 注册（复用本文件组件，样式改 CSS Modules + token）；
2. 用 `settingsNamespace` 注册 schema，把自定义绑定持久化到 `settings.yaml`（参照官方 locale/ui-theme 的 settings 注册方式）；
3. `ShortcutRegistry` 增加绑定列表读取/注销 API，设置页与默认绑定合并展示；
4. 冲突检测（combo 已被 composer 占用时提示）与「恢复默认」按钮。

> 建议落地时先在本机 monorepo 外的新 clone 环境验证（本机已无官方仓库本地 clone）。
