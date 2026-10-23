#!/usr/bin/env bash
#
# 生产一键更新：拉代码 → 安装生产依赖 → 重启 → 健康检查。
# 任一步失败立即退出（set -e），PM2 里跑的仍是上一个可用版本。
#
# 用法（在仓库根目录）：
#   bash scripts/deploy.sh              # 自动识别 PM2 里的博客进程
#   APP_NAME=blog bash scripts/deploy.sh        # 手动指定 PM2 服务名
#   PORT=3000 bash scripts/deploy.sh            # 覆盖健康检查端口
#   HEALTH_URL=http://127.0.0.1:3000/healthz bash scripts/deploy.sh
#   ALLOW_DIRTY=1 bash scripts/deploy.sh        # 本地有未提交改动时也强制部署
#   SKIP_TESTS=1 bash scripts/deploy.sh         # 跳过测试直接上线
#
# 用运行 PM2 的普通用户执行，不要 sudo / root。
# 首次上线：见 README「生产环境（PM2）」一节。
set -euo pipefail

cd "$(dirname "$0")/.."
DEPLOY_DIR="$(pwd)"

if [ "$(id -u)" -eq 0 ]; then
  echo 'ERROR: 不要用 root / sudo 跑部署脚本。' >&2
  echo '      用运行 PM2 的普通用户执行：bash scripts/deploy.sh' >&2
  echo '      sudo 会把 node_modules/ 和 data/ 改成 root 属主，之后普通用户反而更新不了。' >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo 'ERROR: 找不到 pm2。先安装：npm i -g pm2' >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo 'ERROR: 找不到 node。' >&2
  exit 1
fi

APP_NAME="${APP_NAME:-}"

# 自动识别：优先匹配 pm_cwd / 脚本路径落在本仓库的 PM2 进程，
# 匹配不到再退回常见的服务名。输出「名称<TAB>端口」。
read_pm2_info() {
  pm2 jlist 2>/dev/null | DEPLOY_DIR="$DEPLOY_DIR" node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      try {
        const apps = JSON.parse(raw);
        const dir = process.env.DEPLOY_DIR;
        const inRepo = apps.filter((app) => {
          const cwd = app.pm2_env?.pm_cwd || "";
          const script = app.pm2_env?.pm_exec_path || "";
          return (
            (dir && (cwd === dir || cwd.startsWith(dir + "/"))) ||
            (dir && script.startsWith(dir + "/"))
          );
        });
        const known = apps.filter((app) =>
          ["blog", "fts-blog", "ftsblog"].includes(app.name),
        );
        const pool = inRepo.length ? inRepo : known;
        const app =
          pool.find((item) => item.pm2_env?.status === "online") ?? pool[0];
        if (app) {
          const port = app.pm2_env?.env?.PORT ?? app.pm2_env?.PORT ?? "";
          process.stdout.write(app.name + "\t" + port);
        }
      } catch {
        /* jlist 输出不是 JSON 时交给下面的默认值兜底 */
      }
    });
  '
}

PM2_INFO="$(read_pm2_info || true)"
PM2_PORT=""
if [ -n "$PM2_INFO" ]; then
  PM2_NAME="${PM2_INFO%%$'\t'*}"
  PM2_PORT="${PM2_INFO#*$'\t'}"
  if [ "$PM2_PORT" = "$PM2_INFO" ]; then
    PM2_PORT=""
  fi
  APP_NAME="${APP_NAME:-$PM2_NAME}"
fi
APP_NAME="${APP_NAME:-blog}"

# 端口优先级：显式 PORT > PM2 实际 env.PORT > config.json > 3000
PORT="${PORT:-$PM2_PORT}"
if [ -z "$PORT" ]; then
  PORT="$(node -e 'try { process.stdout.write(String(require("./config/loader").server.port || 3000)); } catch (e) { process.stdout.write("3000"); }' 2>/dev/null || echo 3000)"
fi
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/healthz}"

export APP_NAME

echo "==> 运行用户：$(id -un) · 应用名：${APP_NAME}（可用 APP_NAME=... 覆盖）"
echo "==> 健康检查：${HEALTH_URL}（可用 PORT=... 或 HEALTH_URL=... 覆盖）"

pm2_name_hint() {
  {
    echo
    echo '当前 PM2 进程列表（确认 NAME 列）：'
    pm2 ls --no-color 2>/dev/null || true
    echo
    echo '用真实服务名重跑：'
    echo '  APP_NAME=<pm2 ls 里的名字> bash scripts/deploy.sh'
    echo
    echo '或者手动重启：'
    echo '  pm2 restart <pm2 ls 里的名字> --update-env'
  } >&2
}

echo '==> git pull --ff-only'
if [ -n "$(git status --porcelain --untracked-files=no)" ] && [ "${ALLOW_DIRTY:-0}" != "1" ]; then
  echo 'ERROR: 工作区有未提交的改动。先 commit/stash，或 ALLOW_DIRTY=1 强制部署。' >&2
  git status --short >&2
  exit 1
fi
git pull --ff-only

# config.json / data/ / uploads/ 都被 gitignore，不会出现在工作区检查里；
# 但首次部署必须有 config.json（可从 config.example.json 复制）。
if [ ! -f config.json ]; then
  echo 'WARN: 没找到 config.json，将使用内置默认配置。' >&2
  echo '      需要个性化设置时：cp config.example.json config.json 后修改。' >&2
fi

echo '==> npm ci --omit=dev（锁文件严格安装，不装开发依赖）'
npm ci --omit=dev

if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo '==> 跳过测试（SKIP_TESTS=1）'
else
  echo '==> 测试'
  npm test
fi

if ! pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  # 端口已被占、但 PM2 里没有这个名字：别再起一个抢端口，
  # 先让用户核对服务名 / 占用者。
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":${PORT}$"; then
    echo "ERROR: PM2 里没有「${APP_NAME}」，但端口 ${PORT} 已被占用。" >&2
    echo "先确认占用者：ss -ltnp | grep :${PORT}" >&2
    pm2_name_hint
    exit 1
  fi
  echo "==> 首次启动：pm2 start ecosystem.config.js（应用名 ${APP_NAME}，端口 ${PORT}）"
  PORT="${PORT}" pm2 start ecosystem.config.js --update-env
  pm2 save
else
  echo "==> pm2 reload ${APP_NAME}（最多等 10 秒）"
  if ! timeout 10s pm2 reload "${APP_NAME}" --update-env; then
    echo "ERROR: pm2 reload ${APP_NAME} 超过 10 秒没有完成。" >&2
    echo '多半是服务名不对（核对 pm2 ls 的 NAME 列）。' >&2
    pm2_name_hint
    exit 1
  fi
fi

echo "==> 健康检查 ${HEALTH_URL}"
ok=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 3 "${HEALTH_URL}" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 0.5
done
if [ "${ok}" != "1" ]; then
  echo "ERROR: 健康检查失败，最近 30 行日志：" >&2
  pm2 logs "${APP_NAME}" --lines 30 --nostream >&2 || true
  exit 1
fi

echo "==> 完成：$(pm2 describe "${APP_NAME}" | grep -E 'status|script path' | head -2)"
