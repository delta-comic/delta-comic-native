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
