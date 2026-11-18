# 全港探索与猎人后半幕实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 实现已确认的 10 号设计稿，形成从全港地图、地点分区到猎人生存行动的可运行第一幕。

**Architecture:** 内容继续放在 scenes/items JSON；引擎统一检查知识、时间、区域及效果；界面呈现场景图、地图、对象和线索。复用原有事务、演出、唯一结算及死亡封存机制。

**Tech Stack:** 原生 JavaScript ES modules、HTML/CSS/SVG、JSON、Python 标准库；无新增运行依赖。

## Global Constraints

- 两格背包；猎人初始失控至少 50、体力 7；游泳需体力 5。
- 第一夜电报局强闯必死，灯光同区最多十分钟且不能刷新。
- 保留原剧本、人物设定、世界观文件和角色数据；不决定长期秘密。
- 保留 06:00、09:40、10:00–12:00、16:00–18:00、04:20–04:40 时间锚点。
- 无 Git 元数据，使用临时基线比对；本任务不提交、推送或部署。
- 分工按文件隔离，接口先约定；每个阶段检查规格与代码质量。

## Task 1: 场景与后半幕内容

**Files:** data/scenes.json、data/items.json；tests/hunter-exploration.test.mjs。

**Interfaces:** scenes.exploration.sites 为对象：每个地点有 name、x/y（百分比）、entry、default_area、areas 数组（id/name/x/y）、fire_area（有火源时）。routes 数组有 id/from/to/minutes/requires。每个非终局节点加 site；普通地点动作加 area，住宅沿用 region。普通跨地区动作加 travel:true，剧情推进动作保留为场景动作。

- [x] 用真实引擎写测试：离港后保留 06:00 的行动机会；普通人不能使用猎人分析；巡逻、诱导、观潮要有实际线索；充分准备完成 B 线。
- [x] 运行新增测试，确认功能未实现导致失败。
- [x] 定义各地点区域、地图边及阶段入口，保留旧动作 ID 与原文。
- [x] 以数据事件实现新告示、H01–H05、配方、物品诱导及安全休整的线索前置。
- [x] 所有线索补充 summary/use/topics 展示元数据；新增配方继承原事实。
- [x] 执行数据校验与新增测试，向引擎和界面提供实际 ID 清单。

## Task 2: 地图、区域与版本 3 引擎

**Files:** game/engine.mjs；tests/port-exploration.test.mjs；受影响的既有测试夹具。

**Interfaces:** 保留 createGame(scenes,items)。增加 site(state)、area(state)、areas(state)、moveArea(state,id)、mapRoutes(state)、travel(state,siteId)、focus(state)、describePlace(place)。返回 exploration 配置。moveRoom 保留住宅接口。mapRoutes 返回目的地记录 `{id,name,minutes,legs,available,reason}`。

- [x] 测试区域移动零分钟、跨区域动作拒绝、物品真实分区、旧版本不伪造物品分区。
- [x] 测试地图按真实道路耗时，一次提交仅递增一个 turn，危险中断停在实际节点，越过离港时不能恢复船。
- [x] 实现版本 2 → 3 一次迁移；版本 1 先沿现有逻辑升级至 2。
- [x] 将 place/fire/item_at/取回与当前区域统一；旧版地点级物件以遗留物记录保留。
- [x] 路线仅在地点探索入口可执行；交谈、追逐、登船中可查看地图但须结束当前行动。
- [x] 实现任务摘要和安全休整；测试完整小时恢复 2 点、上限与世界事件中断。
- [x] 保留全部旧测试断言；需要时让路线夹具先执行新区域移动。

## Task 3: 地图与界面

**Files:** game/app.mjs、game/style.css、game/map-view.mjs（地图呈现）；index.html、tools/play.py（模块路由）；tests/browser.test.mjs。

**Interfaces:** 使用 Task 2 的 API。地图只呈现玩家已知状态；局部区图使用真实空间布局；不再用普通前往动作列表作为地图。保持既有类名与住宅行为，便于回归。

- [x] 真实浏览器测试先覆盖总图选点、餐厅／码头分区、当前区域热点、主目标与线索摘要层次。
- [x] 实现 SVG 港口总图与局部图，保留住宅四区域插画。
- [x] 界面统一为简洁状态、一个追踪目标、场景、对象卡和工具栏；交易按类别收纳。
- [x] 线索簿实现当前调查／全部、分类、摘要和可展开来源；进入关联模式才显示勾选框。
- [x] 实现桌面、窄屏、键盘及刷新行为，保留五秒旁白与重大结果确认。

## Task 4: 集成和验收

**Files:** README.md、docs/11_全港探索与猎人玩法落地记录.md、docs/06_验收测试.md。

- [x] 运行 `python -X utf8 tools/validate_data.py`。
- [x] 运行 `python -B -X utf8 -m unittest discover -s tests -p test_launcher.py`。
- [x] 运行 `node --test tests/game.test.mjs tests/act1-schedule.test.mjs tests/investigation.test.mjs tests/port-exploration.test.mjs tests/hunter-exploration.test.mjs`。
- [x] 运行 `node --test tests/browser.test.mjs`，监测 console 与 HTTP 错误。
- [x] 对比基线：受保护正文一致；本次修改行没有空白错误和冲突标记。
- [x] 规格及代码审查后处理实际问题，记录最终结果、数据接口、未覆盖范围和本地运行方式。

验收证据：64项规则、2项Python启动、1项真实Edge集成通过；JS语法与数据校验通过，浏览器console/本地HTTP错误为0。原始正文和人物数据与开工基线一致。详见11号落地记录。
