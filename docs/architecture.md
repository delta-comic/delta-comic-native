# Delta Comic 架构设计

> 状态：brainstorming 全部确认项落盘（2026-08-25）。实现细节以本文档为唯一权威来源。

## 1. 总体形态

- **四端**：Android / Web / macOS / Windows。Bare React Native 路线：Community CLI 管宿主与原生工程；React Native Web / react-native-macos / react-native-windows 覆盖对应平台。Expo 仅作为 Modules API 按需使用（如 expo-image），不作为应用工作流。
- **New Architecture 基础保留**：Fabric、TurboModules、JSI、Codegen 为基础能力。
- **Cordis 为贯穿整个应用的元框架**：Service/Events/effect/loader 构成应用运行时基座——服务发现、依赖注入、生命周期、事件总线、配置与热更新全部由 Cordis 承担；UIRegistry、数据 Repository、scheduler、NavigationService、capability 等所有跨插件协议均以 Cordis service/event 形态表达，宿主与动态插件共享同一套上下文模型。
- **all-in-plugin**：`packages/*/*` 下每个子 repo 都是一个独立 Cordis plugin；应用入口极薄，只负责挂载 Cordis root 与启动 loader。插件支持远程动态加载 JS 与资源；无沙箱模型，用户安装即同意其拥有宿主扩展权限；动态插件不可新增原生二进制，原生能力全部由宿主或官方 capability plugin 预注册。
- **scripts 同为 monorepo 成员**：workspace 覆盖 `scripts/*`，每个子目录是一个独立脚本包；该目录集中存放各类脚本程序（构建辅助、发布流程、开发工具等），属于宿主工程侧的工具集合。
- **插件市场为外部项目**：负责认证、作者身份、签名审核、目录、分发、安装/更新/卸载/回滚/状态同步。客户端只定义并消费 Market Adapter 协议：`catalog / install / update / uninstall / rollback / status`。权限决策归市场，客户端提供 capability 门控、审计日志、错误反馈协议。
- **插件包**：`plugin.zip` = `manifest.json` + 入口 + chunks + assets + types + sourcemaps。入口采用 common + platform override：任意 plugin 可声明 `common/web/android/macos/windows` 入口，manifest 显式声明平台、入口、fallback、能力依赖。
- **执行策略 "3+2"**：Hermes 端（android/macos/windows）优先 bytecode `.hbc`，Web 使用 ESM；协议、manifest、Host API、Cordis lifecycle 三端一致。原生 `plugin-loader` capability 封装 Hermes/JSI 细节（bytecode 校验、加载、模块注册），协议不暴露 Hermes C++/JSI。manifest 记录 platform、runtime、Hermes bytecode version、React Native/Hermes version range、CPU 架构、编译选项摘要、sha256、fallback。
- **构建库第一版仅构建流水线**：dev/build/check/pack/typecheck——生成 common/platform bundle、Web ESM、Hermes bytecode、manifest、hash、source map、types、plugin.zip；模板生成器留扩展点。

## 2. UI 体系

- **分组 repo**：`packages/ui/button`、`packages/ui/list` 等；shadcn 思路=源码复制到本地、可读可改。
- **两级模式**：基础 `ui/*` plugin 提供默认组件/registry/token/组件契约；应用级 UI plugin 负责全局主题、共享组件、产品级覆盖；业务 plugin 可局部复制定制。
- **UIRegistryService**：类型化 `get<K extends keyof UIRegistry>(key: K): UIRegistry[K]`；key 分层命名（`ui/button`）；plugin 经 TypeScript module augmentation 扩展 registry 类型；覆盖必须显式声明目标 key、兼容版本、优先级。React hooks 只是上层适配，底层协议是 Cordis service。
- **运行时校验**：远程 manifest、实际导出、版本兼容均需 runtime schema 校验（TypeBox），TS 约束编译期。
- **样式**：Tailwind CSS v4 + NativeWind v5（预发布路线）+ tailwind-merge + CSS vars token；styling runtime 内部实现不进稳定组件协议。
- **primitives 映射**：div→View、文本→Text、按钮→Pressable、输入→TextInput、滚动→ScrollView/FlatList、图片→Image（expo-image）、portal→Modal 或自定义 host。
- **设计语言**：见 [design-language.md](./design-language.md)（品牌粉=交互语义、工具蓝=工具图标、明暗同构、`--dc-*` token）。

