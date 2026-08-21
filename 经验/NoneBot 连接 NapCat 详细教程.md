---
tags:
  - NapCat
  - Nonebot
  - websocket
date: 2026-05-24T04:31:00
cssclasses:
---


本教程基于实际排错经验，总结 NoneBot (v2.x) 与 NapCat (v4.x) 通过 **OneBot V11 协议** 建立 WebSocket 连接的完整步骤，涵盖 **正向** 与 **反向** 两种模式，并重点介绍稳定可靠的 **反向 WebSocket** 配置。

---

## 📦 环境准备

- **NoneBot 项目**：已创建并安装 `nonebot2` 及 `nonebot-adapter-onebot`。
- **NapCat**：已安装并登录 QQ 账号。
- **网络**：两者在同一内网或本机，防火墙允许相应端口通信。

### 安装必要依赖

```bash
# 进入 NoneBot 项目虚拟环境
source .venv/bin/activate   # Linux/macOS
# 或 .venv\Scripts\activate  (Windows)

# 安装 FastAPI 驱动器（反向连接必需）
pip install 'nonebot2[fastapi]'

# 或安装混合驱动器（正向连接）
pip install 'nonebot2[httpx]' 'nonebot2[websockets]'

# 安装 OneBot V11 适配器
pip install nonebot-adapter-onebot
```

---

## 🔗 方式一：反向 WebSocket（推荐，稳定）

**原理**：NapCat 作为客户端主动连接 NoneBot 服务端。NoneBot 负责心跳与断线重连管理，适合长期运行。

### 1. 配置 NoneBot（服务端）

编辑项目根目录下的 `.env.prod` 文件（若使用开发环境则 `.env`）：

```ini
# .env.prod
HOST=0.0.0.0                # 监听所有网络接口
PORT=1314                   # 服务端口（可自定义）
DRIVER=~fastapi             # 必须使用服务端驱动器

COMMAND_START=["/"]
COMMAND_SEP=["."]

# 关键配置：反向 WebSocket 服务端（列表格式）
ONEBOT_WS_REVERSE_SERVERS=["ws://0.0.0.0:1314/onebot/v11/ws"]

# 可选 Token（与 NapCat 保持一致）
ONEBOT_ACCESS_TOKEN=123456

LOG_LEVEL=INFO
```

> ⚠️ 注意：变量名必须是 `ONEBOT_WS_REVERSE_SERVERS`，值为 JSON 数组字符串，路径 `/onebot/v11/ws` 为 OneBot V11 标准路径。

### 2. 启动 NoneBot

```bash
nb run
```

成功日志应包含：
```
[INFO] uvicorn | Uvicorn running on http://0.0.0.0:1314
[INFO] nonebot | OneBot V11 WebSocket server started on ws://0.0.0.0:1314/onebot/v11/ws
```

### 3. 配置 NapCat（客户端）

打开 NapCat WebUI（默认 `http://127.0.0.1:6099`），进入 **网络配置** → **WebSocket 客户端**：

- **启用**：✅
- **名称**：任意（如 `NoneBot`）
- **URL**：`ws://<NoneBot机器IP>:1314/onebot/v11/ws`  
  （若同机可用 `127.0.0.1`，否则填实际内网 IP，如 `192.168.1.111`）
- **消息格式**：`Array`
- **Token**：`123456`（与 NoneBot 中一致）
- **心跳间隔**：`5000`（毫秒）
- **重连间隔**：`5000`

保存并 **重启 NapCat**。

### 4. 验证连接

NoneBot 终端出现：
```
[INFO] nonebot | OneBot V11 | Bot <你的QQ号> connected
[INFO] websockets | connection open
```

NapCat 日志显示 WebSocket 连接成功。此时机器人已就绪。

---

## 🔄 方式二：正向 WebSocket（备用方案）

**原理**：NoneBot 作为客户端主动连接 NapCat 服务端。配置简单，但心跳与重连由 NoneBot 管理。

### 1. 配置 NapCat（服务端）

NapCat WebUI → **网络配置** → **WebSocket 服务器**：

- **启用**：✅
- **Host**：`0.0.0.0`（或 `127.0.0.1` 仅限本机）
- **Port**：`3001`
- **消息格式**：`Array`
- **Token**：`123456`（可选）
- **心跳间隔**：`5000`

保存并重启 NapCat。

### 2. 配置 NoneBot（客户端）

编辑 `.env.prod`：

```ini
HOST=0.0.0.0
PORT=1314
DRIVER=~httpx+~websockets          # 混合驱动器

COMMAND_START=["/"]
COMMAND_SEP=["."]

# 指向 NapCat 的 WebSocket 服务端地址（可多个）
ONEBOT_WS_URLS=["ws://127.0.0.1:3001"]

# 若 NapCat 设置了 Token，则需添加
ONEBOT_ACCESS_TOKEN=123456

LOG_LEVEL=INFO
```

### 3. 启动 NoneBot

```bash
nb run
```

成功日志：
```
[INFO] nonebot | OneBot V11 WebSocket Client connected to ws://127.0.0.1:3001
[INFO] nonebot | OneBot V11 | Bot <QQ号> connected
```

---

## 🛠️ 常见问题与排错

| 现象                                                | 可能原因                                              | 解决方案                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| NoneBot 日志只有 `Uvicorn running`，无 WebSocket 服务启动信息 | 反向连接配置变量名错误或驱动器不是 `~fastapi`                      | 确保使用 `ONEBOT_WS_REVERSE_SERVERS` 且格式为列表；检查 `.env` 是否被其他文件覆盖                                                     |
| NapCat 连接报 `404 Not Found`                        | WebSocket 路径不一致                                   | 检查 NoneBot 的 `ONEBOT_WS_PATH`（反向）或 URL 中的路径是否与 NapCat 配置匹配，默认可统一为 `/onebot/v11/ws`                              |
| NapCat 连接报 `401 Unauthorized`                     | Token 不匹配                                         | 确保 NoneBot 的 `ONEBOT_ACCESS_TOKEN` 与 NapCat 中设置的 Token 完全相同                                                     |
| 连接超时或 `InvalidMessage`                            | 防火墙阻止、IP 地址错误或端口未监听                               | 1. 在 NoneBot 机器上执行 `lsof -i :1314` 确认监听<br>2. 放行端口：`sudo ufw allow 1314/tcp`<br>3. 使用 `ping` 和 `telnet` 测试网络连通性 |
| 连接后立即断开                                           | 协议版本不匹配（如 V11 vs V12）或心跳超时                        | 双方统一使用 OneBot V11；调大心跳/重连间隔                                                                                     |
| 配置文件不生效                                           | 存在 `.env.prod` 但 `nb run` 显示 `Env: prod`，却未加载预期变量 | 检查是否有多余的 `.env` 文件；使用 `LOG_LEVEL=DEBUG` 查看配置加载详情                                                                |

---

## 📌 总结

- **反向 WebSocket** 配置稍复杂，但稳定性与扩展性更好，适合生产环境。关键点：`DRIVER=~fastapi` + `ONEBOT_WS_REVERSE_SERVERS=["ws://0.0.0.0:端口/路径"]`。
- **正向 WebSocket** 配置简单，适合快速测试。
- 遇到连接问题，先确认 NoneBot 是否真正启动了 WebSocket 服务端/客户端日志，然后检查防火墙、IP、端口、路径和 Token。

按照本教程操作，你应该能顺利打通 NoneBot 与 NapCat，开始愉快的机器人开发！