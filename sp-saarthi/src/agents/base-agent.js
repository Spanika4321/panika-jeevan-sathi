'use strict';

const { Logger } = require('../engine/logger');
const { bus } = require('../engine/communication');

class BaseAgent {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.logger = new Logger(name);
    this.status = 'IDLE'; // IDLE, BUSY, ERROR
    this.currentTask = null;
    this.stats = {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalTime: 0
    };
    // Auto register to bus
    bus.registerAgent(name, this);
  }

  onMessage(message) {
    // To be overridden
    this.logger.debug(`Received message: ${message.type} from ${message.from}`, { taskId: message.taskId });
  }

  setStatus(newStatus, taskId = null) {
    this.status = newStatus;
    if (taskId) this.currentTask = taskId;
    if (newStatus === 'IDLE') this.currentTask = null;
    bus.send(this.name, 'ALL', 'AGENT_STATUS', { agent: this.name, status: newStatus, taskId });
    this.logger.info(`Status: ${newStatus}`, { taskId });
  }

  log(level, msg, meta = {}) {
    if (typeof this.logger[level.toLowerCase()] === 'function') {
      this.logger[level.toLowerCase()](msg, meta);
    } else {
      this.logger.info(msg, meta);
    }
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      status: this.status,
      currentTask: this.currentTask,
      stats: this.stats
    };
  }

  // To be implemented by child agents
  async execute(task) {
    throw new Error(`${this.name}: execute() not implemented`);
  }
}

module.exports = { BaseAgent };
