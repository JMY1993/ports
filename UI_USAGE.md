# Vibe Ports UI - Web Dashboard

## 介绍

Vibe Ports UI 是一个基于 Web 的管理界面，用于查看和管理 vibe-ports 的所有绑定和模板字符串。

## 快速开始

### 启动 UI 服务器

```bash
# 使用自动端口分配（推荐）
npx vibe-ports@latest ui

# 或指定特定端口
npx vibe-ports@latest ui --port 3000
```

服务器启动后，会自动分配一个前端端口（默认 3000-3999 范围），然后打开浏览器访问。

### 使用本地开发版本

```bash
# 构建所有部分
npm run build

# 启动 UI 服务器
node dist/index.js ui
```

## 功能

### 1. 仪表板 (Dashboard)

- **端口绑定统计**：显示已注册的所有端口总数和最近的几个
- **模板实例统计**：显示所有模板字符串实例的总数和最近的几个
- **按目的分类统计**：显示前端端口和后端端口的数量
- **项目统计**：显示有多少个项目正在使用 vibe-ports

### 2. 端口管理 (Ports)

- **完整列表**：表格显示所有端口绑定，包括：
  - 端口号
  - 项目名称
  - 分支
  - 用途 (frontend/backend)
  - 名称
  - 进程状态检查
  - 删除操作

- **进程监控**：点击"Check"按钮可以查看该端口上运行的进程信息：
  - 进程状态
  - PID（进程 ID）
  - 运行的命令

- **实时刷新**：端口列表每 5 秒自动刷新一次，保持最新状态

### 3. 模板管理 (Templates)

- **模板列表**：表格显示所有模板字符串实例，包括：
  - 模板字符串（带占位符）
  - 变量值
  - 渲染后的值
  - 创建时间
  - 删除操作

- **快速删除**：一键删除不需要的模板实例

## 技术栈

### 后端
- **Hono**：轻量级 Web 框架
- **Node.js**：运行时环境
- API 通过调用 `vibe-ports` CLI 命令来与数据库交互

### 前端
- **React 19**：UI 框架
- **Vite**：构建工具
- **React Router v7**：客户端路由
- **TanStack Query**：异步状态管理和数据同步
- **shadcn/ui**：高质量组件库
- **Tailwind CSS v4**：样式框架

## 开发

### 项目结构

```
vibe-ports/
├── src/                    # 主 CLI 代码
│   └── index.ts           # 包含 ui 命令
├── server/                 # Hono 后端服务器
│   ├── src/
│   │   ├── index.ts      # 主服务器文件
│   │   ├── routes.ts     # API 路由定义
│   │   ├── service.ts    # 业务逻辑
│   │   └── types.ts      # 类型定义
│   └── dist/             # 编译输出
└── ui/                    # React 前端应用
    ├── src/
    │   ├── pages/        # 页面组件
    │   ├── components/   # UI 组件
    │   ├── lib/          # 工具和配置
    │   └── types/        # TypeScript 类型
    └── dist/             # 构建输出

```

### 本地开发

```bash
# 终端 1：启动后端开发服务器
cd server
npm run dev

# 终端 2：启动前端开发服务器
cd ui
npm run dev
```

前端会代理 API 请求到后端（配置在 Vite 中）。

### 构建

```bash
# 构建所有部分（CLI + 后端 + 前端）
npm run build

# 或单独构建
npm run build:cli    # 仅构建 CLI
npm run build:server # 仅构建后端
npm run build:ui     # 仅构建前端
```

## API 端点

所有 API 返回 JSON 格式，支持 CORS。

### 端口绑定
- `GET /api/bindings` - 列出所有端口绑定（支持过滤）
- `DELETE /api/bindings/:port` - 按端口删除绑定
- `DELETE /api/bindings` - 按 key 删除绑定

### 模板字符串
- `GET /api/templates` - 列出所有模板实例
- `DELETE /api/templates` - 删除指定模板实例

### 进程信息
- `GET /api/process/:port` - 获取指定端口的进程信息

### 健康检查
- `GET /api/health` - 健康检查

## 常见问题

### 如何在后台运行 UI 服务器？

```bash
# 使用 nohup (Linux/macOS)
nohup node dist/index.js ui > ui.log 2>&1 &

# 或使用 pm2
npm install -g pm2
pm2 start "node dist/index.js ui" --name "vibe-ports-ui"
```

### UI 服务器占用的端口是多少？

UI 服务器会：
1. 自动使用 vibe-ports 为自己分配一个前端端口
2. 如果自动分配失败，默认使用端口 3000
3. 可以通过 `--port` 选项指定端口

### 如何修改 UI 的样式？

前端使用 Tailwind CSS，所以可以直接修改 className 或在 `src/index.css` 中添加自定义样式。

## 故障排除

### API 请求失败

检查后端服务是否正常运行，可以访问 `http://localhost:<port>/api/health` 进行健康检查。

### 前端页面不加载

确保前端构建产物在 `ui/dist` 目录中。如果没有，运行 `npm run build:ui` 构建前端。

### 进程信息为空

进程信息依赖于系统命令 (`lsof`, `ss`, `netstat` 等)。如果不可用，可能无法获取进程详情。

## 未来改进

- [ ] 深色模式支持
- [ ] 导出数据功能
- [ ] 端口使用统计图表
- [ ] 实时通知/日志
- [ ] 更详细的进程监控（内存、CPU 使用率）
- [ ] 搜索和过滤功能增强
- [ ] 用户认证/授权
