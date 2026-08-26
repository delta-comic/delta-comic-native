# Findings: Delta Comic Native 调研记录

> 外部调研结论存档；架构决策本体见 docs/architecture.md。

## 数据库工具评估（2026-08-25）

| 工具 | 方向 | 结论 |
|---|---|---|
| Kysely + kysely-ctl + 自建 registry | migration/查询/类型原生一体 | 首选运行时 |
| kysely-codegen | DB -> TS 类型（反向） | 被 TypeBox Static 推导取代 |
| Drizzle Kit | TS schema -> SQL，glob 聚合强 | 备选；与 Kysely 双模型成本高 |
| drizzle-typebox | Drizzle schema -> TypeBox 校验器 | 方向相反，不符合 |
| Prisma Migrate | schema.prisma 全家桶 | 与 Kysely 重叠过多，弃用 |
| Atlas (Go) | SQL/HCL diff，import graph 强 | 治理重，引入成本高 |
| dbmate / golang-migrate / sqg / sqlc | SQL-first CLI | 与 TypeBox 单模型方向不符 |
| rindle | 绑定自家引擎/daemon | 违背纯本地 plain SQLite |
| json-to-sql-migration | JSON Schema->SQL 小众项目 | 非 TypeBox 原生 |

**最终选型**：不存在成熟 TypeBox->SQL 工具，自研 snapshot/diff/DDL emit 薄层（用户确认单模型）。

## TypeBox v1.x
- 基于 TS7 native compiler、ESM-only、JSON Schema 2020-12，与仓库 TS7 catalog 契合。
- `Static<T>` 推导编译期类型、`Value.Check` 运行时校验——单模型两份产出免费获得。

## Kysely 要点
- SQLite dialect 接受符合 `SqliteDatabase` 的 driver（close/prepare/all/run/iterate）。
- 官方 migration API：up/down modules、`Migrator`、自定义 `MigrationProvider`；runner 管顺序/记录/锁。
- `kysely-ctl` 文件分类器忽略 `.sql`——纯 SQL migration 必须走自定义 provider/runtime executor（与我们的协议吻合）。
- SQLite transactional DDL 需谨慎；复杂 ALTER 用 table rebuild 显式处理。

## Web SQLite
- SQLite Wasm 在 Worker 中 + OPFS 持久化；OPFS 不可用时 transient DB。
- Vite 需正确处理 WASM/Worker；部分情形需 COOP/COEP。

## Hermes bytecode "3+2"
- `hermesc -emit-binary -out out.hbc in.js`；bytecode 带 version/source hash metadata。
- 与 Hermes runtime 版本耦合 -> manifest 记录 bytecode version/version range/sha256/fallback。
- 原生 plugin-loader capability 封装 JSI 加载细节，协议不暴露 Hermes C++。

## Cordis 关键知识（skill: cordis 已加载，详细内容在 .agents/skills/cordis/SKILL.md）
- plugin 三形态（function/namespace/class Service）；**namespace 形式与 export default 互斥**（loader 解包坑）。
- 服务依赖用 `inject`，PENDING=等待服务；属性读取严格（祖先链），可选服务用 `ctx.get()`。
- Events 五种 dispatch mode（emit/waterfall/parallel/serial/bail）；waterfall 观察者必须 `next()`。
- 注册即可逆：listeners/child plugins/services/timers 都是 effect，随 fiber 卸载。
- loader 条目按 id diff；config 经 Standard Schema（Schemastery）校验后才进 apply。
- `@cordisjs/plugin-timer` 提供 ctx.timeout/interval/throttle/debounce 且自动清理 -> scheduler 底层原语。
- logger 为内置服务 `ctx.logger(scope)`；官方 exporter 仅 console -> 自写文件导出插件。
- HMR 插件替换以 entry 文件为单元；诊断 PENDING 用 ctx.registry 遍历 fiber state。

## 设计语言
- 六张参考图提炼结果落盘于 docs/design-language.md（品牌粉 #FF6699/#FB7299、工具蓝 #4FC3F7、明暗同构、19 组件清单、五原则）。

