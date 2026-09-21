'use strict';

const { BaseAgent } = require('./base-agent');
const { TASK_STATUS } = require('../engine/task');
const { taskEngine } = require('../engine/task-engine');
const { bus } = require('../engine/communication');

/**
 * SP SAMANVAYAK — Manager Agent
 * Manage execution and track status: PENDING, PLANNING, RUNNING, FAILED, VERIFYING, COMPLETED, CANCELLED
 */
class Samanvayak extends BaseAgent {
  constructor() {
    super('SP_SAMANVAYAK', 'Manager - Manages execution and tracks task status');
    this.runningTasks = new Map();
    this.completedTasks = 0;
  }

  onMessage(msg) {
    super.onMessage(msg);
    if (msg.type === 'TASK_CREATED') {
      this.logger.info(`New task queued: ${msg.payload.taskId}`);
    }
  }

  // Main orchestration of task execution
  async execute(task) {
    this.setStatus('BUSY', task.task_id);
    try {
      task.addLog('INFO', 'SP Samanvayak taking over execution management');
      task.updateStatus(TASK_STATUS.RUNNING);
      task.assignAgent(this.name);
      this.runningTasks.set(task.task_id, task);

      if (!task.plan || !task.plan.steps || task.plan.steps.length === 0) {
        throw new Error('No plan found for task execution');
      }

      this.logger.info(`Executing plan ${task.plan.plan_id} with ${task.plan.steps.length} steps`, { taskId: task.task_id });

      // Get worker agent
      const { vikas } = require('./vikas');
      const { rakshak } = require('./rakshak');

      const results = [];

      for (let i = 0; i < task.plan.steps.length; i++) {
        const step = task.plan.steps[i];
        task.current_step = i;
        task.addLog('INFO', `Starting step ${i + 1}/${task.plan.steps.length}: ${step.title}`, { stepId: step.id });

        // Rakshak check before each step
        const guardCheck = rakshak.checkPermission(step.action, step.permission, { taskId: task.task_id, step: step.id });
        if (!guardCheck.allowed) {
          task.addLog('WARN', `Step ${i + 1} blocked by Rakshak: ${guardCheck.reason}`, guardCheck);
          const blockedResult = {
            success: false,
            blocked: true,
            reason: guardCheck.reason,
            step: step.id,
            guardCheck
          };
          task.addStepResult(i, blockedResult);
          results.push(blockedResult);

          // If blocked is destructive, we don't fail whole task, we log and continue
          // But if it's critical, mark task as needing approval
          if (step.permission === 'DESTRUCTIVE') {
            task.addLog('WARN', `Destructive step ${step.id} requires manual approval - skipping`);
            continue;
          } else {
            // For non-destructive blocked, fail step but continue
            continue;
          }
        }

        // Execute step via Vikas
        try {
          bus.send(this.name, 'SP_VIKAS', 'EXECUTE_STEP', { step, taskId: task.task_id }, task.task_id);
          const stepResult = await vikas.executeStep(step, task);
          task.addStepResult(i, stepResult);
          results.push(stepResult);
          task.addLog(stepResult.success ? 'INFO' : 'WARN', `Step ${i + 1} ${stepResult.success ? 'completed' : 'failed'}: ${step.title}`, stepResult);

          if (!stepResult.success && stepResult.critical) {
            throw new Error(`Critical step failed: ${step.title} - ${stepResult.error || stepResult.message}`);
          }
        } catch (err) {
          const failResult = {
            success: false,
            error: err.message,
            step: step.id,
            title: step.title
          };
          task.addStepResult(i, failResult);
          results.push(failResult);
          task.addLog('ERROR', `Step ${i + 1} error: ${err.message}`, { stepId: step.id });

          // Decide if we should continue or fail fast
          if (task.plan.complexity === 'high' && i < 2) {
            // For high complexity, continue even if early steps fail
            continue;
          } else if (err.message.includes('Critical')) {
            throw err;
          }
        }

        // Small delay to avoid blocking
        await new Promise(r => setTimeout(r, 100));
      }

      // Verification phase
      task.updateStatus(TASK_STATUS.VERIFYING);
      task.addLog('INFO', 'Entering VERIFYING phase');

      const verification = await this.verifyExecution(task, results);
      task.addLog('INFO', `Verification: ${verification.success ? 'PASSED' : 'FAILED'}`, verification);

      if (!verification.success) {
        task.updateStatus(TASK_STATUS.FAILED);
        task.setResult({
          success: false,
          verification,
          steps: results,
          message: 'Task verification failed',
          summary: this.generateSummary(task, results, false)
        });
      } else {
        task.updateStatus(TASK_STATUS.COMPLETED);
        const finalResult = {
          success: true,
          steps: results,
          verification,
          totalSteps: task.plan.steps.length,
          completedSteps: results.filter(r => r.success).length,
          failedSteps: results.filter(r => !r.success).length,
          blockedSteps: results.filter(r => r.blocked).length,
          summary: this.generateSummary(task, results, true),
          report: this.generateReport(task, results)
        };
        task.setResult(finalResult);
      }

      this.runningTasks.delete(task.task_id);
      this.completedTasks++;
      this.setStatus('IDLE');
      bus.send(this.name, 'ALL', 'TASK_EXECUTED', { taskId: task.task_id, success: task.result.success }, task.task_id);

      return task.result;
    } catch (err) {
      this.setStatus('ERROR', task.task_id);
      this.runningTasks.delete(task.task_id);
      task.setError(err);
      this.logger.error(`Execution failed for ${task.task_id}: ${err.message}`, { stack: err.stack });
      throw err;
    }
  }

