const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

let config;

try {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  config = JSON.parse(raw);
} catch (err) {
  console.error('FATAL: Cannot read config.json at', CONFIG_PATH);
  console.error('  Copy config.example.json to config.json and edit it.');
  console.error('  Detail:', err.message);
  process.exit(1);
}

module.exports = config;
