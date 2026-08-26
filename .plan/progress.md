# Progress Log

## Session 2026-08-25（架构 brainstorming 收敛）

### 已完成
- 十大架构面全部逐项确认：插件模型/市场协议、UI registry、数据层（TypeBox 单模型）、Shell/Feed/Card、启动与状态机、导航、安全隔离、网络后台、存储治理、账号与 ID、可观测性、跨平台契约、版本发布治理。
- 关键用户裁决：
  - 数据库必须单模型（TypeBox 表 DSL 唯一源），否决双 schema 路线。
  - 主键用雪花算法（富含语义）；账号=源访问身份，支持多平台+每平台多账户；历史/收藏等用户域数据与账号解耦（纯本地策略）。
  - 核心协议版本与宿主版本号相同（否决独立 protocolVersion）。
  - 后台任务首期最小版；桌面首期移动布局直出。
- `docs/design-language.md` 落盘并提交（commit bf05b24）。
- 本 session：`docs/architecture.md` + planning 三件套落盘。

### 进行中
- Phase 3 核心协议包未开始。

### 备注
- 全程 Plan Mode 只读讨论后转入 build 落盘；所有决策同步至 project memory。

## Session 2026-08-25（Phase 2 包骨架）

### 已完成
- workspace catalog 补齐核心依赖：cordis 4.0.0-rc / @cordisjs/plugin-timer / kysely 0.29 / @sinclair/typebox 0.34（npm 尚无 v1.x，0.34 已满足 Static+Value.Check）/ react 19.2.8 全家桶 / RN 0.87 + web/macos/windows 各自版本线 / nativewind 5.0.0-preview.4（dist-tag preview）+ react-native-css / expo-image / ky / vitest。
- 七个包骨架落盘（均 1.0.0、exports 直指源码 lib/index.ts、typecheck script）：
  - packages/core/{protocol,registry,db,loader}；loader 以 workspace:* 依赖其余三个。
  - packages/ui/theme（含 lib/theme.css：--dc-* token + @theme inline 映射，深色基准 + .dc-light 同构）、ui/button、ui/list。
