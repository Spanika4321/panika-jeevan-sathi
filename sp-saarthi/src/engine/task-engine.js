'use strict';

const { Task, TASK_STATUS } = require('./task');
const { Logger } = require('./logger');
const { safeMode } = require('./safe-mode');
const { bus } = require('./communication');

const logger = new Logger('TASK-ENGINE');

class TaskEngine {
  constructor() {
    this.tasks = new Map(); // task_id -> Task
    this.queue = []; // pending task ids
    this.active = new Map(); // running task_id -> promise
    this.maxConcurrent = 3;
  }

  createTask(command, options = {}) {
    const task = new Task(command, {
      ...options,
      safe_mode: options.safe_mode !== undefined ? options.safe_mode : safeMode.isEnabled()
    });
    this.tasks.set(task.task_id, task);
    this.queue.push(task.task_id);
    task.addLog('INFO', `Task created: ${task.task_id}`, { command });
    logger.info(`Task created: ${task.task_id}`, { command: command.slice(0, 100) });
    bus.send('TASK_ENGINE', 'ALL', 'TASK_CREATED', { taskId: task.task_id, command }, task.task_id);
    return task;
  }

  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  getAllTasks(limit = 50) {
    const all = Array.from(this.tasks.values())
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
    return all.map(t => t.toJSON());
  }

  getTasksByStatus(status) {
    return Array.from(this.tasks.values()).filter(t => t.status === status).map(t => t.toJSON());
  }

  updateTask(taskId, updates) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    Object.assign(task, updates);
    task.updated_at = new Date().toISOString();
    return task;
  }

  async cancelTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if ([TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED].includes(task.status)) {
      throw new Error(`Task already finished: ${task.status}`);
    }
    task.updateStatus(TASK_STATUS.CANCELLED);
    task.addLog('WARN', 'Task cancelled by user');
    // Remove from queue if pending
    this.queue = this.queue.filter(id => id !== taskId);
    bus.send('TASK_ENGINE', 'ALL', 'TASK_CANCELLED', { taskId }, taskId);
    logger.warn(`Task cancelled: ${taskId}`);
    return task;
  }

  // For Samanvayak to pick next task
  getNextPending() {
    while (this.queue.length > 0) {
      const taskId = this.queue.shift();
      const task = this.getTask(taskId);
      if (task && task.status === TASK_STATUS.PENDING) return task;
    }
    return null;
  }

  setResult(taskId, result) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    task.setResult(result);
    if (result && result.success !== false) {
      if (task.status !== TASK_STATUS.COMPLETED) task.updateStatus(TASK_STATUS.COMPLETED);
    } else {
      task.updateStatus(TASK_STATUS.FAILED);
    }
    bus.send('TASK_ENGINE', 'ALL', 'TASK_COMPLETED', { taskId, result }, taskId);
    logger.info(`Task result set: ${taskId}`, { success: result?.success });
    return task;
  }

  getStats() {
    const all = Array.from(this.tasks.values());
    const byStatus = {};
    Object.values(TASK_STATUS).forEach(s => {
      byStatus[s] = all.filter(t => t.status === s).length;
    });
    return {
      total: all.length,
      byStatus,
      queueLength: this.queue.length,
      active: this.active.size,
      safeMode: safeMode.getStatus()
    };
  }

  clearCompleted() {
    let count = 0;
    for (const [id, task] of this.tasks) {
      if ([TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED].includes(task.status)) {
        this.tasks.delete(id);
        count++;
      }
    }
    logger.info(`Cleared ${count} completed tasks`);
    return count;
  }

  // Persistence (simple JSON file)
  saveToFile(filePath) {
    try {
      const fs = require('fs');
      const data = {
        tasks: Array.from(this.tasks.values()).map(t => t.toFullJSON()),
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (e) {
      logger.error(`Failed to save tasks: ${e.message}`);
      return false;
    }
  }

  loadFromFile(filePath) {
    try {
      const fs = require('fs');
      if (!fs.existsSync(filePath)) return false;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const tData of data.tasks || []) {
        const task = new Task(tData.command, tData);
        this.tasks.set(task.task_id, task);
        if (task.status === TASK_STATUS.PENDING) this.queue.push(task.task_id);
      }
      logger.info(`Loaded ${data.tasks?.length || 0} tasks from file`);
      return true;
    } catch (e) {
      logger.error(`Failed to load tasks: ${e.message}`);
      return false;
    }
  }
}

// Singleton
const taskEngine = new TaskEngine();

module.exports = { TaskEngine, taskEngine, TASK_STATUS };
