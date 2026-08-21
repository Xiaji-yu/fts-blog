---
tags:
  - MySQL
date: 2025-10-22T17:05:00
---

保姆级部署mysql教程
## 一、环境
---
	1、远程操作系统：ContOS
	2、远程管理工具：FinalShell
	3、安装软件名称：MySQL 版本8.3.0

## 二、拉取镜像
---
### 2.1 查找DockerHub上的MySQL镜像
```
docker search mysql
```
执行结果
```
root@iStoreOS:/# docker search mysql
NAME                   DESCRIPTION                                     STARS     OFFICIAL   AUTOMATED
mysql                  MySQL is a widely used, open-source relation…   15760     [OK]       
mysql/mysql-server     Optimized MySQL Server Docker images. Create…   1029                 [OK]
bitnami/mysql          Bitnami container image for MySQL               134                  [OK]
mysql/mysql-cluster    Experimental MySQL Cluster Docker images. Cr…   100                  
ubuntu/mysql           MySQL open source fast, stable, multi-thread…   67                   
linuxserver/mysql      A Mysql container, brought to you by LinuxSe…   42                   
circleci/mysql         MySQL is a widely used, open-source relation…   31                   
mysql/mysql-router     MySQL Router provides transparent routing be…   28                   
google/mysql           MySQL server for Google Compute Engine          25                   [OK]
alpine/mysql           mysql client                                    4                    
cimg/mysql                                                             3                    
mysql/mysql-operator   MySQL Operator for Kubernetes                   1                    
nasqueron/mysql                                                        1                    [OK]
elestio/mysql          Mysql, verified and packaged by Elestio         1                    
ddev/mysql             ARM64 base images for ddev-dbserver-mysql-8.…   1                    
ilios/mysql            Mysql configured for running Ilios              1                    [OK]
cbioportal/mysql       This repository hosts MySQL database images …   1                    
vitess/mysql           Lightweight image to run MySQL with Vitess      1                    
vulhub/mysql                                                           1                    
bitnamicharts/mysql    Bitnami Helm chart for MySQL                    0                    
corpusops/mysql        https://github.com/corpusops/docker-images/     0                    
mirantis/mysql                                                         0                    
docksal/mysql          MySQL service images for Docksal - https://d…   0                    
mysql/ndb-operator     MySQL NDB Operator for Kubernetes               0                    
openeuler/mysql                                                        0 
```
### 2.2  拉取MySQL镜像
MySQL版本不是用最新的就是最好的，要用你服务所需的最佳版本为好
```
docker pull mysql:8.3.0
```
执行结果
```
root@iStoreOS:/# docker pull mysql:8.3.0
8.3.0: Pulling from library/mysql
c6a0976a2dbe: Pull complete 
8dd4f8e415ca: Pull complete 
6e01a6ece3af: Pull complete 
6cfdeffd9140: Pull complete 
73fed55ee93c: Pull complete 
83404f4e4847: Pull complete 
aad53405df78: Pull complete 
d9c5f6f4cc6e: Pull complete 
e04d803ff9c7: Pull complete 
f06a309d43da: Pull complete 
Digest: sha256:9de9d54fecee6253130e65154b930978b1fcc336bcc86dfd06e89b72a2588ebe
Status: Downloaded newer image for mysql:8.3.0
```
2.3 查看MySQL镜像
```
docker images mysql:8.3.0
```
执行结果
[[Pasted image 20250501125837.png]]
```
root@iStoreOS:/# docker images mysql:8.3.0
REPOSITORY   TAG       IMAGE ID       CREATED         SIZE
mysql        8.3.0     9e24fab8e6af   13 months ago   638MB
```
## 三、在宿主机创建目录
---
3.1 创建挂载目录
后面用于挂载MySQL容器内的目录
```
mksir -p /home/mysql/{conf,data,log}
```
3.2 创建配置文件
```
cd /home/mysql/conf
vim my.cnf
```
按键盘==i==键或者==install==键进行输入
```
[client]
#设置客户端默认字符集utf8mb4
default-character-set=utf8mb4
[mysql]
#设置服务器默认字符集为utf8mb4
default-character-set=utf8mb4
[mysqld]
#配置服务器的服务号，具备日后需要集群做准备
server-id = 1
#开启MySQL数据库的二进制日志，用于记录用户对数据库的操作SQL语句，具备日后需要集群做准备
log-bin=mysql-bin
#设置清理超过30天的日志，以免日志堆积造过多成服务器内存爆满。2592000秒等于30天的秒数
binlog_expire_logs_seconds = 2592000
#解决MySQL8.0版本GROUP BY问题
sql_mode='STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'
#允许最大的连接数
max_connections=1000
# 禁用符号链接以防止各种安全风险
symbolic-links=0
# 设置东八区时区
default-time_zone = '+8:00'
```
按键盘esc键退出输入，然后输入:wq!回车保存退出
## 四、启动MySQL容器
---
`-p` 表示端口映射
`--restart=always`表示容器退出时总是重启
`--name`表示容器命名
`--privileged=true`表示赋予容器权限修改属猪文件权利
`-v /home/mysql/log:/var/log/mysql`表示容器日志挂载到宿主机的位置
`-v /home/mysql/data:/var/data/mysql`表示容器存储文件挂载到宿主机的位置
`-v /home/mysql/conf:/var/conf/mysql`表示容器配置文件挂载到宿主机的位置
`-e MYSQL_ROOT_PASSWORD= *********`表示设置MySQL的root用户的密码为 `*********` ，建议使用强密码
`-d`表示后台运行
```
docker run \
-p 3306:3306 \
--restart=always \
--name mysql \
--privileged=true \
-v /home/mysql/log:/var/log/mysql \
-v /home/mysql/data:/var/lib/mysql \
-v /home/mysql/conf/my.cnf:/etc/mysql/my.cnf \
-e MYSQL_ROOT_PASSWORD=******** \
-d mysql:8.3.0  
```
运行结果
```
root@iStoreOS:/# docker run \
> -p 3306:3306 \
> --restart=always \
> --name mysql \
> --privileged=true \
> -v /home/mysql/log:/var/log/mysql \
> -v /home/mysql/data:/var/lib/mysql \
> -v /home/mysql/conf/my.cnf:/etc/mysql/my.cnf \
> -e MYSQL_ROOT_PASSWORD=******** \
> -d mysql:8.3.0  
5f31ceabef114274ad76353e11a0e82cb9ae18b4d832ab1ca4dd959359807216
```
## 五、测试
---
使用Navicat进行连接测试