- 根配置接线：vitest 新增 packages 工程（include packages/*/*/test/**）；lint tailwindcss cssConfigPath 指向 theme.css；cspell 词表补 cordis/kysely/typebox/nativewind/opfs/hermes。
- 冒烟测试 2 个通过：protocol 版本断言 + loader 跨包解析验证。
- 清理上次架构提交（86999c6）删除 script/ 目录后的死引用：release.config.ts 删除（semantic-release 依赖早已不在 devDeps）、vite.config release:* 任务与 typecheck 的 dependsOn lib-build 移除。发布流水线归 Phase 11 在 scripts/* 包模式下重建。

### 验证
vp install / vp lint / vp run -r typecheck（7 包全绿）/ vp test（2 passed）全部通过。

### 下一步
Phase 3 核心协议包：manifest TypeBox schema + 运行时校验、plugin contract 公开 interface（player 输入协议挂点）、UIRegistryService 类型化 get<K> + module augmentation 基线。

## Session 2026-08-25（EdgeRouter 分流设计）

### 裁决
- 多端点分流方案定稿并落盘 docs/architecture.md §8.2：
  - 端点候选由插件 hook `resolveEdges(ctx): Promise<Edge[]>` 运行时产出（动态发现/解密/硬编码插件自主），manifest 仅含 `network.multiEdge` 能力开关——用户裁决：manifest 静态声明端点不可行，动态端点场景必须承接。
  - 请求自由度不动摇（fetch/ky/WebSocket/私有 RPC 均可），EdgeRouter 为 opt-in 协作服务：current / ensureSelected(8s) / resolve(path) / report(url,ok) / withFailover(fn) 五 API——用户裁决：强制相对路径网络抽象会限制生态多样化。
  - 统一代理测试收窄为探测与选路：并发轻量 GET 竞速 + latency 排序 + plugin_endpoint 表持久化 + 退避重探 + edge-changed 广播。
  - 资源 URL 入库形态插件自决，最佳实践=存 path 渲染时 resolve()；HMR 场景 EndpointState 在宿主 db，reloadPlugin 后 TTL 内复用。

### 归属
- 协议契约（multiEdge 开关 + resolveEdges 契约 + Edge 类型）进 Phase 3；EdgeRouter 服务实现进 Phase 10。

## Session 2026-08-25（Phase 3 核心协议包 + pack 基建）

### 依赖与基建
- catalog 切换 `typebox ^1.3.18`（@sinclair/typebox 已弃用），补 `@types/semver`；commit 6ddc3c8。
- 七个 workspace 包全部配置 vite-plus pack（各包 vite.config.ts `pack` block：entry lib/index.ts、esm、dts、platform neutral、target esnext、sourcemap、treeshake、clean；theme 额外 copy theme.css）。platform node 会产出 .mjs/.d.mts，neutral 统一 .js/.d.ts，exports 加 `"types": "./dist/index.d.ts"` 条件（运行时仍走源码），typecheck 消费声明产物降低重查成本。根 run.tasks 接线 pack 任务且 typecheck dependsOn pack。commit 943a6be。

### Phase 3 落地
- protocol/lib/manifest.ts：PluginManifestSchema（id 单段 kebab pattern、version semver pattern、hostVersion range、entries common 必填+web/android/macos/windows 可选+additionalProperties:false、fallback、runtime{rn/hermes range,bytecode,cpu[],compileOptions}、network.multiEdge 开关、capabilities 宽松集）；validateManifest 返回判别联合 {ok:true,manifest}|{ok:false,issues[]}，Value.Check 失败后 Value.Errors 映射 instancePath/message，再以 semver.validRange 深查三个 range 字段。
- protocol/lib/contract.ts：PlayerInputRegistry module augmentation 挂点 + PlayerInputDefinition{schema,version} + PlayerInput<K> Static 推导 + PlayerInstance + PlayerResolveResult<K>（instance|redirect(key,input)）；Edge{baseUrl,label?} + ResolveEdgesHook=(ctx)=>Promise<Edge[]>；declare module cordis Events 'protocol/edge-changed' @mode emit。
- protocol/lib/ui.ts：UIRegistry augmentation 挂点、isValidUiKey 分层 key 校验（layer/name 两段起）、UIBaseRegistration/UIOverrideRegistration{id,version,component,priority?,override:{targetId,compatibleVersion}}。
- registry/lib/service.ts：UIRegistryService extends Service（ctx.uiRegistry 合并）；get<K> 取优先级最高组件（唯一 as 还原点，不变式由 register<K> 签名保证）；register 校验分层 key/semver/重复 ID，override 强制目标存在+compatibleVersion satisfies 目标版本+priority 高于目标；返回注销 disposer。
- 测试 22 passed：manifest 7 用例（含 issue path 断言）、contract augment 类型断言（Expect<> 编译期验证 PlayerInputRegistry/UIRegistry 扩展生效）、registry service 10 用例（Reflect.apply 绕过类型保护 JS 调用方路径）。
- loader 骨架测试改引 UIRegistryService。

### 关键事实
- typebox v1：Value.Check 是 `value is Static<T>` 类型守卫；错误对象含 keyword/schemaPath/instancePath/params/message（message 必有，无 path 字段）。
- vitest 规则 no-conditional-expect 生效：条件分支用 toMatchObject 替代 if(expect)。
- noUnusedLocals 对 `_` 前缀 type alias 不豁免，编译期断言需 export。

### 下一步
Phase 4 数据层基础设施：TypeBox 表 DSL -> snapshot -> diff -> up/down .sql 编译器、Static 推导 Kysely Database 类型、migration registry。

## Session 2026-08-25（Phase 4 数据层基础设施）

### 落地（packages/core/db）
- ffe3e95 表 DSL+snapshot+diff+SQL 编译器：显式列 builder（text/integer/real/bigText/bool，notNull 泛型字面量推导 TableRow/DatabaseOf）；AnyTableDef 运行时视图规避泛型不变性；diff 分类 additive/destructive/rebuild；SQLite DDL emit（ADD COLUMN NOT NULL 缺 default 显式抛错、UNIQUE ADD COLUMN 拒绝、rebuild=建临时表-拷贝-DROP-RENAME）；down 对称编译。
- 3aba6bf 雪花 ID：41|10|12 位布局、BigInt 十进制 TEXT、序列溢出向未来借位、时钟回拨沿用最后时间戳。
- d88fb65+ae10f17 Kysely node:sqlite driver（多语句分号契约走 exec、boolean 绑定转 0/1、SQLInputValue 收窄）+ migration registry（(pluginId,n) 唯一、Kahn 拓扑+环检测、ledger 幂等增量应用）。
- 260c554 Store 统一事务+ChangeBus（commit 后整批发布、失败零事件）+rowCodec（显式点名 bigint→TEXT 十进制、boolean→0/1，Stored<T> 映射类型直通 InsertExpression，fromStorage Value.Check 校验）；DatabaseTables module augmentation 挂点+observe typed observation。

### 关键事实
- @types/node 的 SQLInputValue 不含 boolean；node:sqlite prepare 单语句、exec 多语句无绑定。
- oxlint type-aware 全仓 program 会吃到 test 的 declare module 合并，lib 内 keyof DatabaseTables & string 触发 no-redundant-type-constituents（去掉 & string）。
- tsconfig types:['node'] 使 oxlint 解析到 node:sqlite 类型。
- 泛型 TableDef 因 keyof primaryKey 不变：消费方用 AnyTableDef 宽化。

### 下一步
Phase 5 启动链路：loader plugin 发现/校验/依赖图/migration 排序/Cordis activation、插件状态机、恢复界面。

## Session 2026-08-25（AI 调试通道设计落盘）

### 裁决
- 新增子系统「Dev MCP」（architecture.md §13）：AI 客户端经标准 MCP 协议远程观察/操控运行中的应用，目标是 IDE 内 Agent 自主完成"看状态→查数据→触发动作→验证结果"调试闭环；生产构建零包含。
- 拓扑=桥接模式：`scripts/dev-mcp`（MCP server stdio + 多设备 WS hub + 配对 token）↔ `packages/plugins/debug`（官方插件，`__DEV__` 门控，应用主动外连 loopback WebSocket）。Web 无法监听端口、Android 常驻监听需前台服务——桥接是唯一四端同构形态。
- 工具面两档：观察（app_info/plugin_list/plugin_detail/db_schema/db_query 只读/logs_tail/logs_search/events_recent 环形捕获/registry_list/diagnostics_export 复用 §10）+ 操控（plugin_reload/enable/disable 驱动 §5 状态机与恢复界面、navigate 驱动 NavigationService）。写库与 eval_js 默认关闭走配置门控；screenshot 渐进（Web DOM 先行）。
- 线协议 TypeBox schemas 进 protocol/lib/debug.ts 两端共享；MCP SDK 用官方 @modelcontextprotocol/sdk（自定义 Transport 桥接 WS）；全部调用写审计日志。

### 归属
- 新 Phase 7「AI 调试通道（Dev MCP）」插入 Shell/导航之后——此时状态机+导航已就绪，后续 Feed/Player/业务插件阶段即可被 AI 自主调试辅助；旧 7~12 顺延为 8~13；构建库（新 12）负责 dev-mcp 接入 vp dev 工作流与生产零包含验证。

## Session 2026-08-25（样式方案切换 NativeWind → Uniwind）

### 裁决
- 放弃 NativeWind，class→style 方案切换为 Uniwind ^1.11.0（react-native-unistyles 原班作者）。
- 决定性依据：
  - NativeWind v5 官方安装文档仅存 Expo 路径（bare RN 章节仅 v4 有），本项目为裸 RN 四端宿主工程（Android/macOS/Windows/Web），平台支持错位是实质风险；Uniwind 明确支持 bare RN + monorepo + iOS/Android/tvOS/Web/macOS/Windows。
  - Uniwind 为 Tailwind v4-only、CSS-first `@theme`：现有 theme.css（--dc-* token + @theme inline）直接兼容复用。
  - Metro 插件单点实现、无 babel preset，构建链简单，利好 Hermes bytecode "3+2" 流水线。
  - 拥有官方 AI skills（uniwind / migrate-nativewind-to-uniwind），Agent 协作支持好。
- 已知代价：库龄约 1 年生态较薄；厂商基准（2~3x 快于 NativeWind）未经实测；Web 端 className 不自动去重需配 tailwind-merge cn 工具；默认 rem=16px（metro polyfills 可配 14）。

### 落地
- catalog 移除 nativewind 5.0.0-preview.4 + react-native-css ^3.0.1，新增 uniwind ^1.11.0（peer: react>=19/rn>=0.81/tailwindcss>=4 全满足）；@delta-comic/ui-theme 增加真实依赖 `uniwind: catalog:`。
- cspell 词表补 uniwind；theme.css 未动（token 文件形态不变，app 入口 css 在 Phase 6+ 接 `@import 'uniwind'`）。
- 安装全局 skills：typescript-mcp-server-generator（github/awesome-copilot）、react-navigation 与 create-react-native-library（callstackincubator）、uniwind + migrate-nativewind-to-uniwind（uni-stack 官方）。
- MCP SDK 情报更新：官方 v2 拆包已成推荐线（@modelcontextprotocol/server|node|core，v1 单包退役），Phase 7 以 v2 为准。

### 验证
vp install（+17 包）/ vp lint / vp run -r typecheck（14 任务）/ vp test（42 passed）全部通过。

## Session 2026-08-25（Phase 5 启动链路）

### 落地
- db 3719004：topoSortIds 泛化 Kahn 拓扑 + readLedger + rollbackMigrations（down 对称回滚、未落账跳过）。
- db 37bb443：core-tables.ts `plugin_state(id,state,stage,error,payload_json,updated_at)` DSL + coreMigrations；DatabaseOf 放宽 AnyTableDef 规避泛型不变性。
- loader 05d4e8e：state.ts 状态机 disabled/unavailable+PERSISTED_STATES；source.ts DiscoveredPlugin{manifest,resolveEntry,migrations}+PluginSource{official|user}；service.ts PluginLoaderService 全启动管线（core migration→discover→verify 失败 disabled→缺依赖 unavailable→成环全体 disabled→拓扑序两阶段 migrate+activate）+retry 链式恢复+uninstall+plugin_state 持久化（重启恢复）+Events 'loader/plugin-state'/'loader/rolled-back' emit。
- loader 37901c2+7a24098：update(id,candidate) freshMigrations 增量回滚；rollbackOrPark——down 成功 emit rolled-back 重启旧版，down 也失败 adoptCandidate 入人工恢复态（disabled stage='rollback' 持久化）。
- ui c9586a4：ui-recovery 包 RecoveryScreen（records+onRetry/onUninstall/onExportDiagnostics，RN 组件+className Uniwind 样式）。

### 关键事实
- node:sqlite prepare('')/(';') 抛 statement finalized——raw SQL 前用 /[^\s;]/ 判空跳过执行仍删 ledger 行。
- tsdown dts 默认 externalize dependencies，devDeps 类型会被内联打包撞内部导出——运行时依赖必须进 dependencies。
- JSX 必须 .tsx；uniwind/types 子路径提供 RN 组件 className 增强；oxlint unbound-method 要求 props 回调写成箭头函数属性签名。
- manifest 最小合法必含 runtime.compileOptions:{dev:'false'}。
- vitest toMatchObject 中 failure:undefined 会失配——分开断言 toBeUndefined()。
- vp run typecheck --filter 会透传 filter 给 tsc OOM；单包验证用包内 npx tsc --noEmit。

### 下一步
Phase 7 AI 调试通道（Dev MCP）。

## Phase 6：Shell 与导航（2026-08-25）

### 提交
- 87a48ed navigation 包脚手架 + 路由 key/深链/linking 纯函数与单测（catalog 补 @react-navigation/native、native-stack、bottom-tabs ^7）
- d095940 linking 支持 tab 路由嵌套分组；a880ec2 平铺层排除已嵌套 tab
- 8169ff4 RouteScreen 契约返回 ReactNode，react 升 peerDep 外置 dts 类型
- 2839207+ac1bb9e linking 类型面对齐 React Navigation；32916f7 ui-shell 六区组件与 RootNavigator；4c56e3c lint/fmt 清理

### 实现
- @delta-comic/navigation：keys.ts（品牌化 RouteKey/buildRouteKey/parseRouteKey/Routes 增强基线/RouteTarget 分布式条件）；deeplink.ts（delta-comic:// 双向映射手写解析）；linking.ts（buildLinkingConfig，tab 挂 'tabs' 分组）；service.ts（RouteRegistryService register/has/keys/resolveScreen + NavigationService attach/navigate/goBack/canGoBack fail loud + Events 'navigation/navigate'）
- @delta-comic/ui-shell：app-shell.tsx（六区骨架+ModalHost 占位）、top-bar.tsx（头像/胶囊搜索/扫码/公告）、bottom-navigation.tsx（四槽+中央凸起粉 FAB，固定四常规槽校验）、tab-routes.ts（TAB_ROUTE_KEYS=core/home|follow|bookshelf|mine + splitTabRoutes 纯函数）、root-navigator.tsx（NavigationContainer+native-stack 栈+bottom-tabs 容器+自定义 ShellTabBar+命令面适配器绑定 ctx.navigation+linking 接入）

### 关键事实
- dts 打包撞 @types/react（CommonJS dts 不能内联）——类型层依赖 react 时须声明 peerDependencies 使 rolldown-plugin-dts 外置
- React Navigation LinkingOptions.prefixes 为可变 string[]；screens 嵌套分组需含 path 可选字段否则 weak type 检查拒绝
- uniwind className 增强在包入口 `import type {} from 'uniwind/types'` 一次即对全包生效
- oxlint vitest(require-mock-type-parameters) 强制 vi.fn<T>()；tailwindcss(classnames-order) 由 vp fmt 自动排序
- workspace:* 消费方 TS 走 dist/index.d.ts（types 条件），改 core 导出后必须重新 vp pack 才对下游生效

### 下一步
Phase 7 AI 调试通道（Dev MCP）。

## Phase 7：AI 调试通道（Dev MCP，2026-08-25）

### 提交
- protocol：线协议 TypeBox schemas + DEBUG_TOOLS 注册表14项（observe十/control四）
- core：loader manifestOf/reload/disable + DatabaseService('database')；registry entries() 投影；三包 vp pack
- plugin-debug：capture 环形捕获（logger.exporter+internal/dispatch）+ handlers 14工具 + DebugBridge WS 客户端（指数退避重连）+ isDevMode 门控 apply；.gitignore 追加 !packages/plugins/debug
- dev-mcp：DeviceHub（127.0.0.1 /app?token= 配对、同 appId 顶替、请求 id 计数+超时）+ buildTools 门控过滤+审计 JSONL + createDevMcpServer（McpServer.registerTool+fromJsonSchema）+ serveStdio main；catalog 增 @modelcontextprotocol/server ^2.0.0/ws ^8.18/@types/ws；vite.config test projects 增 scripts/*/script/test/**；lint 清理 protocol 条件断言

### 关键事实
- MCP SDK v2：registerTool(name,{inputSchema:fromJsonSchema<T>(jsonSchema)})，TypeBox TSchema 单次 as JsonSchemaType 即过；serveStdio 来自 '@modelcontextprotocol/server/stdio' 返回 {close()}
- ws RawData 消息须按 string/Buffer[]/ArrayBuffer 分支解码（no-base-to-string 强制）
- vitest no-conditional-expect：判别联合用 toMatchObject({ok:false,issues:expect.any(Array)}) 替代 if 收窄后 expect
- vp test 项目匹配以仓库根为基准：scripts/* 的测试放 scripts/x/script/test/ 并在根 vite.config projects 注册

## Phase 8：Feed/Card/Waterfall（2026-08-26）

### 提交
- protocol：lib/feed.ts 定义 ResourceRef/ContentSourceRef/CreatorRef/Item/ItemPage/FeedProvider/FeedSurfaceDescriptor（isValidSurfaceId=isValidLayeredKey）/ItemActionContext/ItemAction/ItemActionProvider
- core/feed：seed.ts（newSessionSeed 时间基数36进制+随机后缀、fnv1a 32位、itemRank、compareRank 降序+字典序 tiebreak）；session.ts FeedSession（entriesById 去重保留高分、slots 独立 cursor/status/error/lastLoadedAt、loadMore inflight 复用+allSettled 并发轮转、部分失败 phase ready+lastRoundPartialFailure、全失败才 error、retry 单 provider、refresh 换 seed 清空重拉、subscribe/getSnapshot 直连 useSyncExternalStore）；service.ts FeedService（registerSurface 校验 id/providers 非空/key 唯一/重复抛错 + 'feed/surface-changed' Events 广播 + surfaces 投影 + createSession 工厂）与 ItemActionService（applies 过滤注册序拼接）
- ui-waterfall：columns.ts WATERFALL_BREAKPOINTS{medium:768,expanded:1280} columnsForWidth 2->3->4 纯函数；Waterfall ScrollView 内 index%N 分列组件（首期无虚拟化，规模前提注释）
- ui-card：format.ts formatViewCount（万/亿一位小数去尾零）；index.tsx WaterfallCard（expo-image 封面 aspect-[3/4]、左下 👁 浏览量 overlay、右下半透明时长徽章、两行标题、作者行+⋮）与 ItemActionMenu（Modal 底部弹层）

### 关键事实
- 类字段与方法同名会运行时覆盖原型方法（FeedService surfaces 字段 vs surfaces() 方法）——tsc 报 duplicate identifier 前测试先炸 'not a function'，字段改名规避
- 包缺 tsconfig.json 时 rolldown-plugin-dts 报 'tsgo did not generate dts file for lib/index.ts'
- `vp run -r pack` 并行 tsgo 内存压力大易 OOM exit 137——逐包 `vp -C <pkg> run pack` 重试即可
- tailwindcss enforces-shorthand 会级联合并：h-full w-full→size-full、px-2 py-2→p-2、h-4 w-4→size-4
- `export { x } from './y'` 纯 re-export 不引入局部作用域，同文件使用需单独 import
- vitest helper 暴露调用计数须 getter（`calls: state.calls` 是创建时快照恒 0）
- 部分 provider 失败时 session phase 保持 ready（lastRoundPartialFailure=true），全失败才进入整体 error

### 验证
vp install / vp lint / vp run -r typecheck（29 任务）/ vp test（27 文件 168 passed）全部通过。

### 下一步
Phase 9 Player 与资源体系。

## Phase 9：Player 与资源体系（2026-08-26）

### 提交
- e69f927 feat(protocol)：lib/resource.ts（ResourceDescriptor extends ResourceRef{size?,checksum?{algorithm,digest},mime?}、ResourceOpenOptions{signal?,offset?}、RangeUnsupportedError、ResourceProvider{id,kind,resolve,open→AsyncIterable<Uint8Array>}）；PlayerInstance 增加 render(): ReactNode（protocol 加 react peer）
- e80a5cf feat(db)：resource 表（PK [kind,ref]）+ download_task 表（PK id）；v1 基座冻结 snapshotOf([pluginStateTable])，新增 n=2 'core-resource-v1'；导出 ResourceRow/DownloadTaskRow
- 327f124 feat(resource)：ResourceScope（acquire 幂等 lease/onClose LIFO/close 幂等）；ResourceRuntimeService('resources')（kind 唯一注册、describe TTL+容量缓存+best-effort 落库、open 登记 scope 且 close/signal 联动中断流）；ResourceRepository/DownloadTaskRepository；DownloadService('downloads')（六态状态机、sink.probe 断点续传、Range 拒绝清空重传一次、从头取回才校验 checksum、并发泵、pause/resume/cancel/retry/remove/recoverStale、'download/task-changed' 广播）
- 174bd45 fix(protocol)：PlayerResolveResult redirect 分支放宽为任意已注册协议（映射联合逐项配对 key/input）
- e5b523c + 9843f19 feat(player)：PlayerService('players')——registerPlayer 唯一 key+semver 校验；resolve 递归展开 redirect：每跳 Value.Check(schema)、visited 判环、MAX_REDIRECT_DEPTH=8、失败先关 scope 再抛 PlayerResolveError{player-missing|input-invalid|redirect-cycle|redirect-depth,key,chain}；resolveErased 字符串擦除入口供宿主路由使用；'player/resolved'{key,providerId,chain}
- 67e067b feat(ui-player)：phaseForError 纯函数；PlayerHost（请求标识内嵌 state 丢弃过期响应、卸载 dispose+scope.close、missing/error/resolving 呈现、可选 onClose/renderError）；Routes.player augmentation + PLAYER_ROUTE_KEY='core/player' + openPlayer
- 8d4b815 feat(ui-shell)：RootNavigator 可选 playerScreen 槽 → Stack.Screen name='player' presentation fullScreenModal
- c90585f test(loader)：ledgerIds 去重适配 core/2；d993af4 style lint+fmt 收尾

### 关键事实（新增）
- Service.ctx 是 protected：测试监听事件需自建 Context（harness 返回 ctx 再 ctx.on(...)）
- 测试文件把仅 type-import 的类当值用会运行时 ReferenceError（RangeUnsupportedError is not defined）且 vitest 报错信息藏在任务 error 里
- vi.fn() 无泛型触发 vitest(require-mock-type-parameters)；onClose 回调箭头体返回值需 void（() => order.push('x') 违反签名）
- finally 中 return 触发 eslint(no-unsafe-finally)——改为顺序语句
- React effect 内同步 setState 触发 react(set-state-in-effect)——用「请求标识内嵌结果 + 渲染期比对」替代 reset 式 setState
- core migration 加版本时旧测试 ledger 断言需同步（pipeline 用去重 pluginId、update 用 `${pluginId}/${n}` 全列）
- workspace 下游 dist/index.d.ts 缓存：改 protocol 类型后必须重新 vp pack 才能被 player/ui-player 看到

### 验证
vp install / vp lint（0 error）/ vp fmt / vp test（33 文件 204 passed）/ vp run -r pack（17 包全绿无 OOM）。

### 下一步
Phase 10 业务插件。

## Phase 10：业务插件（2026-08-26）

### 提交
- a05835f feat(protocol)：lib/social.ts（SubscribableRef/SubscribableSummary/SubscribableProvider{kind,getSummary,getItems}、SearchProvider{id,label?,search}、isSubscribableKind kebab 正则、isValidSearchProviderId=isValidLayeredKey）
- e338eb5 feat(db)：subscription_group/subscription（unique target_kind+target_id）/item_history/shelf_item（unique kind+item_id）四表；v2 资源域基线冻结 resourceEraTables，新增 n=3 'core-user-v1'；导出四个 Row 类型
- c585e01 feat(social)：SubscriptionGroupRepository/SubscriptionRepository + SubscriptionService('subscriptions')——默认组 id 'default' 懒创建幂等、createGroup maxSortKey+1、removeGroup 默认组抛错且订阅逐个迁入默认组、subscribe findByTarget 去重/目标组校验、变更广播 'social/subscriptions-changed'；SubscribableRegistryService('subscribables') kind 唯一注册返回 Disposable
- e518313 + 06c571b feat(search)：SearchService('search')——provider 注册（isValidSearchProviderId 校验/dup 抛错）、providers() 同步投影、search 委托（query trim 非空）、'search/providers-changed' 广播
- e92c379 feat(protocol)：ItemSnapshot{...playerKey:string}（Item 结构性可赋值）+ serializeItemSnapshot/parseItemSnapshot（isRecordLike 等守卫逐字段校验，可选字段条件展开规避 exactOptionalPropertyTypes）
- 7a9a3b0 feat(library)：HistoryRepository（upsert onConflict item_id）+ ShelfRepository + HistoryService('history',options?{now}) recordOpen 打开计数/进度补写 ratio∈[0,1] 校验/list last_opened_at desc/clear；ShelfService('shelf') snowflake id/favorite|later 唯一/'library/history-changed'+'library/shelf-changed'
- 91b5703 chore(core)：social/search/library 补 vite.config.ts pack 配置（pack 默认找 src/index.ts 报 No input files，包必须有 vite.config.ts entry lib/index.ts）
- 91cf360 feat(ui-shell)：TabsHost tab 内容经 routeRegistry.resolveScreen(key) 解析渲染 createElement(screen,{params:{}})，未注册回退 TabPlaceholder
- 87789d8 + a823329 feat(ui-home)：HomeScreen surface chips 横滑切换 + FeedSession useSyncExternalStore 订阅快照（session?.subscribe 须箭头包装避免 unbound-method）+ WaterfallCard 流水 + 加载更多/重试/空态
- beed729 + bee3f6f feat(ui-follow)：分组 chips（全部/各组/＋新建内联输入）+ 订阅卡网格异步 getSummary 解析（setAttempt 同引用短路防 resolvePreview 内联箭头无限循环）+ 点选内嵌 provider.getItems 分页流 + 长按 Alert.confirm 退订
- e14aaeb feat(ui-search)：SearchScreen provider 单选 + 结果区 key=query|token|providerId 重挂载分页视图 + SEARCH_ROUTE_KEY='core/search'/Routes.search{query?}/openSearch
- 814a880 feat(ui-bookshelf)：partitionHistory 纯函数（continuing=有 progressRatio/recent）+ 四分区 EntrySection + DownloadSection（DownloadSnapshot 状态标签/formatBytes）+ 长按移除
- 622266f feat(ui-mine)：MineScreen loader.diagnostics() 渲染期 useMemo 投影（effect 内同步 setState 违规）八态 badge + ActionRow 设置/缓存/诊断占位
- aab0638 test(loader)：update.test.ts ledgerIds 补 'core/3'
- 3542592 fix(navigation)：导航事件负载改为固定形态声明——cordis emit 用 Parameters<Events[K]>，泛型方法签名与泛型 K 负载均无法通过；NavigateEvent 改 {key:`${string}/${string}`,params:unknown}
- bf8136f style：统一 vp fmt 输出并同步 pnpm-lock

### 关键事实（新增）
- cordis Events 声明不支持泛型调用签名（emit 参数走 Parameters<> 实例化到约束）；跨泛型边界广播事件时事件负载须以固定形态声明（模板字符串保留 key 约束、params unknown 由监听侧收窄）
- 包内无 PlayerInputRegistry 增强时 keyof 为 never：构造 Item 字面量的测试需本地 declare module '@delta-comic/protocol' 增强 + typebox Type.Object
- serializeItemSnapshot 参数类型应为 ItemSnapshot（用 Item 会令 library 侧 playerKey 收窄成 never）
- 新 UI 页面包模板：package.json exports types→dist/index.d.ts default→lib/index.tsx + tsconfig extends base include lib,test + vite.config.ts pack entry ['lib/index.tsx']
- oxlint React 规则集：unbound-method（箭头包装类方法）、exhaustive-deps（解构局部别名入 deps）、set-state-in-effect（渲染期 useMemo/state 内嵌请求标识替代）、immutability（useRef 替代普通对象 ref）、enforces-shorthand（size-*/p-* 合并）
- RN Image 无 contentFit prop（expo-image 专属），用 style resizeMode
- HistoryEntry|ShelfEntry 联合属性访问须 'xxx' in entry 窄化
- vp fmt 会重排 import/tailwind class 并调整换行宽度——edit oldString 应先读文件匹配 fmt 后内容；package.json 缺尾换行不会被 fmt 修正需手动补