  async verifyExecution(task, results) {
    // Basic verification: at least 50% steps should succeed, no critical failures
    const total = results.length;
    const succeeded = results.filter(r => r.success).length;
    const failed = total - succeeded;
    const blocked = results.filter(r => r.blocked).length;

    // If task was inspection type, even partial success is ok
    const isInspection = task.plan && (task.plan.intent === 'inspection' || task.plan.intent === 'project_inspection' || task.plan.intent === 'memory_inspection');

    if (isInspection) {
      return {
        success: succeeded > 0,
        reason: succeeded > 0 ? 'Inspection completed with findings' : 'Inspection found no results',
        succeeded,
        failed,
        blocked,
        total
      };
    }

    const successRate = total > 0 ? succeeded / total : 0;
    return {
      success: successRate >= 0.5 || (succeeded > 0 && failed === 0),
      reason: successRate >= 0.5 ? `Success rate ${Math.round(successRate * 100)}% meets threshold` : `Success rate ${Math.round(successRate * 100)}% below threshold`,
      succeeded,
      failed,
      blocked,
      total,
      successRate
    };
  }

  generateSummary(task, results, success) {
    const succeeded = results.filter(r => r.success).length;
    return `${success ? '✅' : '❌'} Task "${task.command.slice(0, 60)}" ${success ? 'completed' : 'failed'}: ${succeeded}/${results.length} steps succeeded`;
  }

  generateReport(task, results) {
    const findings = results.filter(r => r.findings).flatMap(r => r.findings);
    const suggestions = results.filter(r => r.suggestions).flatMap(r => r.suggestions);
    const errors = results.filter(r => !r.success).map(r => r.error || r.message);

    return {
      taskId: task.task_id,
      command: task.command,
      intent: task.plan?.intent,
      executionTime: new Date() - new Date(task.created_at),
      stepsExecuted: results.length,
      findings: findings.slice(0, 20),
      suggestions: suggestions.slice(0, 20),
      errors: errors.slice(0, 10),
      generatedAt: new Date().toISOString()
    };
  }

  getRunningTasks() {
    return Array.from(this.runningTasks.values()).map(t => t.toJSON());
  }

  getStats() {
    return {
      ...this.getInfo(),
      runningCount: this.runningTasks.size,
      completedTasks: this.completedTasks,
      queueLength: taskEngine.queue.length
    };
  }
}

const samanvayak = new Samanvayak();

module.exports = { Samanvayak, samanvayak };
