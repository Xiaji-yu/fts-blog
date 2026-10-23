// PM2 production configuration
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      // deploy.sh can override this (APP_NAME=...), so the PM2 process name
      // always matches the one the update script reloads.
      name: process.env.APP_NAME || 'blog',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Trust 1 reverse-proxy hop so rate limits are keyed per real client.
        TRUST_PROXY: '1'
        // SESSION_SECRET: 'set-a-long-random-string-here'
      },
      max_memory_restart: '256M',
      time: true
    }
  ]
};