## 3. 数据层

### 3.1 存储与查询
- SQLite 单库；Kysely 作为查询层；migration 执行走 Kysely Migrator + 自定义 provider；`kysely-ctl` 用于开发期管理。
- 四端统一 SQLite adapter：原生端原生 SQLite 模块，Web 端 SQLite Wasm + OPFS Worker（OPFS 不可用时降级 transient，Vite 处理 WASM/Worker）。

### 3.2 TypeBox 单模型（schema 唯一源）
```
TypeBox 表 DSL（唯一源）
  -> normalized snapshot
  -> diff 上一 snapshot
  -> migration plan（additive / data migration / table rebuild 显式分类，不静默猜测）
  -> up/down .sql migration 文件（沿用插件 migration 协议）
  -> Static 推导 Kysely Database 类型
  -> Value.Check 提供运行时校验
```
自研面收敛在 snapshot/diff/DDL emit 一层；复杂 ALTER 的 table rebuild 判定在此层显式处理。TypeBox v1.x 基于 TS7 native compiler、ESM-only、JSON Schema 2020-12，与仓库工具链契合。

### 3.3 Plugin Migration Registry（自建）
- 收集核心与插件 migration；校验唯一 ID、依赖拓扑排序；统一 ledger；支持动态插件增量迁移。
- migration 协议：仅包内 `.sql` 文件，`migrations/up/N_xxx.sql` + `migrations/down/N_xxx.sql` 同序号一一配对，按文件名开头数字序号升序执行；前导零冲突等视为未定义行为。
- 表名全局稳定唯一（SQLite 无 namespace）；复杂 ALTER 必须显式 table rebuild/data migration。
- data plugins：`content-data` / `library` / `history` / `progress` / `download`。

### 3.4 归一化与响应式
- 硬约束：所有数据必须归一化，不能归一化的排除。
- 所有读写经类型化 Repository；跨 Repository 用统一事务；commit 后发 change batch -> change bus -> typed observation。
- `change_log` 是基础设施表，职责仅为 typed observation + 保留策略裁剪（无 sync 上行职责）。

### 3.5 ID 与账号（纯本地策略）
- 主键：雪花 ID，64 位自定义布局（时间戳 | 实体类型/分片 | 序列号），SQLite 以 TEXT 十进制字符串存储（规避 JS 64 位精度问题）。
- 账号=源访问身份：`platform` / `account` 基础设施表，同平台多账户；登录流程由来源插件 AccountProvider 自定义，核心不内置认证形态。
- 用户域数据（历史/进度/订阅/收藏/书架）完全本地化，无账户外键；无远端 sync 预留。

### 3.6 内容树与播放器
- 内容树：`Content -> Collection -> Item -> Resource`。Item=最小打开/播放/阅读/进度单元，必填 `playerKey`；应用不内置任何内容源与播放器。
- player contract：按 key 请求插件，返回 PlayerInstance（RN UI 组件+控制器+dispose）或 `redirect(key, convertedInput)` 递归解析；禁止依据媒体语义/key 相似性/capability 自动 fallback。输入协议经公开 interface module augmentation 注册；运行时校验插件存在、协议版本、schema、循环、最大深度。
- PlayerHost 只负责挂载、宿主生命周期、loading/error/missing/unavailable、容器、dispose；资源由集中 ResourceRuntime 提供。
- resource 三件套：`repository`（归一化 Resource）/ `runtime`（resolve/open/lease/cache/cancel/release）/ `download`（下载任务/断点续传/校验/清理）。ResourceScope 随 PlayerInstance 创建，PlayerHost 卸载时 close。
- 本地优先（离线等级 2）：资料库、内容详情、索引、来源结果缓存本地保存；完整资源下载后置。

## 4. Shell / Feed / Card

