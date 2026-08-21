---
date: 2026-05-28T12:00:00
aliases: [Linux Commands, Shell Tricks]
tags: [linux, sysadmin, terminal, cheat-sheet]
cssclasses: compact-table
---

# 🐧 Linux 高级命令大全 (100条)

> **适用场景：** 运维、开发、DevOps、系统管理
> **整理时间：** 2026-01-01
> **状态：** 🟢 已验证可用

---

## 📂 一、文件与目录操作 (1-20)

### 基础与查找
1.  **`find /path -name "*.log" -mtime +7 -delete`**  
    查找 7 天前的 log 文件并删除（清理日志神器）。
2.  **`locate filename`**  
    快速查找文件（基于数据库，比 find 快）。
3.  **`updatedb`**  
    更新 locate 命令的数据库。
4.  **`tree -L 2`**  
    以树状结构显示目录，`-L` 限制层级。
5.  **`du -sh /path`**  
    查看目录总大小（`-s` 汇总，`-h` 人类可读）。
6.  **`du -h --max-depth=1 /path`**  
    查看当前目录下各子目录的大小。
7.  **`stat filename`**  
    显示文件的详细状态信息（访问/修改/改变时间）。
8.  **`ln -s /path/to/target link_name`**  
    创建软链接（符号链接）。
9.  **`chmod 755 script.sh`**  
    修改文件权限（r=4, w=2, x=1）。
10. **`chown user:group file`**  
    修改文件所有者和所属组。

### 高级操作
11. **`rsync -avz /source/ /destination/`**  
    远程同步/备份文件（`-a` 归档，`-v` 详细，`-z` 压缩）。
12. **`rsync -avz --delete /source/ /dest/`**  
    镜像同步（删除目标端多余的文件）。
13. **`scp -P 2222 file user@host:/path`**  
    远程安全拷贝（指定端口）。
14. **`sftp user@host`**  
    交互式文件传输。
15. **`split -b 100M largefile.txt chunk_`**  
    将大文件分割为 100M 的小文件。
16. **`cat chunk_* > largefile.txt`**  
    合并文件。
17. **`touch -t 202301010000 filename`**  
    手动修改文件时间戳。
18. **`file filename`**  
    确定文件类型（二进制、文本、压缩包等）。
19. **`diff -u file1 file2`**  
    显示文件差异（统一格式，适合生成补丁）。
20. **`vimdiff file1 file2`**  
    在 Vim 中并排对比文件。

---

## ✂️ 二、文本处理与流编辑 (21-40)

### 核心三剑客
21. **`grep -r "pattern" /path`**  
    递归搜索文本内容。
22. **`grep -E "pattern1|pattern2" file`**  
    使用扩展正则表达式（或 `egrep`）。
23. **`grep -v "pattern" file`**  
    反向匹配（排除包含该模式的行）。
24. **`awk '{print $1}' file`**  
    打印第一列（默认空格分隔）。
25. **`awk -F':' '{print $1, $7}' /etc/passwd`**  
    指定分隔符为冒号，打印用户名和 shell。
26. **`sed 's/old/new/g' file`**  
    替换文本（全局替换）。
27. **`sed -i 's/old/new/g' file`**  
    **就地修改**文件（慎用，备份原文件）。
28. **`sed -n '5,10p' file`**  
    打印第 5 到 10 行。
29. **`sort -u file`**  
    排序并去重。
30. **`sort -k 2 -nr file`**  
    按第 2 列数值逆序排序。

### 辅助工具
31. **`cut -d',' -f1,3 file.csv`**  
    按逗号分隔，提取第 1 和第 3 列。
32. **`paste file1 file2`**  
    将文件按行合并（横向拼接）。
33. **`tr 'a-z' 'A-Z' < file`**  
    将小写转换为大写。
34. **`tr -d '\r' < dosfile > unixfile`**  
    删除回车符（DOS 转 Unix 格式）。
35. **`wc -l file`**  
    统计行数。
36. **`wc -c file`**  
    统计字节数。
37. **`uniq -c file`**  
    统计相邻重复行的次数。
38. **`column -t -s',' data.txt`**  
    将分隔符文件格式化为表格。
39. **`rev file`**  
    反转每行字符。
40. **`tac file`**  
    反向打印文件内容（倒序）。

---

## 📊 三、系统监控与性能 (41-60)

### 资源查看
41. **`htop`**  
    交互式进程查看器（比 top 更友好，需安装）。
42. **`free -h`**  
    查看内存使用情况（人类可读单位）。
43. **`df -h`**  
    查看磁盘空间。
44. **`iostat -x 1`**  
    查看磁盘 I/O 统计（需安装 `sysstat`）。
45. **`vmstat 1`**  
    查看虚拟内存、进程、CPU 活动。
46. **`sar -u 1 5`**  
    查看 CPU 使用率（1秒一次，共5次）。
