---
tags:
  - git
  - fetch
  - docker
date: 2025-12-07T18:05:00
---
这个经验旨在解决一些陈年老镜像的自动更新git fetch失败问题
##  在 Docker 容器中执行 `git fetch` 失败，可能由多种原因引起。以下是常见问题及对应的解决方法：


---

### 一、**网络连接问题**
>一般最常见的就是网络问题，但是我自己配置的话几乎都可以避免这个问题出现

#### 解决方法：

##### ·**==测试网络连通性：==**
进入容器之后，ping一下GitHub域名，看是否能够解析
```
docker exec -it <容器名> ping github.com
```
如果不通，说明网络有问题。

##### ·==**配置 Docker 使用主机网络（开发环境临时用）：**==

使容器直接使用宿主机网络再试一次
```
docker run --network host ...
```
##### ·==**配置代理（如果在公司网络）：**==

在容器内设置 Git 代理：
```
git config --global http.proxy http://your-proxy:port
git clone ... # 或 git fetch
```
或者在运行容器时传入环境变量：
```
docker run -e HTTP_PROXY=http://your-proxy:port -e HTTPS_PROXY=http://your-proxy:port ...
```

---

### 二、SSH 密钥未配置（使用 SSH 协议时）

> **如果你的 Git 远程地址是 `git@github.com:user/repo.git`，需要 SSH 密钥。**

#### 解决方法：

##### ·==**将宿主机的 SSH 密钥挂载进容器**：==

```
docker run -v ~/.ssh:/root/.ssh your-image
```
> 注意权限问题，确保 `.ssh` 目录权限为 `700`，私钥权限为 `600`。

##### ·==**或者使用 HTTPS 方式代替 SSH**（推荐用于 CI/CD）：==

```
git remote set-url origin https://github.com/user/repo.git
```

---

### 三、 **Git 凭据缺失（HTTPS 方式）**

>如果是私有仓库，HTTPS 方式需要用户名和 token。
#### 解决方法：

##### ·==**使用 Personal Access Token (PAT)**：==

```
git config --global credential.helper store 
git fetch # 输入用户名（任意），密码为 GitHub Token
```

##### ·==**或直接在 URL 中嵌入 token（不推荐长期使用）**：==

```
git remote set-url origin https://<TOKEN>@github.com/user/repo.git
```
顾名思义，不推荐长期使用

---

### 四、 **DNS 解析失败**

>容器内 DNS 配置错误可能导致无法解析 `github.com`。
>最不常见的，也是最难发现的DNS解析错误问题，就像有时候网页上不了网但是QQ或者微信能很正常使用的时候，也是DNS的问题，一般来说，只要你不乱动设置，DNS几乎不会出问题

#### 解决方法：

##### ·==**启动容器时指定 DNS：**==

```
docker run --dns 8.8.8.8 your-image
```

##### ·==**或修改 Docker daemon 的 `/etc/docker/daemon.json`：**==

```
{ 
"dns": ["8.8.8.8", "114.114.114.114"] 
}
```
然后重启 Docker：`systemctl restart docker`

---

### 五、 **SSL/TLS 证书验证失败**

>某些基础镜像（如 Alpine）缺少 CA 证书。

#### 解决方法：

##### ·==**Alpine 镜像**：==

```
RUN apk add --no-cache ca-certificates git
```

##### ·==**Debian/Ubuntu 镜像**：==

```
RUN apt-get update && apt-get install -y ca-certificates git
```

##### ==·临时跳过 SSL 验证（**不安全，仅调试用**）：==

```
git config --global http.sslVerify false
```

---

### 六、**容器内没有安装 Git**

>有些基础镜像（如 `scratch`、`distroless`）不包含 Git。

#### 解决方法：

##### ==使用带 Git 的镜像（如 `alpine:latest` + 安装 Git）或在 Dockerfile 中安装：==

```
RUN apt-get update && apt-get install -y git # 或 RUN apk add --no-cache git
```