## 仓库现状（2026-08-25）
- 根目录骨架 + packages/*/* workspace（pnpm-workspace.yaml）；尚无业务包。
- 工具链 Vite+（vp）：install/fmt/lint/check/staged/run set-ver；TS7 catalog；cspell 进 pre-commit。

## Dev MCP / AI 调试通道调研（2026-08-25）

| 方案 | 结论 |
|---|---|
| 应用内起 MCP HTTP server | 否决——Web 端浏览器无法监听端口；Android 常驻监听需前台服务+原生模块；四端不统一 |
| 桥接模式（应用外连 dev-mcp WS） | 首选——唯一四端同构形态，复用既有 dev 通道心智 |
| MCP 官方 TS SDK `@modelcontextprotocol/sdk` | 采用——stdio 与 Streamable HTTP 双传输一等公民；自定义 Transport 是文档化扩展点（LoopbackTransport 先例），WS 桥接=实现一个 Transport 对；v1.x 稳定线（2.0 拆包 alpha 观察中，实施时按 catalog 现状钉版本） |
| React DevTools / Redux DevTools 式内嵌面板 | 不符合诉求——目标读者是 IDE 内编码 Agent，标准 MCP 协议可直接被客户端消费 |

- 拓扑定案：`AI 客户端 ─stdio─ scripts/dev-mcp ─WS(loopback)─ packages/plugins/debug`；多设备并存按 appId 寻址。
- plugin_detail 数据源现成：Cordis `ctx.registry` 可遍历 fiber 树取 PENDING/error 状态（skill 已有先例）；§5 状态机快照 + §3.3 migration ledger 均为已有基础设施的投影。
- 安全三件套：编译期 `__DEV__` 折叠零包含 / loopback 绑定+配对 token / 操控类工具逐项配置门控+审计日志。

## Phase 10 实施发现（2026-08-26）

- **cordis typed events 与泛型负载**：`ctx.emit` 签名为 `emit<K extends keyof Events>(name, ...args: Parameters<Events[K]>)`——Events 属性是泛型调用签名时 Parameters 实例化到约束，泛型 K 负载无法赋值；映射类型索引的关联联合（correlated union）直接赋值同样被拒。结论：跨泛型边界广播的事件以固定形态声明（key 保留模板字面量约束、复杂 params 用 unknown 由监听侧按 key 收窄）。
- **core 存取插件作用域实体**：Item.playerKey 是 keyof PlayerInputRegistry（仅插件可增强），core 域服务要存完整 Item 快照须经 protocol 的 ItemSnapshot（playerKey 放宽为 string）+ serialize/parse 边界函数；parse 采用 loader 同款守卫逐字段校验模式，返回 undefined 表损坏。
- **UI 页面包最小骨架**：package.json exports（types→dist/index.d.ts、default→lib/index.tsx）+ tsconfig（extends base、include lib/test）+ vite.config.ts pack entry ['lib/index.tsx']；缺 vite.config.ts 时 vp pack 找不到 src/index.ts 报 'No input files'。
- **oxlint react 规则与 RN 差异**：unbound-method 要求类方法经箭头包装传值；exhaustive-deps 接受解构局部别名；effect 内同步 setState 违规改渲染期 useMemo 派生或请求标识内嵌 state；普通对象当 ref 被禁须 useRef；RN Image 用 resizeMode style（contentFit 属 expo-image）。

## Phase 11 平台服务落地记录（2026-08-26）

### 包拓扑
- core/network（EdgeRouter）：probe.ts 竞速原语 / repository.ts plugin_endpoint 读写 / service.ts attach({pluginId,version,pluginContext,resolveEdges})；常量 PROBE_TIMEOUT_MS=5s、ENSURE_SELECTED_TIMEOUT_MS=8s、TTL=6h、退避 [30s,2m,5m]；NoEdgeAvailableError code='no-edge-available'
- core/scheduler：SchedulerService static inject=['timer']，enqueue(run,{priority})/every(id,intervalMs,run)/snapshot()；apply 自动补挂 TimerService
- core/storage：治理服务只管账目与策略，字节流仍走 resource/download 驱动；registerLayer(adapter{id,kind,list,remove})、usage/clearCache(仅 volatile)/enforce(LRU 按 lastAccessAt)/setQuota
- core/capability：grant(pluginId,caps) 替换语义支持热重载；assert 硬拒抛 CapabilityDeniedError(code='capability-denied')；guard 记 invoke/error；审计 db 模式 fire-and-forget 落 audit_log + 内存尾部合并读取
- plugins/observability：attachLogCapture(logger.exporter→RingBuffer+printf)、createMemorySink/createRollingSink(FileAdapter 注入，Phase 13 平台接入)、attachCrashCapture(CrashHooks 抽象，Node 默认 process.on)、exportDiagnostics(logs/plugins/ledger/audit)

### db 迁移链现状
v1 基座 → v2 resource 域 → v3 用户域五表 → v4 plugin_endpoint（core-network-v1）→ v5 audit_log（core-audit-v1）；era 冻结法：userEraTables 排除 plugin_endpoint+audit_log，networkEraTables 再排除 audit_log，保证既有库已应用迁移文本逐字节不变。ledger 测试断言现至 'core/5'。

### 待宿主接入项（Phase 13）
- storage：平台 FileAdapter/目录封装注入 layer 实现
- observability：crashHooks 各端实现（RN 全局错误处理器）、rolling sink 文件路径适配、恢复界面读 crashPending
- capability：loader 激活时按 manifest.capabilities 调 grant
- scheduler：idle 预热挂 scheduler.every；resource/download 作为最大消费者接 enqueue

## Phase 12 构建库落地记录（2026-08-26）

### 构建流水线形态（scripts/plugin-build，bin dcb）
- plugin.build.json（插件包根）：{id,name?,version,hostVersion,capabilities,network.multiEdge,runtime{rn,hermes,bytecode,cpu,compileOptions?},dependencies?,hermesc?,entries{common 必填 + web/android/macos/windows 可选 {entry,outDir?}}}
- pack 流水线：parseBuildConfig(typebox) → runBundles 委托 `vp -C <dir> pack <entry> --out-dir <dir> --format esm [--platform browser]`（common 也显式传 entry，顺序执行）→ hermesc 可选发射 dist/index.hbc → sha256 落账 → assembleManifest→validateManifest（失败 ManifestError 列 issues）→ migrations/** 收集 → fflate zipSync → build/plugin.zip
- zip 约定：manifest.json / common/index.js(.map/.d.ts/.hbc) / web/index.js / migrations/*；Hermes 平台 entries.android/macos/windows 指向 common/index.hbc（"3+2"），无字节码时回落 common ESM；fallback 字段暂不写（host 默认回落 common）
- PackRunner/CommandRunner 双注入点：测试用 fake runner 写真实产物文件，hermesc fake copyFileSync 模拟 .hbc
- verify-exclusion：scanFiles（文本子串）+ scanZip（fflate 解包逐成员）；CLI 命中退出码 1

### dev 工作流（scripts/dev，bin dcd）
- 单进程编排：DeviceHub + buildTools + createDevMcpServer 进程内装配（经 @delta-comic/dev-mcp 新增 src/index.ts 导出面），serveStdio 占本进程 stdout；vp dev 为子进程 stdio ['ignore','pipe','pipe'] 日志转发 process.stderr
- resolveVpBin：优先 node_modules/.bin/vp（import.meta.url 相对定位），回退 PATH
- vite exit → 整体 shutdown（kill + close + hub.stop + exit(code)）；SIGINT/SIGTERM 同路径；settled 防重入

### CLI 约定
- cac ^7.0.0 统一解析+分派：bin 取首字母缩写——dcb（plugin-build）/ ddm（dev-mcp）/ dcd（dev）
- 异步 action 错误捕获必须 cli.parse(argv,{run:false}) + await cli.runMatchedCommand() 包 try/catch 设 process.exitCode
- Node 26 strip-only 直跑约束（bin 图内全部满足）：相对导入带 .ts 扩展、禁 TS 参数属性（ToolCallError 已改显式赋值）、禁 enum/namespace 等需转换语法

## Phase 13 四端宿主工程落地记录（2026-08-26）

### packages/core/runtime（插件工件层）
- openPluginArtifact(zipBytes)：fflate unzipSync + manifest.json 解析（ArtifactError{code: zip|manifest|entry-missing}）；Artifact 对象持有 members Map
- selectEntry(artifact,platform)：entries[platform] → entries.common 回落；verifyEntries 对照 manifest.entries+fallback 全量 sha256（@noble/hashes sha256，catalog ^2.3.0）
- discoverFromArtifact(bytes,{platform,evaluator})：发现期 validateManifest + verifyEntries + parseMigrations（migrations/<n≥4位>-<name>.up.sql/.down.sql 成对，按 n 升序，MigrationEntry 形状与 db 包一致）；resolveEntry 时选入口+校验+evaluator 求值，缺 default 抛错
- ModuleEvaluator 缝隙：createEsmEvaluator Blob URL 动态 import（.hbc 直接拒绝）；Hermes 端由原生 JSI 注入 evaluator 实现替换——宿主无需改 runtime 代码即可换字节码引擎

### packages/app（宿主装配）
- HostSeams{platform,createDb,evaluator,sources,crashHooks?,sink?,storageLayers?} 是四端唯一差异注入面；createApp(ctx,seams) 统一装配
- mountCoreServices 装配序关键：TimerService 必须先于 SchedulerService（后者 static inject=['timer']）；db 先建后传各 Service 构造参数
- capability 授权联动：监听 loader/plugin-state——verified 且 grants 无记录时 validateManifest(manifestOf(id)) 通过即 grant(capabilities)；disabled/unavailable 撤销；中间态保持。幂等去重是正确性前提（曾因每事件 revoke 导致 active 后授权丢失）
- Web 端：sql.js Wasm 内存库 SqlJsDriver（多语句 exec、returnsRows 前缀 SELECT/WITH/PRAGMA/VALUES、collectAll prepare+step、numAffectedRows=getRowsModified）；wasm 经 `import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'`；插件来源 runtime/index.json {plugins:[{file}]}
- entry.native.tsx 约定 globalThis.__DELTA_HOST__:{platform:'android'|'macos'|'windows',createDb,evaluator,listOfficialZips,readOfficialZip}（declare global）——原生工程 JSI 注入后 AppRegistry.registerComponent('DeltaComic') 即起

### 原生工程骨架生成备忘
- Android：`npx @react-native-community/cli@latest init DeltaComic --skip-install --skip-git-init --pm npm --install-pods false`
- macOS：npm i react-native@~0.81.0 react@19.1.0 react-native-macos@0.81.9 --legacy-peer-deps 预装后 `npx -y react-native-macos-init`（--version 参数会被重复加前缀报错，省略）
- Windows：shim pwsh.exe/dotnet.exe/where 三件套（$TMPDIR/win-shim，where 对 shim 参数 echo 路径否则 exit 1）+ 项目根 react-native.config.js `module.exports = require('react-native-windows/react-native.config.js')` 后 `./node_modules/.bin/react-native init-windows --overwrite --no-telemetry`（cpp-app 模板）。根因：@react-native-windows/cli require 时即 execSync('where pwsh.exe')，macOS 无 where 则命令注册整体失败
- 拷入 packages/app/ 后 _gitignore 批量改名 .gitignore；debug.keystore 为 RN 公共默认可提交

### 工具链踩坑补充
- pnpm-workspace packages glob `packages/*/*` 不匹配两层目录——packages/app 必须显式列出，否则 node_modules 永不链接
- vitest 会加载 vite.config.ts 并执行 plugins——uniwind 用 process.env.VITEST 守卫跳过；esbuild jsx automatic（include 全扩展名正则）解决上游包 JSX PARSE_ERROR
- RNW 生态 screens/safe-area-context 的 Web stub：screens-stub.ts 导出同名组件、safe-area-stub.tsx 同一 context 双导出+零 insets Provider+useSafeAreaInsets