47. **`uptime`**  
    查看系统运行时间及平均负载。
48. **`lscpu`**  
    查看 CPU 架构信息。
49. **`lsblk`**  
    列出所有块设备（磁盘分区）。
50. **`lsof /path/to/file`**  
    查看哪个进程打开了某个文件。

### 进程管理
51. **`ps aux --sort=-%mem`**  
    按内存使用率降序排列进程。
52. **`ps aux | grep process_name`**  
    查找特定进程。
53. **`kill -9 PID`**  
    强制终止进程（SIGKILL）。
54. **`kill -15 PID`**  
    正常终止进程（SIGTERM，建议优先使用）。
55. **`killall process_name`**  
    杀死所有同名进程。
56. **`pkill pattern`**  
    按模式匹配杀死进程。
57. **`nice -n 10 command`**  
    以指定优先级（10）运行命令。
58. **`renice 5 PID`**  
    修改正在运行进程的优先级。
59. **`nohup command &`**  
    后台运行命令，忽略挂断信号（退出终端仍运行）。
60. **`jobs`**  
    查看当前终端的后台任务。
61. **`fg %1`**  
    将后台任务 1 调回前台。

---

## 🌐 四、网络诊断与安全 (61-80)

### 连接与测试
62. **`ip addr show`** (或 `ip a`)  
    查看 IP 地址（替代老旧的 `ifconfig`）。
63. **`ip route show`**  
    查看路由表。
64. **`ss -tulnp`**  
    查看网络连接（比 `netstat` 更快，`-p` 显示进程）。
65. **`netstat -tulnp`**  
    查看监听端口及对应进程。
66. **`dig example.com`**  
    DNS 查询工具（比 nslookup 强大）。
67. **`nslookup example.com`**  
    查询域名解析。
68. **`traceroute example.com`**  
    跟踪数据包路径。
69. **`mtr example.com`**  
    结合了 ping 和 traceroute 的功能。
70. **`curl -I http://example.com`**  
    仅获取 HTTP 头部信息。

### 高级网络
71. **`curl -o filename.zip http://url`**  
    下载文件并重命名。
72. **`wget -c http://url`**  
    断点续传下载。
73. **`nc -zv host port`**  
    端口扫描/连通性测试（Netcat）。
74. **`tcpdump -i eth0 port 80`**  
    抓取 80 端口的数据包（需 root）。
75. **`iptables -L -n`**  
    列出防火墙规则。
76. **`ufw status`**  
    查看 UFW 防火墙状态（Ubuntu）。
77. **`ssh -L 8080:localhost:80 user@host`**  
    本地端口转发（隧道）。
78. **`ssh -D 1080 user@host`**  
    动态端口转发（SOCKS 代理）。
79. **`openssl s_client -connect example.com:443`**  
    测试 SSL/TLS 连接。
80. **`whois example.com`**  
    查询域名注册信息。

---

## ⚙️ 五、Shell 高级技巧与自动化 (81-100)

### Shell 脚本与变量
81. **`$(command)`**  
    命令替换（将命令输出赋值给变量）。
82. **`${var:-default}`**  
    变量默认值（如果 var 未设置，则使用 default）。
83. **`!!`**  
    重复执行上一条命令。
84. **`!$`**  
    引用上一条命令的最后一个参数。
85. **`^old^new`**  
    快速修正上一条命令的拼写错误。
86. **`alias ll='ls -alF'`**  
    创建别名。
87. **`unalias ll`**  
    删除别名。
88. **`history | grep keyword`**  
    在历史命令中搜索。
89. **`source ~/.bashrc`**  
    重新加载配置文件（不重启终端生效）。
90. **`set -x`**  
    在脚本中开启调试模式（打印执行的命令）。

### 压缩与归档
91. **`tar -czvf archive.tar.gz /path`**  
    打包并 gzip 压缩。
92. **`tar -xzvf archive.tar.gz`**  
    解压 gzip 包。
93. **`tar -cjvf archive.tar.bz2 /path`**  
    打包并 bzip2 压缩（压缩率更高）。
94. **`tar -xjvf archive.tar.bz2`**  
    解压 bzip2 包。
95. **`zip -r archive.zip /path`**  
    创建 zip 压缩包。
96. **`unzip archive.zip`**  
    解压 zip 包。

### 其他实用工具
97. **`watch -n 1 'df -h'`**  
    每隔 1 秒执行一次 df -h 命令。
98. **`timeout 10 command`**  
    运行命令，10 秒后若未结束则强制终止。
99. **`bc`**  
    命令行计算器（支持浮点运算）。
100. **`xargs`**  
    从标准输入构建并执行命令行（常与 find/grep 配合）。
     > **示例：** `echo "file1 file2" | xargs rm`

---

> 💡 **提示：** 熟练掌握 `man` 命令是学习这些工具的最好方式。例如：`man grep`。