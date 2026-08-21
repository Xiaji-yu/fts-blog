---
date: 2026-07-25
tags:
  - Moonlight
  - sunshine
  - udp
  - QoS
  - v2rayNG
  - 网络优化
---
---
[!ABSTRACT] 方案背景
在移动数据网络（4G/5G）环境下进行 Moonlight 远程串流时，运营商常会对 UDP 流量进行严重限速或 QoS 抖动，导致画面频繁卡顿、丢帧甚至断连。
**解决方案**：利用 **Xray (VLESS + gRPC over TCP)** 协议，将平板端 Moonlight 发出的 UDP 流量在传输层封装为标准的 **TCP/gRPC** 报文发往家中的软路由，软路由解包后转发给局域网内的 Sunshine PC，从而彻底绕过 UDP 限速。


## 🏗 网络拓扑

```

[平板 Moonlight]

│ (局域网 IP: 192.168.1.X)

▼

[v2rayNG 客户端] ──(TCP/gRPC 隧道 封装)──► [蜂窝移动网络 / 运营商]

│

▼ (WAN 端口: 自定义端口)

[Sunshine PC (192.168.1.X)] ◄──(局域网解包转发)── [iStoreOS 软路由 (Xray)]

````

---

## 🛠 一、 服务端配置（iStoreOS / OpenWrt ARM64）

### 1. 安装 Xray-core
使用 SSH 连接到 iStoreOS，下载并安装适用于 ARM64 架构的 Xray-core：

```bash
# 创建临时目录并下载 ARM64 包
mkdir -p /tmp/xray && cd /tmp/xray
wget [https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-arm64-v8a.zip](https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-arm64-v8a.zip)

# 解压并安装二进制文件
unzip Xray-linux-arm64-v8a.zip
mv xray /usr/bin/
chmod +x /usr/bin/xray
rm -rf /tmp/xray

# 验证安装
xray version
````

### 2. 生成 UUID 与配置文件

执行以下命令生成专属 UUID：

Bash

```
xray uuid
```

使用 `vim` 编辑 Xray 配置文件：

Bash

```
mkdir -p /etc/xray
vim /etc/xray/config.json
```

写入以下配置（**注意替换你的 UUID 与自定义端口**）：

JSON

```
{
  "log": {
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "port": 28443,
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "<YOUR_UUID>",
            "level": 0
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "grpc",
        "grpcSettings": {
          "serviceName": "moonlight-grpc"
        }
      }
    }
  ],
  "outbounds": [
    {
      "protocol": "freedom",
      "settings": {}
    }
  ]
}
```

> [!TIP] 配置文件语法检查
> 
> 保存后可执行 `xray run -test -c /etc/xray/config.json` 检查格式是否正确。

### 3. 配置开机自启 (procd)

使用 `vim` 创建服务脚本 `/etc/init.d/xray`：

Bash

```
vim /etc/init.d/xray
```

粘贴以下内容：

Bash

```
#!/bin/sh /etc/rc.common

START=99
USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command /usr/bin/xray run -c /etc/xray/config.json
    procd_set_param respawn
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}
```

设置执行权限并启动服务：

Bash

```
chmod +x /etc/init.d/xray
/etc/init.d/xray enable
/etc/init.d/xray start
```

### 4. 开放防火墙端口

编辑 `/etc/config/firewall` 放行 WAN 口的 TCP 端口（如 `28443`）：

Bash

```
vim /etc/config/firewall
```

在末尾添加：

Plaintext

```
config rule
	option name 'Allow-Xray-gRPC'
	option src 'wan'
	option dest_port '28443'
	option proto 'tcp'
	option target 'ACCEPT'
```

重启防火墙服务：

Bash

```
/etc/init.d/firewall restart
```

## 💻 二、 被控端 PC 配置（Sunshine）

### 1. 防火墙端口放行

若 Sunshine 端口修改为了自定义端口（如基准端口 `22222`），需在 PC 端手动放行 Windows 入站规则。在 Windows 上以**管理员身份**打开 PowerShell 执行：

PowerShell