### 验证
vp lint（0 error）/ vp fmt / vp test（36 文件 236 passed）/ vp run -r typecheck（51 任务全绿）。

### 下一步
Phase 12 构建库。

## Phase 11 平台服务（2026-08-26）

### 提交链
- （protocol）feat(protocol)：edge-changed 负载固定形态 {pluginId, edge}（无消费方安全变更）
- 85b7790 feat(db)：plugin_endpoint 表 + core migration v4
- 24818cc feat(network)：EdgeRouter 竞速选路与故障转移（probe/repository/service，TTL 复用/退避重探/ensureSelected/withFailover）
- b82d3cf/7d18c97 fix(network)：cause 序列化 JSON.stringify 消除 no-base-to-string
- 1d6bb57 feat(scheduler)：timer 原语调度服务（优先级队列+并发上限+every 周期任务+snapshot）
- a0cabab feat(storage)：存储治理服务（layer 注册制/usage/clearCache 仅易失层/enforce LRU 配额驱逐/quota 动态调整）
- 9edd5b7 feat(db)：audit_log 表与 core migration v5（loader ledger 断言补 core/5）
- 0d048f8 feat(capability)：能力门控 grant/assert/guard + 审计日志持久化（deny/invoke/error）+ recentAudit/pruneAuditBefore
- 8d6c58a feat(observability)：日志捕获环形缓冲+printf 格式化、崩溃捕获钩子（error/rejection→sink+pending）、诊断导出包（logs/plugins/ledger/audit）

