# HuddleTab / 伙记 Design System Master

> Status: CONFIRMED
> Product: HuddleTab / 伙记 V1
> Visual direction: 清账青

## 1. Design principles

- 轻量、可信、清爽、现代、低视觉噪音。
- 移动端信息架构优先，宽屏只做居中加宽的响应式适配。
- 不复制默认 shadcn/ui Demo 风格；shadcn/ui 仅作为可访问组件原语来源。
- 亮色与暗色保持相同的信息层级、状态语义和交互能力。
- 不使用 Emoji 充当图标；统一使用 Lucide SVG。
- 不把所有内容都包进卡片，不使用大面积渐变、玻璃拟态或重阴影。

## 2. Semantic colors

### Light

| Token | Value | Usage |
|---|---:|---|
| `background` | `#F6F8F7` | 页面底色 |
| `surface` | `#FFFFFF` | Sheet、Dialog、主要内容面 |
| `surface-muted` | `#F1F5F3` | 摘要、选中、轻提示 |
| `foreground` | `#333333` | 主文本 |
| `muted-foreground` | `#56675F` | 辅助文本 |
| `primary` | `#146B52` | 主按钮、选中、关键链接 |
| `mint` | `#5DC0A7` | 柔和强调和插图点缀 |
| `orange` | `#FFB54D` | 轻量提示和插图点缀 |
| `red` | `#FF5C5C` | 非破坏性视觉提醒 |
| `on-primary` | `#FFFFFF` | 主色上的文本与图标 |
| `border` | `#DCE5E0` | 分隔和输入边界 |
| `warning` | `#8A5510` | 超额、待同步、注意事项 |
| `destructive` | `#C93636` | 删除、失败、危险操作 |
| `success` | `#217A55` | 已结清、成功状态 |
| `amount-receivable` | `#16745B` | 应收金额 |
| `amount-payable` | `#A64B00` | 应付金额 |
| `amount-danger` | `#C62828` | 异常金额 |

### Dark

| Token | Value | Usage |
|---|---:|---|
| `background` | `#0D1512` | 页面底色 |
| `surface` | `#14201B` | Sheet、Dialog、主要内容面 |
| `surface-muted` | `#1B2B24` | 摘要、选中、轻提示 |
| `foreground` | `#F1F7F4` | 主文本 |
| `muted-foreground` | `#A9BBB3` | 辅助文本 |
| `primary` | `#5DD6A7` | 主按钮、选中、关键链接 |
| `on-primary` | `#062017` | 主色上的文本与图标 |
| `border` | `#2A3B34` | 分隔和输入边界 |
| `warning` | `#F1B968` | 超额、待同步、注意事项 |
| `destructive` | `#FF7B7B` | 删除、失败、危险操作 |
| `success` | `#6BD89E` | 已结清、成功状态 |
| `amount-receivable` | `#5DD6A7` | 应收金额 |
| `amount-payable` | `#F1B968` | 应付金额 |
| `amount-danger` | `#FF7B7B` | 异常金额 |

## 3. Typography

```css
font-family:
  "Noto Sans SC",
  "PingFang SC",
  "Microsoft YaHei",
  system-ui,
  sans-serif;
```

- 中文界面统一使用 `Noto Sans SC`，英文、数字与金额使用 `Inter`。
- Display Amount：`32px / 40px / 600`；Amount Large：`20px / 28px / 600`；Amount：`16px / 24px / 600`。
- Page Title：`20px / 28px / 600`；Section Title：`15px / 22px / 600`。
- Body：`14px / 22px / 400`；Label：`13px / 20px / 500`；Caption：`12px / 18px / 400`。
- 金额和重要数字统一使用 `Inter`、`font-variant-numeric: tabular-nums`。
- 不依赖在线字体，保证私有部署与离线 App Shell 的中文显示稳定。

## 4. Spacing, radius, shadow, motion

- 基础间距采用 4px 网格：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40px`。
- 圆角仅使用 `8 / 12 / 16px / full` 四档；Input、Button 与普通 Card 默认 `12px`，重点 Card 与 Overlay 使用 `16px`。
- 阴影仅用于 Sheet、Dialog、浮动按钮和明确的层级分离。
- 动效：快速反馈 `160ms`、普通切换 `220ms`、Sheet/Dialog `280ms`。
- 支持 `prefers-reduced-motion`；禁用非必要位移与缩放。
- 不通过动画掩盖同步、保存或账务结果变化。

## 5. Interaction and accessibility

- 最小触控区域 `44×44px`，主要操作建议 `48px` 高。
- 相邻触控目标间距至少约 `8px`。
- 所有输入均有可见 Label，不使用 Placeholder 代替 Label。
- 图标按钮必须具有 accessible name；装饰图标从辅助技术树隐藏。
- 可见焦点环至少 `2px`，键盘焦点不得被固定导航、键盘或 Overlay 遮挡。
- 失败表单保留字段内联错误；多错误表单同时提供可聚焦的错误摘要。
- 状态不能只依赖颜色，必须同时使用文字、图标或形状。
- 允许密码管理器和粘贴，不阻止认证字段粘贴。

## 6. Responsive behavior

- 手机单列，通常使用 `16px` 水平间距。
- 大屏手机和平板使用 `24–32px` 自适应间距。
- 活动核心内容宽度限制在 `720–768px` 并居中。
- 系统管理内容可放宽至约 `960px`，但不建立桌面侧边栏或第二套信息架构。
- 手机 Bottom Sheet 在宽屏可呈现为居中 Dialog，字段顺序和提交行为保持一致。

## 7. Component rules

- shadcn/ui 仅作为 Dialog、Sheet、Form、Toast、Tabs、Dropdown Menu 等可访问原语来源。
- 所有组件只读取语义 Token，不在页面内硬编码主题色。
- 列表优先使用分组和留白，而非每行完整卡片边框。
- 主 CTA 每个视图通常只有一个；破坏性操作与主 CTA 视觉分离。
- 加载、空状态、离线、待同步、同步失败和版本冲突都有独立文案与可恢复操作。
- `MoneyAmount` 接收币种、最小单位 bigint 和语义色调；始终复用 Domain 金额格式化并使用等宽数字。
- `MemberAvatar` 与 `ActivityCover` 以稳定 ID 哈希选择六张本地插画回退视觉，不能使用随机值；真实图片地址始终优先，活动标题同时可见时封面为装饰图片。
- `AppHeader`、`EmptyState`、`SyncStatus` 只提供通用布局与语义插槽，不包含页面业务行为。

## 8. Anti-patterns

- 默认 shadcn Demo 视觉。
- 传统管理后台式侧边栏和大面积表格。
- 大面积渐变、玻璃拟态、3D 或强烈拟物。
- 灰色文字叠加灰色背景导致低对比度。
- 仅 Hover 可发现的操作。
- 使用颜色作为唯一状态信号。
- 强制 PWA 更新导致待同步数据丢失。
