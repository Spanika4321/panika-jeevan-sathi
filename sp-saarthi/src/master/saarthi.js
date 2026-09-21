'use strict';

const { Logger } = require('../engine/logger');
const { taskEngine, TASK_STATUS } = require('../engine/task-engine');
const { safeMode } = require('../engine/safe-mode');
const { bus } = require('../engine/communication');
const { rakshak } = require('../agents/rakshak');
const { niyojak } = require('../agents/niyojak');
const { samanvayak } = require('../agents/samanvayak');
const { vikas } = require('../agents/vikas');

/**
 * SP SAARTHI — Master Agent
 * Responsibilities:
 * - receive user command
 * - understand the request
 * - create task
 * - send task to Planner
 * - receive plan
 * - send plan to Manager
 * - collect worker results
 * - return final report
 */
class Saarthi {
  constructor() {
    this.name = 'SP_SAARTHI';
    this.description = 'Master Agent - Central orchestrator';
    this.logger = new Logger('SP_SAARTHI');
    this.status = 'IDLE';
    this.tasksProcessed = 0;
    this.version = '1.0.0 - PART 1';

    // Register self to bus
    bus.registerAgent(this.name, this);

    this.logger.info(`SP Saarthi initialized v${this.version}, Safe Mode: ${safeMode.isEnabled() ? 'ON' : 'OFF'}`);
  }

  onMessage(msg) {
    this.logger.debug(`Received: ${msg.type} from ${msg.from}`, { taskId: msg.taskId });
  }

  // Understand user request (simple NLP / intent detection)
  understandRequest(command) {
    const lower = command.toLowerCase();
    let intent = 'general';
    let urgency = 'normal';
    let domain = 'general';

    if (lower.match(/memory|leak|ram|heap/)) { intent = 'memory_inspection'; domain = 'performance'; urgency = 'high'; }
    else if (lower.match(/inspect|check|audit|what.*wrong|kya.*galat|tell me what is wrong/)) { intent = 'inspection'; domain = 'analysis'; }
    else if (lower.match(/talkora|panika.*project/)) { intent = 'project_inspection'; domain = 'analysis'; }
    else if (lower.match(/bug|fix|error|issue|problem/)) { intent = 'bug_fix'; domain = 'development'; urgency = 'high'; }
    else if (lower.match(/test|verify/)) { intent = 'testing'; domain = 'qa'; }
    else if (lower.match(/security|credential|safe/)) { intent = 'security_audit'; domain = 'security'; urgency = 'high'; }
    else if (lower.match(/deploy|production/)) { intent = 'deployment'; domain = 'ops'; urgency = 'high'; }

    // Extract entities
    const entities = {
      project: lower.includes('talkora') ? 'TalkoraA' : lower.includes('panika') ? 'Panika Jeevan Sathi' : 'general',
      hasMemoryKeyword: lower.includes('memory'),
      isInspection: intent.includes('inspection')
    };

    return { intent, urgency, domain, entities, original: command };
  }

  // Main entry point: receive user command
  async receiveCommand(command, options = {}) {
    const startTime = Date.now();
    this.status = 'BUSY';
    this.logger.info(`Received user command: ${command.slice(0, 200)}`);

    try {
      // 1. Understand request
      const understanding = this.understandRequest(command);
      this.logger.info(`Understood: intent=${understanding.intent}, domain=${understanding.domain}`, understanding);

      // 2. Rakshak check for the command itself
      const guardCheck = rakshak.checkPermission(command, rakshak.inferPermission(command), { taskId: 'pre-check' });
      if (!guardCheck.allowed) {
        this.logger.warn(`Command blocked by Rakshak: ${guardCheck.reason}`);
        return {
          success: false,
          blocked: true,
          reason: guardCheck.reason,
          guardCheck,
          understanding,
          timestamp: new Date().toISOString()
        };
      }

      // 3. Create task
      const task = taskEngine.createTask(command, {
        safe_mode: safeMode.isEnabled(),
        metadata: { understanding, receivedAt: new Date().toISOString(), ...options.metadata }
      });
      task.addLog('INFO', `Saarthi understood request: intent=${understanding.intent}, domain=${understanding.domain}`);
      task.addLog('INFO', `Guard check passed: ${guardCheck.reason}`);

      bus.send(this.name, 'SP_NIYOJAK', 'PLAN_REQUEST', { command, understanding, taskId: task.task_id }, task.task_id);

      // 4. Send to Planner (Niyojak)
      task.updateStatus(TASK_STATUS.PLANNING);
      const plan = await niyojak.execute(task);
      task.addLog('INFO', `Received plan from Niyojak: ${plan.plan_id} with ${plan.total_steps} steps`);

      bus.send(this.name, 'SP_RAKSHAK', 'GUARD_CHECK_PLAN', { plan, taskId: task.task_id }, task.task_id);

      // 5. Rakshak checks the plan
      const planGuard = rakshak.checkPlan(plan, task.task_id);
      task.addLog('INFO', `Rakshak plan check: ${planGuard.allowed} allowed, ${planGuard.blocked} blocked`, planGuard);

      if (planGuard.blocked > 0) {
        task.addLog('WARN', `${planGuard.blocked} steps blocked by Rakshak - will skip destructive steps`);
      }

      // 6. Send plan to Manager (Samanvayak)
      bus.send(this.name, 'SP_SAMANVAYAK', 'EXECUTION_REQUEST', { plan, taskId: task.task_id }, task.task_id);
      const executionResult = await samanvayak.execute(task);

      // 7. Collect results and generate final report
      const finalReport = this.generateFinalReport(task, understanding, plan, planGuard, executionResult, startTime);

      task.setResult(finalReport);
      this.tasksProcessed++;
      this.status = 'IDLE';

      this.logger.info(`Task ${task.task_id} completed in ${Date.now() - startTime}ms: ${finalReport.success ? 'SUCCESS' : 'FAILED'}`);

      bus.send(this.name, 'ALL', 'TASK_FINAL_REPORT', { taskId: task.task_id, report: finalReport }, task.task_id);

      return finalReport;

    } catch (err) {
      this.status = 'ERROR';
      this.logger.error(`Failed to process command: ${err.message}`, { stack: err.stack });
      return {
        success: false,
        error: err.message,
        stack: err.stack,
        command,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime
      };
    }
  }

