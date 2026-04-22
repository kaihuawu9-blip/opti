# 多门店共享销售管理系统（镜售 / Opti-AI）

基于 **Next.js**、**Tailwind CSS** 的门店销售与库存系统。核心交易数据以**私有化部署**为主，降低跨境链路与公网依赖带来的延迟与合规风险。

## 对内说明：数据与架构（2026）

- **本地 PostgreSQL**：商品与库存等核心读写已支持通过 **`DATABASE_URL`** 直连本机/内网 Postgres；库存模块的 HTTP API 使用 **Prisma**（`prisma/schema.prisma` 由内省生成），便于门店侧毫秒级响应。
- **Supabase 客户端**：收银、报表、认证等路径仍可能使用 **`@supabase/supabase-js`** 与 `NEXT_PUBLIC_SUPABASE_*`（自托管或兼容网关）。迁移其他模块时按页面逐步替换即可。
- **「镜问镜答」**：原基于 Supabase `chat_messages` 的门店群聊页已**下线**（侧栏入口已移除，`/chat` 会重定向到工作台）。后续如重做店内沟通，计划采用**本地 Socket** 等更轻量的方案，不再依赖原云端实时组件。

## 环境变量（摘要）

| 用途 | 变量示例 |
|------|----------|
| 本机/内网 Postgres（Prisma、库存 API） | `DATABASE_URL=postgresql://用户:密码@127.0.0.1:5432/库名` |
| Supabase 网关（未迁走的页面仍可能需要） | `SUPABASE_URL` / `SUPABASE_ANON_KEY`，或 `ALIYUN_*`、`NEXT_PUBLIC_OPTI_AI_SUPABASE_URL` 等（代码不读取 `NEXT_PUBLIC_SUPABASE_*`） |
| 服务端高权限（部分 API） | `SUPABASE_SERVICE_ROLE_KEY` 或兼容别名 |

具体以项目根目录 **`.env`** 为准（唯一环境文件）。

## 功能特点

- **多门店**：销售与库存可按门店隔离。
- **收银台**：加购、结算、库存联动。
- **库存管理**：商品维护与预警（经 `/api/inventory/products` + Prisma 写库）。
- **销售报表**：统计与明细。

## 快速开始

```bash
cd sale-system
npm install
# 在项目根目录创建或编辑 .env（DATABASE_URL、Supabase 等）
npm run dev
```

数据库表结构可由 **`npx prisma@5.22.0 db pull`** 与现有库对齐，再 **`npx prisma@5.22.0 generate`** 生成客户端。

生产环境：

```bash
npm run build
npm run start
```

## 技术栈

- **前端**：Next.js（App Router）、TypeScript、Tailwind CSS  
- **图标**：Lucide React  
- **数据**：PostgreSQL；Prisma（库存等）；Supabase JS（部分遗留能力）