- AppShell = SystemChrome + TopBar(Brand/Search/工具动作) + SecondaryNavigation + Waterfall + BottomNavigation(首页/关注/添加/书架/我的) + ModalHost；深色移动端风格。添加=PrimaryAction 可由插件注册导入/添加动作；书架承载收藏/稍后/继续消费/下载状态；我的承载设置/插件管理/缓存状态。
- Feed 两级结构：`SecondaryTab -> FeedSurfacePlugin -> FeedProvider[] -> Item[] -> Waterfall -> Card`。一个 FeedSurface 对应一个二级 Tab；provider 独立 cursor/loading/hasMore/error/lastLoadedAt；surface 合并去重排序分页；部分 provider 失败独立重试，全失败才整体错误。
- 首页排序：session seed 确定性随机，score=hash(seed, providerKey, itemId)，刷新换 seed。
- 关注开放体系：任何 Subscribable 稳定实体可关注；单分组归属+系统默认分组（不可删可改名），删组订阅移入默认；(targetKind,targetId) 唯一。表 `subscription_group(id,title,sort_key,created_at,updated_at)`、`subscription(id,target_kind,target_id,group_id,sort_key,...)`。`SubscribableProvider<TKind>.getSummary(ref)` + `getItems(ref,input):Promise<ItemPage>`。
- 搜索：SearchPage 单选 SearchProvider 返回 ItemPage；Feed/Search/Subscribe 内容流统一 `Item -> Card`。
- Item 公共字段（DB 归一化，Repository 组装）：`id/title/preview(ResourceRef)/playerKey/sourceRefs/creatorRefs/viewCount?/createdAt/updatedAt`。
- Card 点击 -> ItemRepository -> PlaybackCoordinator -> PlayerInstance。菜单经 ItemActionProvider 注册：可选 `applies?(item)` 默认全适用；`getActions(item,context)->ItemAction{key,label,execute}`；icon 移除视觉归 Card；顺序=返回顺序。

## 5. 启动与插件运行时

主流程：
```
Native Host -> minimal loader plugin -> db open + core migration
  -> official/user 插件发现 -> manifest/签名/hash/兼容校验
  -> 依赖图 + migration 排序 -> SQL migrations + ledger
  -> Cordis activation -> AppShell mount
```
- 迁移先于激活；loader 是唯一启动锚点，逻辑阶段 `loader -> official -> user`。
- 插件状态机：`discovered -> verified -> migrating -> migrated -> activating -> active`；任何阶段失败进入 `disabled`（恢复界面）；依赖方进入 `unavailable`，A 恢复后 B 重走校验/migration/激活。
- 更新流程：装新包->校验->保留 active 版本->跑新版 migration->激活->稳定后提交；激活失败自动执行旧版 down migrations 回滚数据库再重启旧版并记回滚事件；down 也失败进入人工恢复态（错误详情/导出诊断/卸载选项）。
- loader 自身失败由 Native Host 显示最小错误页+恢复入口。

## 6. 导航

- React Navigation v7 native-stack + Cordis NavigationService 包装；RouteRegistry 类型化 + module augmentation；路由 key=`'plugin-id/route-name'`。
- RootStack = Tabs 容器(五 tab) + push 页面(core/search、detail 等) + PlayerHost fullScreenModal；ModalHost 独立顶层。
- navigate 未注册 key 编译期类型错误 + 运行期 missing route；深链 `delta-comic://` 核心 scheme+插件映射统一 resolver；Web URL 双向同步封装在 NavigationService。

## 7. 安全与故障隔离

- capability 未声明的调用硬拒绝；能力集刻意宽松（network 不限），仅覆盖需要结构化门控的宿主服务（通知/剪贴板/分享等）。
- UI 层每插件挂载点 React ErrorBoundary，单插件崩溃不拖垮 Shell；服务层错误走 disabled/unavailable 状态机；反复出错标记 unhealthy 可重载。
- 审计日志本地持久化（capability 拒绝/调用/错误）。

## 8. 网络与后台任务

### 8.1 基础网络

- 插件直用全局 fetch；核心可选 network 服务=ky 封装（超时/指数退避重试/按源限速）；图片统一 expo-image；大文件归 resource/download 断点续传。

### 8.2 EdgeRouter（多端点分流）

定位：opt-in 协作服务。插件拥有"发现什么"和"怎么请求"，宿主拥有"哪个最快"和"坏了怎么办"；抽象止步于 URL 前缀，请求自由度（ky/裸 fetch/WebSocket/私有 RPC/自签名）不受约束。

