'use strict';

const { BaseAgent } = require('./base-agent');
const { PERMISSION_LEVELS } = require('../engine/task');
const { safeMode } = require('../engine/safe-mode');

/**
 * SP RAKSHAK — Guardian Agent
 * Checks every action before execution
 * Permission levels: READ, WRITE, DESTRUCTIVE
 * DESTRUCTIVE must never execute automatically
 */
class Rakshak extends BaseAgent {
  constructor() {
    super('SP_RAKSHAK', 'Guardian - Checks every action before execution');
    this.blockedCount = 0;
    this.allowedCount = 0;
    this.auditLog = [];
  }

  onMessage(msg) {
    super.onMessage(msg);
    if (msg.type === 'GUARD_CHECK') {
      const result = this.checkPermission(msg.payload.action, msg.payload.permission, msg.payload.context);
      const { bus } = require('../engine/communication');
      bus.respond(msg, this.name, result);
    }
  }

  // Main permission check
  checkPermission(action, permission = PERMISSION_LEVELS.READ, context = {}) {
    const taskId = context.taskId || 'unknown';
    const check = {
      id: `check_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      action,
      permission,
      context,
      taskId,
      safeMode: safeMode.isEnabled()
    };

    // First check safe mode
    const safeCheck = safeMode.check(action, permission);
    if (!safeCheck.allowed) {
      check.allowed = false;
      check.reason = safeCheck.reason;
      check.level = 'BLOCKED_SAFE_MODE';
      this.blockedCount++;
      this.auditLog.push(check);
      this.logger.warn(`BLOCKED [${permission}]: ${action} | Reason: ${check.reason}`, { taskId });
      return check;
    }

    // Permission level logic
    switch (permission) {
      case PERMISSION_LEVELS.READ:
        check.allowed = true;
        check.reason = 'READ allowed - safe operation';
        check.level = 'ALLOWED';
        this.allowedCount++;
        break;

      case PERMISSION_LEVELS.WRITE:
        // WRITE allowed in safe mode, but logged
        if (safeMode.isEnabled()) {
          // Check if it's writing to sensitive areas
          if (this.isSensitiveWrite(action)) {
            check.allowed = false;
            check.reason = 'WRITE to sensitive area blocked in Safe Mode';
            check.level = 'BLOCKED_SENSITIVE';
            this.blockedCount++;
            this.logger.warn(`BLOCKED sensitive WRITE: ${action}`, { taskId });
          } else {
            check.allowed = true;
            check.reason = 'WRITE allowed with caution - logged';
            check.level = 'ALLOWED_WITH_LOG';
            this.allowedCount++;
          }
        } else {
          check.allowed = true;
          check.reason = 'WRITE allowed (Safe Mode OFF)';
          check.level = 'ALLOWED';
          this.allowedCount++;
        }
        break;

      case PERMISSION_LEVELS.DESTRUCTIVE:
        // DESTRUCTIVE must NEVER execute automatically
        check.allowed = false;
        check.reason = 'DESTRUCTIVE actions must never execute automatically - requires manual approval';
        check.level = 'BLOCKED_DESTRUCTIVE';
        this.blockedCount++;
        this.logger.critical(`BLOCKED DESTRUCTIVE: ${action}`, { taskId });
        break;

      default:
        check.allowed = false;
        check.reason = `Unknown permission level: ${permission}`;
        check.level = 'BLOCKED_UNKNOWN';
        this.blockedCount++;
    }

    this.auditLog.push(check);
    if (this.auditLog.length > 500) this.auditLog = this.auditLog.slice(-500);

    this.logger.info(`${check.allowed ? 'ALLOWED' : 'BLOCKED'} [${permission}]: ${action}`, {
      taskId,
      level: check.level
    });

    return check;
  }

  isSensitiveWrite(action) {
    const sensitive = [
      'server.js',
      'lib/db.js',
      'lib/auth.js',
      '.env',
      'package.json',
      'supabase/',
      'storage/',
      'data/',
      'node_modules'
    ];
    const act = String(action).toLowerCase();
    return sensitive.some(s => act.includes(s.toLowerCase())) && act.includes('delete');
  }

  // Batch check for a plan
  checkPlan(plan, taskId) {
    const results = [];
    for (const step of plan.steps || []) {
      const permission = this.inferPermission(step.action || step.description || '');
      const res = this.checkPermission(step.action || step.description, permission, { taskId, step: step.id });
      results.push({ step: step.id, ...res });
    }
    return {
      taskId,
      total: results.length,
      allowed: results.filter(r => r.allowed).length,
      blocked: results.filter(r => !r.allowed).length,
      checks: results,
      safeMode: safeMode.isEnabled(),
      timestamp: new Date().toISOString()
    };
  }

  inferPermission(action) {
    const act = String(action).toLowerCase();
    if (act.match(/(delete|remove|drop|truncate|destroy|wipe|format|rm\s+-rf)/)) return PERMISSION_LEVELS.DESTRUCTIVE;
    if (act.match(/(write|create|update|modify|edit|save|insert)/)) return PERMISSION_LEVELS.WRITE;
    return PERMISSION_LEVELS.READ;
  }

  getAuditLog(limit = 100) {
    return this.auditLog.slice(-limit);
  }

  getStats() {
    return {
      ...this.getInfo(),
      allowedCount: this.allowedCount,
      blockedCount: this.blockedCount,
      auditLogSize: this.auditLog.length,
      safeMode: safeMode.getStatus()
    };
  }

  async execute(task) {
    this.setStatus('BUSY', task.task_id);
    try {
      task.addLog('INFO', 'SP Rakshak checking task permissions');
      const plan = task.plan;
      if (!plan) {
        const result = this.checkPermission(task.command, this.inferPermission(task.command), { taskId: task.task_id });
        task.permissions_checked = [result];
        task.addLog(result.allowed ? 'INFO' : 'WARN', `Rakshak check: ${result.reason}`, result);
        this.setStatus('IDLE');
        return result;
      }

      const batch = this.checkPlan(plan, task.task_id);
      task.permissions_checked = batch.checks;
      task.addLog('INFO', `Rakshak checked ${batch.total} steps: ${batch.allowed} allowed, ${batch.blocked} blocked`, batch);
      this.setStatus('IDLE');
      this.stats.tasksCompleted++;
      return batch;
    } catch (err) {
      this.setStatus('ERROR', task.task_id);
      this.stats.tasksFailed++;
      task.addLog('ERROR', `Rakshak error: ${err.message}`);
      throw err;
    }
  }
}

// Singleton
const rakshak = new Rakshak();

module.exports = { Rakshak, rakshak };
