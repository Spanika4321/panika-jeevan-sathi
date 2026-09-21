'use strict';

/**
 * SP SAARTHI - Main Entry Point
 * Part 1 - Core System
 */

const { saarthi } = require('./src/master/saarthi');
const { taskEngine } = require('./src/engine/task-engine');
const { safeMode } = require('./src/engine/safe-mode');
const { bus } = require('./src/engine/communication');
const { rakshak } = require('./src/agents/rakshak');
const { niyojak } = require('./src/agents/niyojak');
const { samanvayak } = require('./src/agents/samanvayak');
const { vikas } = require('./src/agents/vikas');
const { Logger } = require('./src/engine/logger');

module.exports = {
  saarthi,
  taskEngine,
  safeMode,
  bus,
  rakshak,
  niyojak,
  samanvayak,
  vikas,
  Logger,
  version: '1.0.0-PART1'
};

// If run directly, start dashboard server
if (require.main === module) {
  const { start } = require('./src/api/server');
  start();
}