- 声明：manifest 仅含能力开关 `network.multiEdge`；端点候选由插件 hook `resolveEdges(ctx): Promise<Edge[]>` 运行时产出——动态拉取、解密、硬编码均插件自主，manifest 静态清单无法覆盖的动态端点场景由此承接。
- 统一探测：宿主对候选并发发轻量 GET（3~5s 超时），`Promise.any` 首个成功者即为 selected，其余跑完记录 latency 形成排序表（HEAD 兼容性差弃用）。
- 状态机（每插件一份）：`unprobed -> probing -> ready(selected) / failed(全灭)`；ready 下请求失败 fail_count++ 并切换 latency 次优候选重试一次；failed 进入退避 30s→2m→5m 自动重探。
- 持久化：core 表 `plugin_endpoint(plugin_id, url, latency_ms, last_ok_at, fail_count)`；冷启动 last_ok_at 在 TTL（6h）内直接复用选中免探。
- 时序保证：`ensureSelected(timeout≈8s)` 同步兜底——ready 直接返回缓存选中、unprobed 当场竞速定案、failed 抛结构化错误 `no-edge-available` 交 UI 展示重试入口；loader 激活完成后 idle 预热（`@cordisjs/plugin-timer`）为优化路径。
- 插件 API 面：`ctx.edge.current`（同步读）/ `await ensureSelected(timeout)` / `resolve(path)` 补全 base / `report(url, ok)` 自行反馈健康度 / `withFailover(fn)`（回调抛错→标记→切次优→重调，重试控制流留在插件回调内，header/签名由插件自行重放）。
- 资源 URL 入库形态插件自决；最佳实践=存相对 path、渲染时 `resolve()` 补全当前 edge base，换 edge 零迁移成本。edge 切换以 Cordis Events 广播 `edge-changed`，内存态由响应式层刷新。
- HMR/更新：EndpointState 存宿主 db（keyed by pluginId），`reloadPlugin` 后 resolveEdges 结果 TTL 内复用；multiEdge 开关或插件版本变化触发重探。
- Web 端候选端点须配置 CORS（写入插件开发文档）；RN 无此约束。

### 8.3 scheduler

- scheduler 服务（首期最小版）：桌面=进程内优先级队列+并发上限+持久任务状态；Android 仅应用存活期运行、退后台暂停、重开续传（前台服务/WorkManager 后置）；Web 会话级续传。底层原语用 `@cordisjs/plugin-timer`（ctx.timeout/interval/throttle/debounce 随 fiber 清理）。resource/download 为最大消费者；插件可注册周期任务。

## 9. 缓存与存储治理

三层分类：
1. 易失缓存（expo-image 图片缓存/HTTP 缓存/临时文件）——LRU+磁盘限额自动驱逐；
2. 持久下载（书架内容文件）——用户资产，仅显式删除；
3. change_log——保留策略裁剪。

核心 `storage` 服务：用量统计（我的页）、`clearCache(scope)`（仅易失层）、限额配置；平台目录差异由原生封装，协议不暴露绝对路径。

## 10. 可观测性

- 日志协议=Cordis 内置 logger 服务 `ctx.logger(scope)`（printf 格式化、Error 首参自动 stack、级别经 intercept config 配置）；官方 console exporter 输出。
- 自写唯一文件导出插件：桌面/Android 滚动日志文件、Web 内存环形缓冲。
- 崩溃捕获：RN 全局错误处理器+unhandled rejection 写本地崩溃日志，下次启动恢复界面提示；无任何远程上报。
- 诊断导出：最近日志+插件状态机快照+migration ledger+审计日志打包单文件。
- 性能标记首期仅冷启动/migration 总耗时/feed 首屏关键 span，dev 可见；不建 metrics 系统。

## 11. 跨平台体验契约

- 移动端深色基准，四端共享 `--dc-*` token；宽度断点 compact/medium/expanded，Waterfall 列数 2->3->4。
- 桌面端首期=移动布局直出+列数自适应；侧栏 rail 二期（AppShell 已预留插槽）。
- 组件级平台自适应（hover/Menu 形态）归 ui/* 内部，不进稳定协议；全局快捷键 Cmd/Ctrl+K 搜索。

## 12. 版本发布治理

- 宿主四端单一 semver 同步发布（GitHub Releases）；核心协议版本与宿主版本号相同（不做独立 protocolVersion）。
- 应用内检查更新提示、手动确认安装；Web 直接部署。
- 插件兼容门禁复用启动时 manifest 校验+回滚机制。
