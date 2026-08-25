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
**Status:** pending
- manifest TypeBox schema + runtime 校验（含 `network.multiEdge` 能力开关）
- plugin contract 公开 interface（player 输入协议 module augmentation 挂点、`resolveEdges(ctx): Promise<Edge[]>` hook 契约）
- UIRegistryService 类型化 get<K> + module augmentation 基线

### Phase 4: 数据层基础设施
**Status:** pending
- TypeBox 表 DSL -> snapshot -> diff -> up/down .sql 编译器（自研仅此一层）
- Kysely 集成 + plugin migration registry（唯一 ID/拓扑排序/统一 ledger/增量迁移）
- 类型化 Repository + 统一事务 + change batch -> change bus -> typed observation
- 四端 SQLite adapter（原生模块 + Web SQLite Wasm/OPFS Worker）
- 雪花 ID 服务（TEXT 十进制存储）

### Phase 5: 启动链路
**Status:** pending
- loader plugin：发现/校验/依赖图/migration 排序/Cordis activation
- 插件状态机 discovered->...->active，失败 disabled/unavailable，更新回滚流程
- 恢复界面（错误详情/导出诊断/卸载）

### Phase 6: Shell 与导航
**Status:** pending
- AppShell 六区组件 + BottomNavigation 五 tab
- RouteRegistry + NavigationService（React Navigation v7 native-stack）+ 深链 resolver + Web URL 同步

### Phase 7: Feed/Card/Waterfall
**Status:** pending
- FeedSurface/FeedProvider 协议、session seed 排序、部分失败重试
- Waterfall 双列起步断点列数 2->3->4；统一 Card；ItemActionProvider 菜单

### Phase 8: Player 与资源体系
**Status:** pending
- player contract 运行时（redirect 递归解析/校验）、PlayerHost fullScreenModal
- resource repository/runtime/download 三件套 + ResourceScope 生命周期

### Phase 9: 业务插件
**Status:** pending
- 关注体系（subscription_group/subscription + SubscribableProvider）、搜索 SearchPage、书架、我的、历史/进度

### Phase 10: 平台服务
**Status:** pending
- network(ky)/EdgeRouter(竞速探测/plugin_endpoint 持久化/ensureSelected 兜底/withFailover)/scheduler(@cordisjs/plugin-timer 原语)/storage 治理/capability 门控/审计日志
- 可观测性文件导出插件 + 崩溃捕获 + 诊断导出

### Phase 11: 构建库
**Status:** pending
- dev/build/check/pack/typecheck 流水线；Hermes bytecode + Web ESM "3+2"；plugin.zip 打包

### Phase 12: 四端宿主工程
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

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|

## Next Step
Phase 3：核心协议包（manifest TypeBox schema + runtime 校验、plugin contract 公开 interface、UIRegistryService 类型化 get<K> + module augmentation 基线）。
