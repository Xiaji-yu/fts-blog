'use strict';
/**
 * FTS-BLOG entry point: initialize the database, then serve the app.
 * The Express application itself lives in app.js (importable by tests).
 */
const app = require('./app');
const config = require('./config/loader');
const { initDatabase } = require('./database/init');

const PORT = process.env.PORT || config.server.port;

// Never let an unhandled promise rejection silently kill the process.
process.on('unhandledRejection', (reason) => {
  console.error(new Date().toISOString(), '[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error(new Date().toISOString(), '[uncaughtException]', err);
  console.error(err.stack);
  process.exit(1);
});

async function start() {
  try {
    await initDatabase();
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║  ${config.author.project}    ║
║  Engineering Blueprint Aesthetic          ║
╠═══════════════════════════════════════════╣
║  Server running on ${config.server.publicUrl}   ║
║                                           ║
║  Public:   ${config.server.publicUrl}          ║
║  Admin:    ${config.server.adminUrl}     ║
║  API:      ${config.server.apiUrl}       ║
╚═══════════════════════════════════════════╝
    `);
  });
}

start();

module.exports = app;
