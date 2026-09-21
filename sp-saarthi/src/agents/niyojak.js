'use strict';

const { BaseAgent } = require('./base-agent');
const crypto = require('crypto');

/**
 * SP NIYOJAK — Planner Agent
 * Convert user command into structured steps
 * MUST NOT execute tools, only plan
 */
class Niyojak extends BaseAgent {
  constructor() {
    super('SP_NIYOJAK', 'Planner - Converts user command into structured steps (plan only, no execution)');
    this.plansCreated = 0;
  }

  onMessage(msg) {
    super.onMessage(msg);
    // Handles PLAN_REQUEST
  }

  // Main planning logic - rule based, no tool execution
  createPlan(command, taskId = null) {
    this.setStatus('BUSY', taskId);
    this.logger.info(`Creating plan for: ${command}`, { taskId });

    const lower = command.toLowerCase();
    let steps = [];
    let intent = 'general';
    let complexity = 'medium';

    // Detect intent
    if (lower.match(/memory|leak|ram|heap/)) {
      intent = 'memory_inspection';
      steps = this.planMemoryInspection(command);
      complexity = 'high';
    } else if (lower.match(/inspect|check|audit|analyze|what.*wrong|kya.*galat/)) {
      intent = 'inspection';
      steps = this.planInspection(command);
    } else if (lower.match(/bug|fix|error|issue|problem/)) {
      intent = 'bug_fix';
      steps = this.planBugFix(command);
    } else if (lower.match(/test|verify|validate/)) {
      intent = 'testing';
      steps = this.planTesting(command);
    } else if (lower.match(/talkora|panika|project/)) {
      intent = 'project_inspection';
      steps = this.planProjectInspection(command);
      complexity = 'high';
    } else if (lower.match(/deploy|production|server/)) {
      intent = 'deployment_check';
      steps = this.planDeploymentCheck(command);
      complexity = 'high';
    } else if (lower.match(/security|safe|credential/)) {
      intent = 'security_audit';
      steps = this.planSecurityAudit(command);
    } else {
      steps = this.planGeneral(command);
    }

    const plan = {
      plan_id: `plan_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      task_id: taskId,
      command,
      intent,
      complexity,
      steps: steps.map((s, idx) => ({
        id: `step_${idx + 1}`,
        order: idx + 1,
        title: s.title,
        description: s.description,
        action: s.action,
        agent: s.agent || 'SP_VIKAS',
        permission: s.permission || 'READ',
        estimated_time: s.estimated_time || '2m',
        status: 'PENDING',
        dependencies: idx > 0 ? [`step_${idx}`] : [],
        result: null
      })),
      created_at: new Date().toISOString(),
      created_by: this.name,
      total_steps: steps.length,
      requires_approval: steps.some(s => s.permission === 'DESTRUCTIVE')
    };

    this.plansCreated++;
    this.logger.info(`Plan created: ${plan.plan_id} with ${plan.total_steps} steps, intent=${intent}`, { taskId });
    this.setStatus('IDLE');

    return plan;
  }

  planMemoryInspection(command) {
    return [
      {
        title: 'Inspect project structure',
        description: 'Check project files, directories, and overall structure for memory-related configs',
        action: 'Inspect project structure and list large files/directories',
        agent: 'SP_VIKAS',
        permission: 'READ',
        estimated_time: '1m'
      },
      {
        title: 'Inspect dependencies',
        description: 'Analyze package.json, node_modules size, and dependency tree for memory leaks',
        action: 'Inspect dependencies and analyze package.json for heavy modules',
        agent: 'SP_VIKAS',
        permission: 'READ',
        estimated_time: '2m'
      },
      {
        title: 'Inspect server code',
        description: 'Check server.js and lib/ for memory leaks, unclosed handles, large caches',
        action: 'Inspect server.js and lib/ files for memory patterns',
        agent: 'SP_VIKAS',
        permission: 'READ',
        estimated_time: '3m'
      },
      {
        title: 'Check runtime metrics',
        description: 'Analyze potential memory leak sources: closures, event listeners, caches',
        action: 'Analyze code for common Node.js memory leak patterns',
        agent: 'SP_VIKAS',
        permission: 'READ',
        estimated_time: '2m'
      },
      {
        title: 'Identify memory issue and report',
        description: 'Consolidate findings and produce report with suggestions',
        action: 'Generate memory inspection report with findings and recommendations',
        agent: 'SP_VIKAS',
        permission: 'READ',
        estimated_time: '2m'
      }
    ];
  }

  planInspection(command) {
    return [
      { title: 'Project structure inspection', description: 'Scan project structure', action: 'Inspect project structure', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' },
      { title: 'Source code analysis', description: 'Analyze main source files for issues', action: 'Analyze source code files', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '3m' },
      { title: 'Dependency check', description: 'Check dependencies for vulnerabilities or outdated packages', action: 'Check package.json and dependencies', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' },
      { title: 'Configuration review', description: 'Review configs and env handling', action: 'Review configuration files', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' },
      { title: 'Generate inspection report', description: 'Create comprehensive report', action: 'Generate final inspection report', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' }
    ];
  }

  planProjectInspection(command) {
    // For "Inspect TalkoraA project and tell me what is wrong."
    return [
      { title: 'Inspect TalkoraA / Panika project root', description: 'List files, check README, package.json, server entry', action: 'Inspect project root and structure', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' },
      { title: 'Inspect server and API layer', description: 'Check server.js, lib/api.js, lib/db.js for errors', action: 'Inspect server.js and lib/ directory', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' },
      { title: 'Inspect public and frontend', description: 'Check public/ HTML files and assets', action: 'Inspect public/ directory and frontend assets', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' },
      { title: 'Analyze potential bugs and performance issues', description: 'Look for common issues: memory, security, error handling', action: 'Analyze code for bugs and performance issues', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '3m' },
      { title: 'Run syntax and health checks', description: 'Run existing test scripts if available', action: 'Run syntax check and health check scripts', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' },
      { title: 'Report findings', description: 'Compile all findings into final report', action: 'Generate detailed report of what is wrong and suggestions', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' }
    ];
  }

  planBugFix(command) {
    return [
      { title: 'Reproduce and understand bug', description: 'Analyze bug description and locate relevant code', action: 'Locate and analyze bug-related code', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' },
      { title: 'Root cause analysis', description: 'Identify root cause', action: 'Perform root cause analysis', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' },
      { title: 'Suggest fix', description: 'Propose safe fix', action: 'Suggest safe code fix for the bug', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' },
      { title: 'Apply safe fix', description: 'Make safe code changes if approved', action: 'Apply safe code change (requires approval)', agent: 'SP_VIKAS', permission: 'WRITE', estimated_time: '2m' },
      { title: 'Test fix', description: 'Run tests to verify fix', action: 'Run tests to verify bug fix', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' }
    ];
  }

  planTesting(command) {
    return [
      { title: 'Identify test scope', description: 'Determine what needs testing', action: 'Identify test scope from command', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' },
      { title: 'Run existing tests', description: 'Execute test suites', action: 'Run existing test scripts', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '3m' },
      { title: 'Report test results', description: 'Summarize results', action: 'Generate test report', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' }
    ];
  }

  planDeploymentCheck(command) {
    return [
      { title: 'Check deployment config', description: 'Review render.yaml, Dockerfile, railway.json', action: 'Inspect deployment configuration files', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' },
      { title: 'Check environment handling', description: 'Verify env vars and secrets handling', action: 'Review env handling and security', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' },
      { title: 'Server readiness check', description: 'Check if server can start', action: 'Check server startup and health', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' }
    ];
  }

  planSecurityAudit(command) {
    return [
      { title: 'Credential exposure scan', description: 'Scan for hardcoded secrets', action: 'Scan for credential exposure', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' },
      { title: 'Security headers check', description: 'Review http-security and CSP', action: 'Check security headers and policies', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' },
      { title: 'Auth and input validation audit', description: 'Review auth logic', action: 'Audit auth and input validation', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' }
    ];
  }

  planGeneral(command) {
    return [
      { title: 'Understand request', description: `Parse user command: "${command.slice(0, 100)}"`, action: `Parse and understand command: ${command.slice(0, 80)}`, agent: 'SP_VIKAS', permission: 'READ', estimated_time: '1m' },
      { title: 'Inspect relevant areas', description: 'Identify and inspect relevant code/files', action: 'Inspect relevant project areas', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' },
      { title: 'Analyze and propose solution', description: 'Analyze findings and propose solution', action: 'Analyze and propose solution', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' },
      { title: 'Execute and report', description: 'Execute safe actions and generate report', action: 'Execute safe actions and generate final report', agent: 'SP_VIKAS', permission: 'READ', estimated_time: '2m' }
    ];
  }

  async execute(task) {
    this.setStatus('BUSY', task.task_id);
    try {
      task.addLog('INFO', 'SP Niyojak planning task');
      task.updateStatus('PLANNING');
      const plan = this.createPlan(task.command, task.task_id);
      task.setPlan(plan);
      task.addLog('INFO', `Plan created: ${plan.plan_id} with ${plan.total_steps} steps, intent=${plan.intent}`);
      this.setStatus('IDLE');
      this.stats.tasksCompleted++;
      return plan;
    } catch (err) {
      this.setStatus('ERROR', task.task_id);
      this.stats.tasksFailed++;
      task.addLog('ERROR', `Niyojak planning failed: ${err.message}`);
      throw err;
    }
  }

  getStats() {
    return {
      ...this.getInfo(),
      plansCreated: this.plansCreated
    };
  }
}

const niyojak = new Niyojak();

module.exports = { Niyojak, niyojak };