### 关键事实（新增）
- workspace 下游 TS 解析走 dist/index.d.ts：改 protocol/db 后必须先 vp -C <上游> run pack 才能让下游 typecheck 通过
- cordis Service 实例经代理暴露，#private 字段在代理 receiver 上不可访问——Service 子类一律用 TS private
- Service 构造器 super() 即注册服务；构造参数校验须放在 super() 之前（不触碰 this 即合法），否则抛错后残留注册
- @cordisjs/plugin-timer：TimerService 提供 ctx.timer 服务并 mixin timeout/interval/throttle/debounce；timeout(cb,ms)/interval(cb,ms) 返回取消函数；class 插件支持 static inject（Plugin.Constructor extends Base）
- ctx.logger.exporter 注册在 logger service 单例上全局生效；message={sn,ts,type,name,args}，printf 需自行格式化（%s%d%i%f%o%j 轻量替换）
- vitest fake timers 会拦截 flush 用例里的真实 setTimeout——文件级 afterEach(vi.useRealTimers)；microFlush 纯微任务排空替代
- vitest 规则集：toThrow 必须带消息、vi.fn 必须带泛型参数、no-conditional-expect（catch 内禁 expect，改为捕获变量断言）、no-meaningless-void-operator
- 新建包必须 vp install 链接 node_modules 后测试才能解析依赖