```
netsh advfirewall firewall add rule name="Sunshine Custom Ports TCP" dir=in action=allow protocol=TCP localport=22217,22222,22223,22243
netsh advfirewall firewall add rule name="Sunshine Custom Ports UDP" dir=in action=allow protocol=UDP localport=22231-22234
```

> [!NOTE]
> 
> 确保 Windows 系统的网络类型设置为 **“专用网络 (Private Network)”**，避免公共网络策略拦截内网跨网段转发。

## 📱 三、 主控端安卓平板配置（v2rayNG）

### 1. 软件版本

下载并安装 **`v2rayNG_x.x.x_arm64-v8a.apk`**（推荐官方 Release 标准版）。

### 2. 节点参数配置

新建 **VLESS** 节点，设置如下：

- **地址 (Address)**：你的 DDNS 域名（如 `your-domain.com`）或公网 IP
    
- **端口 (Port)**：`28443`（与服务端监听端口一致）
    
- **用户 ID (UUID)**：`<YOUR_UUID>`
    
- **加密方式 (Encryption)**：`none`
    
- **传输协议 (Network)**：`grpc`
    
- **gRPC serviceName**：`moonlight-grpc`
    
- **传输层安全 (TLS)**：`none` / 关闭
    

### 🚨 3. 关键路由设置（避坑核心）

默认情况下，安卓系统和 v2rayNG 会直接剥离并绕过 `192.168.x.x` 的私有局域网流量，导致流量无法进入 Xray 隧道。**必须进行以下两项调整**：

#### 步骤 A：关闭系统级“绕过局域网”

1. 打开 v2rayNG -> 左上角菜单 -> **设置**。
    
2. 找到 **VPN 设置** 区域。
    
3. **关闭“绕过局域网地址”开关**（允许 VPN 接管私有 IP）。
    

#### 步骤 B：添加局域网代理路由规则

1. 打开 v2rayNG -> 左上角菜单 -> **路由设置**。
    
2. 点击右上角 **`+`** 添加自定义规则：
    
    - **备注**：`Sunshine-Proxy`
        
    - **ip**：`192.168.1.0/24`（或填写 PC 内网 IP `192.168.1.X`）
        
    - **outboundTag**：`proxy`
        
3. 保存规则并将其置顶（开启规则开关）。
    
4. **关闭** 下方默认的 `绕过局域网IP ([geoip:private] -> direct)` 开关。
    

## 🎮 四、 Moonlight 客户端连接与调优

1. 打开 **v2rayNG** 并启动代理连接。
    
2. 打开 **Moonlight**，手动添加主机：
    
    - **主机地址**：`192.168.1.X`（**填 PC 的内网静态 IP，无需填公网 IP**）
        
    - **端口**：`22222`（按个人 Sunshine 配置填写）
        
3. 按照屏幕提示完成首次 PIN 码配对。
    

> [!TIP] 串流调优参数建议
> 
> - **视频码率 (Bitrate)**：**15Mbps ~ 25Mbps**（TCP 隧道受信道拥堵影响较大，不建议盲目开高码率）。
>     
> - **数据包大小 (Packet Size)**：若遇到微小卡顿，可在 Moonlight 设置中将包大小调整为 **1200**，避免数据链路 MTU 溢出分片。
>     
> - **帧率与分辨率**：1080p / 60fps。
>     

## 🔍 五、 快速排查指南

|**现象 / 报错**|**可能原因**|**解决办法**|
|---|---|---|
|**`io: read/write on closed pipe`**|1. `serviceName` 填错<br><br>  <br><br>2. 服务端 Xray 进程挂掉|1. 核对客户端 `moonlight-grpc` 拼写<br><br>  <br><br>2. SSH 执行 `xray run -test -c /etc/xray/config.json`|
|**`该地址似乎不正确。您必须使用路由器的公共 IP 地址`**|1. v2rayNG 拦截了内网 IP<br><br>  <br><br>2. 流量没走隧道|1. 检查 v2rayNG 设置中“绕过局域网”是否关闭<br><br>  <br><br>2. 确认自定义路由规则 `192.168.1.0/24 -> proxy` 开启|
|**测试延迟连通，但 Moonlight 连不上**|PC 防火墙拦截了新端口|PC 端重新运行 `netsh advfirewall` 命令放行 `22222` 等自定义端口|