  generateFinalReport(task, understanding, plan, guardCheck, executionResult, startTime) {
    const duration = Date.now() - startTime;
    const findings = executionResult?.steps?.flatMap(s => s.findings || []) || [];
    const suggestions = executionResult?.steps?.flatMap(s => s.suggestions || []) || [];
    const criticalFindings = findings.filter(f => f.toLowerCase().includes('leak') || f.toLowerCase().includes('credential') || f.toLowerCase().includes('critical'));

    // Get the detailed report from last step if available
    const lastStep = executionResult?.steps?.[executionResult.steps.length - 1];
    const detailedReport = lastStep?.report || lastStep?.data?.report || executionResult?.report?.report || '';

    return {
      success: executionResult?.success !== false,
      task_id: task.task_id,
      command: task.command,
      understanding,
      plan: {
        id: plan.plan_id,
        intent: plan.intent,
        total_steps: plan.total_steps,
        complexity: plan.complexity
      },
      guard: {
        allowed: guardCheck.allowed,
        blocked: guardCheck.blocked,
        safeMode: guardCheck.safeMode
      },
      execution: {
        totalSteps: executionResult?.totalSteps || plan.total_steps,
        completedSteps: executionResult?.completedSteps || 0,
        failedSteps: executionResult?.failedSteps || 0,
        blockedSteps: executionResult?.blockedSteps || 0,
        verification: executionResult?.verification
      },
      findings: findings.slice(0, 30),
      criticalFindings: criticalFindings.slice(0, 10),
      suggestions: suggestions.slice(0, 20),
      report: detailedReport || this.buildTextReport(task, findings, suggestions, executionResult, duration),
      summary: executionResult?.summary || `Task completed: ${executionResult?.completedSteps || 0}/${plan.total_steps} steps succeeded`,
      duration,
      timestamp: new Date().toISOString(),
      safeMode: safeMode.isEnabled(),
      version: this.version
    };
  }

  buildTextReport(task, findings, suggestions, executionResult, duration) {
    return `
╔════════════════════════════════════════════════════════════╗
║           SP SAARTHI - TASK EXECUTION REPORT               ║
╚════════════════════════════════════════════════════════════╝

Task ID: ${task.task_id}
Command: ${task.command}
Duration: ${duration}ms
Status: ${task.status}
Safe Mode: ${safeMode.isEnabled() ? 'ON' : 'OFF'}

--- PLAN ---
Intent: ${task.plan?.intent || 'unknown'}
Steps: ${task.plan?.total_steps || 0}
Complexity: ${task.plan?.complexity || 'medium'}

--- EXECUTION ---
Completed: ${executionResult?.completedSteps || 0}/${executionResult?.totalSteps || task.plan?.total_steps || 0}
Failed: ${executionResult?.failedSteps || 0}
Blocked: ${executionResult?.blockedSteps || 0}
Verification: ${executionResult?.verification?.success ? 'PASSED' : 'FAILED'} - ${executionResult?.verification?.reason || ''}

--- FINDINGS (${findings.length}) ---
${findings.map((f, i) => `${i + 1}. ${f}`).join('\n') || 'No findings'}

--- SUGGESTIONS (${suggestions.length}) ---
${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n') || 'No suggestions'}

--- DETAILED REPORT ---
${executionResult?.report?.report || 'No detailed report available'}

--- LOGS (last 10) ---
${task.logs.slice(-10).map(l => `[${l.level}] ${l.message}`).join('\n')}

════════════════════════════════════════════════════════════
Report generated by SP SAARTHI v${this.version}
`.trim();
  }

  // Get system status
  getStatus() {
    return {
      name: this.name,
      version: this.version,
      status: this.status,
      tasksProcessed: this.tasksProcessed,
      safeMode: safeMode.getStatus(),
      taskEngine: taskEngine.getStats(),
      agents: {
        rakshak: rakshak.getStats(),
        niyojak: niyojak.getStats(),
        samanvayak: samanvayak.getStats(),
        vikas: vikas.getStats()
      },
      communication: bus.getStats(),
      timestamp: new Date().toISOString()
    };
  }

  // For API: list tasks
  getTasks(limit = 20) {
    return taskEngine.getAllTasks(limit);
  }

  getTask(taskId) {
    const task = taskEngine.getTask(taskId);
    return task ? task.toFullJSON() : null;
  }
}

// Singleton master
const saarthi = new Saarthi();

module.exports = { Saarthi, saarthi };
