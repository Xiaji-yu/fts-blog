---
date: 2026-05-28T12:00:00
tags:
  - nginx
  - proxy
  - ssl
---

# Nginx 反向代理详细教程

> 本教程以 OpenClaw WebUI 为例，讲解如何配置 Nginx 反向代理

## 环境说明

- 服务器: 192.168.1.2 (Debian)
- OpenClaw Gateway: 192.168.1.2:18789
- 域名: openclaw.xiaji.xin
- 已有 SSL 证书

## 步骤一：安装 Nginx

```bash
apt update && apt install -y nginx
```

## 步骤二：申请 SSL 证书

使用 acme.sh 自动签发 Let's Encrypt 证书：

```bash
# 安装 acme.sh
curl https://get.acme.sh | sh

# 申请证书 (以域名 openclaw.xiaji.xin 为例)
acme.sh --issue -d openclaw.xiaji.xin --standalone --httpport 80

# 安装证书到指定目录
acme.sh --install-cert -d openclaw.xiaji.xin \
  --key-file /etc/nginx/ssl/openclaw.xiaji.xin.key \
  --fullchain-file /etc/nginx/ssl/openclaw.xiaji.xin.crt
```

## 步骤三：配置 Nginx

创建配置文件 `/etc/nginx/sites-available/openclaw`：

```nginx
# 定 义  WebSocket 映 射 ， 放 在  server 块 之 外
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
server {
    listen 80;
    server_name yours_yuming;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name yours_yuming;
    # 证 书 路 径
    ssl_certificate /etc/nginx/ssl/yours_ssl.crt;
    ssl_certificate_key /etc/nginx/ssl/yours_ssl.key;
    # 现 代  SSL 安 全 配 置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    location / {
        # 核 心 ： 将 访 问  gsuid.xiaji.xin/ 的 所 有 请 求 透 明 转 发 到 后 端 的 子 目 录
        proxy_pass http://你的后端域名/HTML路径;
        # 简 化 后 的  Header 配 置
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # 优 化 超 时
        proxy_read_timeout 3600s;
    }
}
```

## 步骤四：启用配置

```bash
# 创建符号链接
ln -s /etc/nginx/sites-available/openclaw /etc/nginx/sites-enabled/

# 测试配置
nginx -t

# 重载 Nginx
nginx -s reload
```

## 步骤五：端口映射 (路由器)

如果需要公网访问，需要在路由器上做端口映射：

| 协议 | 外部端口 | 内部地址 | 内部端口 |
|------|----------|----------|----------|
| TCP  | 443      | 192.168.1.2 | 443   |

## 常见问题

### 1. WebSocket 连接失败

确保 Nginx 配置了 `proxy_http_version 1.1` 和 `Upgrade` 头。

### 2. CORS 跨域问题

在 OpenClaw 配置中添加 `allowedOrigins`：

```json
{
  "gateway": {
    "controlUi": {
      "allowedOrigins": ["https://openclaw.xiaji.xin"]
    }
  }
}
```

### 3. 证书自动续期

acme.sh 会自动配置 cron job 续期证书。如需手动续期：

```bash
acme.sh --renew -d openclaw.xiaji.xin --force
nginx -s reload
```

### 4. 代理 502 Bad Gateway

检查上游服务是否运行：

```bash
curl http://127.0.0.1:18789
ps aux | grep openclaw
```

## 完整配置示例

```bash
# 1. 安装依赖
apt update && apt install -y nginx curl

# 2. 申请证书
mkdir -p /etc/nginx/ssl
acme.sh --issue -d openclaw.xiaji.xin --standalone --httpport 80
acme.sh --install-cert -d openclaw.xiaji.xin \
  --key-file /etc/nginx/ssl/openclaw.xiaji.xin.key \
  --fullchain-file /etc/nginx/ssl/openclaw.xiaji.xin.crt

# 3. 写入 Nginx 配置
cat > /etc/nginx/sites-available/openclaw << 'EOF'
# 见上文配置文件
EOF

# 4. 启用并重启
ln -s /etc/nginx/sites-available/openclaw /etc/nginx/sites-enabled/
nginx -t && nginx -s reload
```

---

*教程更新时间: 2026-02-22*