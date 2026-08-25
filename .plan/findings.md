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
