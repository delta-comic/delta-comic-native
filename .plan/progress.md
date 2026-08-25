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
