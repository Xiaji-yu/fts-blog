---
tags:
  - Bot
  - Astrbot
  - NapCat
  - vllm
  - LLM
date: 2025-11-29T19:38:00
---
*此文档旨在利用空闲小号QQ来作为机器人，可以连接一些具有实际功能的插件（游戏查询插件、大模型聊天插件、大模型代码辅助插件等等）来进行资源利用*

## 一、 部署AstrBot

项目仓库地址：[https://github.com/AstrBotDevs/AstrBot](Astrbot)
项目官网地址：[https://docs.astrbot.app/](AstrBot聊天智能体基础设施)
### · Docker部署
```
	mkdir astrbot
	cd astrbot
	sudo docker run -itd \
	-e TZ=Asia/Shenghai \
	-p 6185:6185 \
	-p 8082:8082 \
	-v $PWD/data:/AstrBot/data \
	--name astrbot soulter/astrbot:latest
```
	避免以后arrch环境部署麻烦下面整理成一行代码
```
	sudo docker run -itd -e TZ=Asia/Shenghai -p 8082:8082 -p 6185:6185 -v $PWD/data:/AstrBot/data --name astrbot soulter/astrbot:latest
```

关于端口映射，此教程是以极简的形式来创建容器的，至于软件其他端口可以参考下表

| Port | Description                                  | Type |
| ---- | -------------------------------------------- | ---- |
| 6185 | AstrBot WebUI 默认端口                           | 必须   |
| 6195 | 企业微信 默认端口                                    | 可选   |
| 6199 | OneBot(aiocqhttp)  默认端口                      | 可选   |
| 6196 | QQ 官方 API(Webhook) HTTP callback server 默认端口 | 可选   |
| 8082 | 与NapCat链接的端口（可自行更换没有被占用端口）                   | 必须   |

 Windows 下不需要加 sudo，下同 Windows 同步 Host Time（需要WSL2） 
```
	-v \\wsl.localhost\(your-wsl-os)\etc\timezone:/etc/timezone:ro 
	-v \\wsl.localhost\(your-wsl-os)\etc\localtime:/etc/localtime:ro	
```

通过以下命令查看 AstrBot 的日志：
```
	sudo docker logs -f asrebot
```
### · Docker Compose 部署
首先，需要 Clone AstrBot 仓库到本地：
```
	mkdir AstrBot
	cd AstrBot
	git clone https://github.com/AstrBotDevs/AstrBot
```
然后，运行 Compose：
```
	sudo docker compose up -d
```

### 大功告成

如果一切顺利，你会看到 AstrBot 打印出的日志。

如果没有报错，你会看到一条日志显示类似 `🌈 管理面板已启动，可访问` 并附带了几条链接。打开其中一个链接即可访问 AstrBot 管理面板。由于 Docker 隔离了网络环境，所以不能使用 `localhost`访问管理面板。

默认用户名和密码是 `astrbot` 和 `astrbot`。

如果部署在云服务器上，需要在相应厂商控制台里放行你所映射的端口。

## 二、部署NapCat

官网地址：[https://www.napcat.wiki/](NapCat)
GitHub仓库地址：[https://github.com/NapNeko/NapCatQQ]()

### · Docker部署
直接部署
```
	docker run -d \
	-e NAPCAT_GID=$(id -g) \
	-e NAPCAT_UID=$(id -u) \
	-p 3000:3000 \
	-p 3001:3001 \
	-p 6099:6099 \
	--name napcat \
	--restart=always \
	mlikiowa/napcat-docker:latest
```
避免以后arrch环境部署麻烦下面整理成一行代码
```
	docker run -d -e NAPCAT_GID=$(id -g)  -e NAPCAT_UID=$(id -u) -p 3000:3000 -p 3001:3001 -p 6099:6099 --name napcat --restart=always mlikiowa/napcat-docker:latest
```

或者使用docker-compose部署，首先在/opt创建一个目录
```
mkdir napcat
```
然后创建一个docker-compose.yaml文件在里面写入
```
vim docker-compose.yaml

version: '3.8'

services:
  napcat:
    image: mlikiowa/napcat-docker
    container_name: napcat
    restart: always
    network_mode: bridge
    ports:
      - "3000:3000"
      - "3001:3001"
      - "6099:6099"
    environment:
      - TZ = Asia/Shanghai
      - VNC_PASSWD = vncpasswd
```
启动命令
```
docker compose up -d
```
部署成功之后查看日志获取token
```
	docker logs -f napcat
```

浏览器输入 ‘http://服务器地址:6099’ 进入控制台界面，输入在日志中获取的token登陆，然后选择密码登陆或者扫码登陆

QQ 持久化数据路径：/app/.config/QQ
NapCat 配置文件路径: /app/napcat/config

提示：尽量扫码登陆，这样不容易被踢，此项目的QQ为Linux平台QQ内核，可以跟手机QQ同时登陆所以不用担心手机QQ顶掉。

## 三、链接AstrBot和NapCat

### NapCat方面配置

进入控制台登陆QQ成功之后，点击 “网络配置”  →  “新建”
	![[1-部署Astrbot+NapCat搭建QQ机器人.png]]
新建一个WebSocket客户端
	启用  选择开启
	名称  输入你的自定义名称
	URL  改成你AstrBot的部署的地址+端口号 **注意注意地址后面要加上“/ws”**
	消息格式  选择 ”Array“
	（可选）Token  如果是在内网环境下，可以选择留空避免出现更多岔子
	心跳间隔  输入“5000”
	完成之后保存
	![[5-部署Astrbot+NapCat搭建QQ机器人.png]]

至此NapCat方面设置完成
留意日志，此时一直在报错，那是因为AstrBot那边还没有配置，所以一直链接失败，无需担心

### AstrBot方面配置

第一次进入主页之后  用户名跟密码都是astrbot，第一次登陆成功之后会强制要求更改密码并再次登陆

登录成功之后，会直接进入到仪表盘界面
	![[6-部署Astrbot+NapCat搭建QQ机器人.png]]
选择 “创建机器人”
	选择消息平台类别 选择 “QQ个人号（onebot v11）”
	机器人名称 填入你自定义的名字
	启用 选择启用
	反向 Websocket 主机 默认 0.0.0.0 或者 你部署的宿主机IP（前提是按照本教程部署的）
	反向 Websocket 端口 填入在本教程Docker部署时选择的 8082端口
	反向 Websocket Token 填入在NapCat WebSocket客户端填入的Token （本教程是在内网环境中部署，所以忽略此选项）
	点击保存
	![[7-部署Astrbot+NapCat搭建QQ机器人.png]]
此时两边链接步骤配置完成！
注意观察日志，如果卡在链接onebot v11 步骤，返回NapCat WebSocket客户端重新启用一下就好了

此时发现，你给你小号发消息还是不理你
当然不会理你了，你小号还没接入 #vllm LLM（Large Language Model 大语言模型）当然不会理你了，除非你机魂大悦！

## 四、给AstrBot接入LLM（大语言模型）

进入astrbot仪表盘 选择 模型提供商 选项卡进入 模型提供商界面 
选择你要接入的供应商
	![[8-部署Astrbot+NapCat搭建QQ机器人.png]]
点击相对应的供应商图标，填入你在供应商那边搞到的API Key
就搞定了
现在你的qq小号就能陪你聊天了
快去试试吧
