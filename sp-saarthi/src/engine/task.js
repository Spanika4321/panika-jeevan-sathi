'use strict';

const crypto = require('crypto');

const TASK_STATUS = {
  PENDING: 'PENDING',
  PLANNING: 'PLANNING',
  RUNNING: 'RUNNING',
  FAILED: 'FAILED',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
};

const PERMISSION_LEVELS = {
  READ: 'READ',
  WRITE: 'WRITE',
  DESTRUCTIVE: 'DESTRUCTIVE'
};

class Task {
  constructor(command, options = {}) {
    this.task_id = options.task_id || this.generateId();
    this.command = command;
    this.original_command = command;
    this.plan = options.plan || null;
    this.assigned_agent = options.assigned_agent || null;
    this.status = options.status || TASK_STATUS.PENDING;
    this.logs = options.logs || [];
    this.result = options.result || null;
    this.created_at = options.created_at || new Date().toISOString();
    this.updated_at = options.updated_at || new Date().toISOString();
    this.steps = options.steps || [];
    this.current_step = options.current_step || 0;
    this.permissions_checked = options.permissions_checked || [];
    this.safe_mode = options.safe_mode !== undefined ? options.safe_mode : true;
    this.metadata = options.metadata || {};
    this.error = null;
  }

  generateId() {
    return `task_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  updateStatus(newStatus) {
    if (!Object.values(TASK_STATUS).includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }
    const old = this.status;
    this.status = newStatus;
    this.updated_at = new Date().toISOString();
    this.addLog('INFO', `Status changed: ${old} -> ${newStatus}`);
    return this;
  }

  setPlan(plan) {
    this.plan = plan;
    this.steps = plan.steps || [];
    this.updated_at = new Date().toISOString();
    this.addLog('INFO', `Plan set with ${this.steps.length} steps`, { planId: plan.plan_id });
    return this;
  }

  assignAgent(agentName) {
    this.assigned_agent = agentName;
    this.updated_at = new Date().toISOString();
    this.addLog('INFO', `Assigned to agent: ${agentName}`);
    return this;
  }

  addLog(level, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      meta
    };
    this.logs.push(entry);
    this.updated_at = new Date().toISOString();
    // Keep only last 500 logs to avoid memory bloat
    if (this.logs.length > 500) this.logs = this.logs.slice(-500);
    return entry;
  }

  addStepResult(stepIndex, result) {
    if (this.steps[stepIndex]) {
      this.steps[stepIndex].result = result;
      this.steps[stepIndex].status = result.success ? 'COMPLETED' : 'FAILED';
      this.steps[stepIndex].completed_at = new Date().toISOString();
    }
    this.addLog('INFO', `Step ${stepIndex + 1} completed`, { success: result.success });
    return this;
  }

  nextStep() {
    this.current_step += 1;
    this.updated_at = new Date().toISOString();
    return this.current_step < this.steps.length ? this.steps[this.current_step] : null;
  }

  setResult(result) {
    this.result = result;
    this.updated_at = new Date().toISOString();
    return this;
  }

  setError(err) {
    this.error = {
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    };
    this.addLog('ERROR', err.message, { stack: err.stack });
    this.updateStatus(TASK_STATUS.FAILED);
    return this;
  }

  toJSON() {
    return {
      task_id: this.task_id,
      command: this.command,
      plan: this.plan,
      assigned_agent: this.assigned_agent,
      status: this.status,
      logs: this.logs.slice(-50), // only last 50 for API
      result: this.result,
      created_at: this.created_at,
      updated_at: this.updated_at,
      steps: this.steps,
      current_step: this.current_step,
      metadata: this.metadata,
      error: this.error
    };
  }

  toFullJSON() {
    return {
      task_id: this.task_id,
      command: this.command,
      original_command: this.original_command,
      plan: this.plan,
      assigned_agent: this.assigned_agent,
      status: this.status,
      logs: this.logs,
      result: this.result,
      created_at: this.created_at,
      updated_at: this.updated_at,
      steps: this.steps,
      current_step: this.current_step,
      permissions_checked: this.permissions_checked,
      safe_mode: this.safe_mode,
      metadata: this.metadata,
      error: this.error
    };
  }
}

module.exports = { Task, TASK_STATUS, PERMISSION_LEVELS };
