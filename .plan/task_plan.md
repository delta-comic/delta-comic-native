# Task Plan: Delta Comic Native 架构落地

## Goal
基于已确认的架构（docs/architecture.md），完成 delta-comic-native monorepo 的实现：Cordis all-in-plugin、Bare RN 四端、TypeBox 单模型数据层、UI registry 体系。

## 权威参考
- `docs/architecture.md` — 全部架构决策（唯一权威）
- `docs/design-language.md` — 设计语言与 token
- AGENTS.md — 工具链约定（vp / Node 26.2.0 / pnpm 12 rc / TS7 / 2 空格无分号单引号 100 列）

## Phases

### Phase 1: 架构计划落盘
**Status:** complete
- docs/architecture.md、task_plan.md、findings.md、progress.md 写入并提交

### Phase 2: Monorepo 包骨架
**Status:** complete
- packages 分组结构：core/*（协议、registry、db、loader）、ui/*（theme/button/list…）、plugins/*
- workspace catalog 补充核心依赖（cordis、kysely、@sinclair/typebox、react-navigation 等）

### Phase 3: 核心协议包
**Status:** complete（commit 见 progress.md）
- manifest TypeBox schema + runtime 校验（含 `network.multiEdge` 能力开关）
- plugin contract 公开 interface（player 输入协议 module augmentation 挂点、`resolveEdges(ctx): Promise<Edge[]>` hook 契约）
- UIRegistryService 类型化 get<K> + module augmentation 基线

### Phase 4: 数据层基础设施
**Status:** complete
- TypeBox 表 DSL -> snapshot -> diff -> up/down .sql 编译器（自研仅此一层）
- Kysely 集成 + plugin migration registry（唯一 ID/拓扑排序/统一 ledger/增量迁移）
- 类型化 Repository + 统一事务 + change batch -> change bus -> typed observation
- 四端 SQLite adapter（原生模块 + Web SQLite Wasm/OPFS Worker）
- 雪花 ID 服务（TEXT 十进制存储）

### Phase 5: 启动链路
**Status:** complete（commit 见 progress.md）
- loader plugin：发现/校验/依赖图/migration 排序/Cordis activation
- 插件状态机 discovered->...->active，失败 disabled/unavailable，更新回滚流程
- 恢复界面（错误详情/导出诊断/卸载）

### Phase 6: Shell 与导航
**Status:** complete（commit 见 progress.md）
- AppShell 六区组件 + BottomNavigation 五 tab
- RouteRegistry + NavigationService（React Navigation v7 native-stack）+ 深链 resolver + Web URL 同步

### Phase 7: AI 调试通道（Dev MCP）
**Status:** complete（commit 见 progress.md）
- 线协议 TypeBox schemas（protocol/lib/debug.ts），两端共享校验源
- packages/plugins/debug 官方插件（`__DEV__` 门控）：服务投影/环形事件捕获/命令执行（只走既有服务公开 API）
- scripts/dev-mcp：MCP server（stdio，官方 @modelcontextprotocol/sdk）+ 多设备 WS hub + 配对 token + 工具门控配置
- 工具面：观察（app_info/plugin_list/plugin_detail/db_schema/db_query/logs/events_recent/registry_list/diagnostics_export）+ 操控（plugin_reload/enable/disable、navigate）

### Phase 8: Feed/Card/Waterfall
**Status:** complete（commit 见 progress.md）
- protocol/lib/feed.ts：Item/ItemPage/FeedProvider/FeedSurfaceDescriptor/ItemAction(Provider) 协议类型
- packages/core/feed：seed 确定性排序纯函数；FeedSession 合并去重/seed 分值排序/cursor 独立分页/部分失败独立重试（全失败才整体 error）；FeedService（surface 注册表+会话工厂+Events 广播）；ItemActionService（applies 过滤+注册序拼接）
- packages/ui/waterfall：columnsForWidth 断点列数 2->3->4（<768/<1280/≥1280）纯函数 + Waterfall 分列组件
- packages/ui/card：WaterfallCard（封面/浏览量 overlay/时长徽章/作者行）+ ItemActionMenu 底部弹层

### Phase 9: Player 与资源体系
**Status:** complete（commit 见 progress.md）
- protocol：lib/resource.ts（ResourceDescriptor/ResourceProvider/ResourceOpenOptions/RangeUnsupportedError）+ PlayerInstance.render + redirect 放宽为任意注册协议
- db：resource/download_task 表 + core migration v2（v1 基座冻结）
- packages/core/resource：ResourceScope（LIFO/幂等）/ResourceRuntimeService（TTL 缓存/abort 联动/best-effort 落库）/双 Repository/DownloadService（断点续传/校验/并发泵/recoverStale）
- packages/core/player：PlayerService（semver 校验/redirect 递归+判环+深度上限/scope 失败即关/擦除入口 resolveErased）
- packages/ui/player：phaseForError 纯函数 + PlayerHost（ready/missing/error/resolving + 卸载 dispose+scope.close）+ Routes.player 声明与 openPlayer
- ui-shell：RootNavigator playerScreen 槽注册 'core/player' fullScreenModal

### Phase 10: 业务插件
**Status:** pending
- 关注体系（subscription_group/subscription + SubscribableProvider）、搜索 SearchPage、书架、我的、历史/进度

### Phase 11: 平台服务
**Status:** pending
- network(ky)/EdgeRouter(竞速探测/plugin_endpoint 持久化/ensureSelected 兜底/withFailover)/scheduler(@cordisjs/plugin-timer 原语)/storage 治理/capability 门控/审计日志
- 可观测性文件导出插件 + 崩溃捕获 + 诊断导出

### Phase 12: 构建库
**Status:** pending
- dev/build/check/pack/typecheck 流水线；Hermes bytecode + Web ESM "3+2"；plugin.zip 打包
- dev-mcp 接入 vp dev 工作流；生产 bundle 排除 debug 插件（零包含验证）

### Phase 13: 四端宿主工程
**Status:** pending
- Android/macOS/Windows 原生工程 + plugin-loader capability（Hermes/JSI 封装）+ Web 入口

## Decisions Made
| 决策 | 结论 |
|---|---|
| 数据库 schema | TypeBox 单模型，DSL 唯一源 -> .sql + Kysely 类型 + Value.Check |
| 主键 | 雪花 ID TEXT 存储 |
| 账号 | 纯本地源访问身份，用户域数据无账户外键 |
| 协议版本 | 与宿主 semver 相同 |
| 后台任务 | 首期最小版（存活期运行+续传） |
| 桌面布局 | 首期移动直出+列数自适应 |
| AI 调试通道 | 桥接拓扑（Web 无法监听端口倒逼）：dev-mcp stdio hub ↔ 应用 debug 插件 `__DEV__` 外连 WS；生产零包含；工具面观察+操控两档 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|

## Next Step
Phase 9：Player 与资源体系（player contract 运行时 + PlayerHost + resource 三件套）。