---

### ==七、检查 `.git/config` 中的 `[remote "origin"]` 是否被篡改这（是我自己遇到的最特殊的一种情况）==

>想了想还是把我自己遇到的最特殊的一种情况写在最后，因为这个实在是遇到的几率太低了

#### 解决方法：

首先进入docker容器内：

```
docker exec -it <容器ID或容器名> /bin/bash
```
直接运行：
```
cat .git/config
```
查看是否有类似：
```
[remote "origin"] url = https://github.com/lilixxs/gsuid_core-prci.git fetch = +refs/heads/*:refs/remotes/origin/*
```
==⚠️ 特别注意：**URL 是否真的干净？有没有隐藏的用户名？**==
有时候肉眼看起来一样，但实际包含不可见字符或旧配置残留。

我自己的输出：
```
[core] 
	repositoryformatversion = 0 
	filemode = true 
	bare = false 
	logallrefupdates = true 
[remote "origin"]
	url = https://github.com/lilixxs/gsuid_core-prci.git
	fetch = +refs/heads/*:refs/remotes/origin/* 
[gc]
	 auto = 0
[http "https://github.com/"]
	extraheader = AUTHORIZATION: basic eC1hY2Nlc3MtdG9rZW46Z2hzXzM2S2JYVTRzTEIyOUFYR3dIYmVieEpjTEpIZTRoZzNOMEJqTA== [branch "master"]
	remote = origin merge = refs/heads/master
```
原因就出在：
```
[http "https://github.com/"]
	extraheader = AUTHORIZATION: basic eC1hY2Nlc3MtdG9rZW46Z2hzXzM2S2JYVTRzTEIyOUFYR3dIYmVieEpjTEpIZTRoZzNOMEJqTA== 
```
上面，因为他fetch的时候内置了一个过期的Token，这可是害惨了我，==镜像的作者为 `https://github.com/` 添加了一个 **硬编码的 HTTP Basic Auth 头**==，内容是：


```
echo "eC1hY2Nlc3MtdG9rZW46Z2hzXzM2S2JYVTRzTEIyOUFYR3dIYmVieEpjTEpIZTRoZzNOMEJqTA==" | base64 -d
```
这个 Base64 字符串解码后是：
```
echo eC1hY2Nlc3MtdG9rZW46Z2hzXzM2S2JYVTRzTEIyOUFYR3dIYmVieEpjTEpIZTRoZzNOMEJqTA==" | base64 -d
```
结果为：
```
x-access-token:ghs_36KbXU4sLB29AXGwHbebxDcLJHe4hg3N0BjL
```
==🚨 这是一个 **GitHub Actions 的自动令牌（`ghs_...`）**，通常用于 CI 环境，**且已过期或无权限访问该仓库**。==
Git 在每次请求时都会带上这个无效的 `Authorization` 头，导致 GitHub 认为你在尝试用无效凭据认证，于是返回：

```
remote: Invalid username or token. 
Password authentication is not supported...
```
即使你用 `credential.helper=` 也没用，因为这是 **硬编码在 Git 配置里的 HTTP 头**，优先级更高！
##### 解决方案：删除这个非法的 `extraheader`
运行以下命令，**移除这个配置块**：
```
git config --unset http."https://github.com/".extraheader
```
或者直接干脆编辑 `.git/config`，**删除整个 `[http "https://github.com/"]` 小节**
删除后，`.git/config` 应只保留：
```
[core]
	repositoryformatversion = 0 
	filemode = true 
	bare = false 
	logallrefupdates = true 
[remote "origin"]
	url = https://github.com/lilixxs/gsuid_core-prci.git 
	fetch = +refs/heads/*:refs/remotes/origin/* 
[gc]
	auto = 0 
[branch "master"] 
	remote = origin
	merge = refs/heads/master
```
### ✅ 验证修复
然后执行：
```
git fetch
```

---
==**修复完成**==