### 验证
vp lint（0 error）/ vp fmt / vp test（46 文件 286 passed）/ vp run typecheck 全绿；逐包 vp pack 完成（network/scheduler/storage/capability/db/observability）。

## Phase 12 构建库（2026-08-26）

### 提交链
- 12b0485 feat(build)：plugin-build 打包库骨架（sha256/zip/hermes/bundle/manifest/pack/exclusion）+ cac 命令行（dcb/ddm）+ 相对导入补 .ts 扩展支持 node 直跑
- 307312a test(build)：17 个单测/集成测试 + debug 插件 plugin.build.json + 根 .gitignore 忽略 build/
- ac1e186 feat(dev)：dcd 同进程编排 vp dev 与 dev-mcp（vite 子进程日志转发 stderr，MCP 独占 stdout；DeviceHub/buildTools/createDevMcpServer 经 dev-mcp src/index.ts 复用）

### 交付物
- scripts/plugin-build（bin dcb）：pack <dir> 流水线 = 读 plugin.build.json → 逐平台 vp pack 委托（common 必建 + web/android/macos/windows 覆盖入口，顺序执行防 OOM）→ 可选 hermesc -emit-binary 字节码 → 逐文件 sha256 → assembleManifest（validateManifest 校验，失败列 issues 抛错）→ 收集 migrations/** → fflate zipSync 写 build/plugin.zip。zip 布局 manifest.json + common/index.js(.map/.d.ts/.hbc) + web/index.js + migrations/*；Hermes 平台 entries 指向 common/index.hbc，无字节码时回落 common ESM。
- verify-exclusion：文件或 zip 成员标记子串扫描，命中退出码 1（debug 插件 smoke：createDebugPlugin 命中 js/map/d.ts 三处）。
- scripts/dev（bin dcd）：[root] 定位包目录传给 vp dev；SIGINT/SIGTERM → kill vite + close MCP + hub.stop；vite exit 触发整体 shutdown。
- CLI 库统一 cac ^7.0.0（catalog 新增），参数解析与子命令分派不自研。

### 关键事实（新增）
- Node 26 strip-only 直跑 .ts 不支持 TS 参数属性（constructor(readonly x)）与无扩展名相对导入——CLI bin 运行图内全部改显式字段赋值 + './x.ts' 后缀
- cac v7：cli.parse(argv,{run:false}) + await cli.runMatchedCommand() 才能捕获异步 action 错误；重复 option 自动聚合数组；kebab-case 映射 camelCase options
- vp pack 支持显式文件参数（vp pack lib/web.ts --out-dir dist-web --platform browser），平台覆盖构建无需改 vite.config
- fflate zipSync/unzipSync 零依赖够用；manifest.json 独立于成员表先写入
- dcd 下 vite 子进程必须 stdio pipe 转发 stderr——serveStdio 的 MCP JSON-RPC 独占 stdout，混写即坏帧

### 验证
全仓 vp test 52 文件 303 passed / vp lint exit=0 / vp run typecheck 全绿 / vp fmt；debug 插件真实 vp pack 出 build/plugin.zip（4 成员）且 manifest 过 validateManifest、verify-exclusion 行为正确；dcd 启动冒烟（hub :7529 token 打印、vite spawn/转发/exit 关停路径验证）。
