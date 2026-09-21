'use strict';

const { BaseAgent } = require('./base-agent');
const { ProjectInspector } = require('../tools/inspector');
const { FsTools } = require('../tools/fs-tools');
const { Logger } = require('../engine/logger');
const path = require('path');

/**
 * SP VIKAS — Development Worker
 * Responsibilities:
 * - inspect source code
 * - analyze bugs
 * - suggest fixes
 * - make safe code changes
 * - run tests
 */
class Vikas extends BaseAgent {
  constructor() {
    super('SP_VIKAS', 'Development Worker - Inspects code, analyzes bugs, suggests fixes, safe changes, tests');
    this.inspector = new ProjectInspector();
    this.fsTools = new FsTools();
    this.tasksCompleted = 0;
  }

  onMessage(msg) {
    super.onMessage(msg);
  }

  // Execute a single step from plan
  async executeStep(step, task) {
    const start = Date.now();
    this.logger.info(`Executing step: ${step.title}`, { taskId: task.task_id, stepId: step.id });
    task.addLog('INFO', `Vikas executing: ${step.title}`);

    try {
      let result;

      // Route based on step title/action
      const actionLower = (step.action || step.title || '').toLowerCase();

      if (actionLower.includes('project structure') || actionLower.includes('project root') || actionLower.includes('structure')) {
        result = await this.inspectStructure(task);
      } else if (actionLower.includes('dependencies') || actionLower.includes('package.json')) {
        result = await this.inspectDependencies(task);
      } else if (actionLower.includes('server') && (actionLower.includes('inspect') || actionLower.includes('code'))) {
        result = await this.inspectServer(task);
      } else if (actionLower.includes('memory') || actionLower.includes('leak') || actionLower.includes('analyze code for common') || actionLower.includes('analyze code for bugs')) {
        result = await this.analyzeMemoryAndBugs(task);
      } else if (actionLower.includes('syntax') || actionLower.includes('health check') || actionLower.includes('run tests') || actionLower.includes('test')) {
        result = await this.runTests(task);
      } else if (actionLower.includes('report') || actionLower.includes('findings') || actionLower.includes('generate')) {
        result = await this.generateReportStep(task);
      } else if (actionLower.includes('security') || actionLower.includes('credential') || actionLower.includes('auth')) {
        result = await this.securityAudit(task);
      } else if (actionLower.includes('deployment') || actionLower.includes('config')) {
        result = await this.checkDeployment(task);
      } else if (actionLower.includes('locate') || actionLower.includes('root cause') || actionLower.includes('understand')) {
        result = await this.analyzeBug(task, step);
      } else {
        // General inspection
        result = await this.generalInspection(task, step);
      }

      const duration = Date.now() - start;
      result.duration = duration;
      result.stepId = step.id;
      result.title = step.title;

      this.logger.info(`Step ${step.id} completed in ${duration}ms: ${result.success ? 'SUCCESS' : 'FAILED'}`, { taskId: task.task_id });
      return result;

    } catch (err) {
      const duration = Date.now() - start;
      this.logger.error(`Step ${step.id} failed: ${err.message}`, { taskId: task.task_id, error: err.stack });
      return {
        success: false,
        error: err.message,
        stepId: step.id,
        title: step.title,
        duration,
        critical: false
      };
    }
  }

  async inspectStructure(task) {
    const res = this.inspector.inspectStructure();
    return {
      success: res.success,
      findings: res.findings || [],
      suggestions: res.suggestions || [],
      data: res,
      message: res.summary || 'Structure inspection completed'
    };
  }

  async inspectDependencies(task) {
    const res = this.inspector.inspectDependencies();
    return {
      success: res.success,
      findings: res.findings || [],
      suggestions: res.suggestions || [],
      data: res,
      message: `Dependencies: ${res.depCount} deps, heavy: ${res.heavyDeps?.join(', ') || 'none'}`
    };
  }

  async inspectServer(task) {
    const res = this.inspector.inspectServer();
    return {
      success: res.success,
      findings: res.findings || [],
      suggestions: res.suggestions || [],
      data: res,
      message: res.summary,
      health: res.health
    };
  }

  async analyzeMemoryAndBugs(task) {
    const serverRes = this.inspector.inspectServer();
    const bugRes = this.inspector.inspectForBugs();
    const findings = [...(serverRes.findings || []), ...(bugRes.findings || [])];
    const suggestions = [...(serverRes.suggestions || []), ...(bugRes.suggestions || [])];

    // Specific memory analysis
    const memoryFindings = findings.filter(f => f.toLowerCase().includes('memory') || f.toLowerCase().includes('leak') || f.toLowerCase().includes('cache') || f.toLowerCase().includes('interval'));

    return {
      success: true,
      findings,
      memoryFindings,
      suggestions,
      data: { server: serverRes, bugs: bugRes },
      message: `Analyzed ${serverRes.lines || 0} lines, found ${findings.length} issues, ${memoryFindings.length} memory-related`,
      critical: memoryFindings.length > 0 ? memoryFindings : []
    };
  }

  async runTests(task) {
    const syntax = this.inspector.runSyntaxCheck();
    const { execSync } = require('child_process');
    let testResults = { syntax };

    // Try running npm check if available
    try {
      const root = this.fsTools.root;
      if (syntax.success) {
        // Attempt to run check-syntax.mjs if exists
        const checkFile = path.join(root, 'scripts/check-syntax.mjs');
        const fs = require('fs');
        if (fs.existsSync(checkFile)) {
          try {
            execSync('node scripts/check-syntax.mjs', { cwd: root, stdio: 'pipe', timeout: 15000 });
            testResults.checkSyntaxScript = { success: true, message: 'check-syntax.mjs passed' };
          } catch (e) {
            testResults.checkSyntaxScript = { success: false, error: e.message.slice(0, 500) };
          }
        }
      }
    } catch (e) {
      testResults.extra = { error: e.message };
    }

    const allFindings = [
      ...(syntax.findings || []),
      ...(testResults.checkSyntaxScript && !testResults.checkSyntaxScript.success ? [testResults.checkSyntaxScript.error] : [])
    ];

    return {
      success: syntax.success,
      findings: allFindings,
      suggestions: syntax.suggestions || [],
      data: testResults,
      message: `Syntax check: ${syntax.success ? 'PASSED' : 'FAILED'}, ${syntax.results?.length || 0} files checked`
    };
  }

  async generateReportStep(task) {
    // Collect previous step results from task
    const previousResults = task.steps.filter(s => s.result).map(s => s.result);
    const allFindings = previousResults.flatMap(r => r.findings || []);
    const allSuggestions = previousResults.flatMap(r => r.suggestions || []);
    const full = this.inspector.fullInspection();

    return {
      success: true,
      findings: allFindings,
      suggestions: allSuggestions,
      data: full,
      report: full.report,
      message: `Generated comprehensive report: ${allFindings.length} findings, ${allSuggestions.length} suggestions`,
      summary: full.report
    };
  }

  async securityAudit(task) {
    const serverRes = this.inspector.inspectServer();
    const findings = (serverRes.findings || []).filter(f => f.toLowerCase().includes('credential') || f.toLowerCase().includes('security') || f.toLowerCase().includes('env'));
    const suggestions = serverRes.suggestions || [];

    // Additional security checks
    const extraFindings = [];
    const fs = require('fs');
    const envPath = path.join(this.fsTools.root, '.env');
    if (fs.existsSync(envPath)) {
      extraFindings.push('.env file exists in root - ensure it is in .gitignore');
    }

    return {
      success: true,
      findings: [...findings, ...extraFindings],
      suggestions,
      data: { server: serverRes },
      message: `Security audit: ${findings.length + extraFindings.length} issues`
    };
  }

  async checkDeployment(task) {
    const checks = [];
    const files = ['render.yaml', 'Dockerfile', 'railway.json', 'package.json'];
    for (const file of files) {
      const info = this.fsTools.getFileInfo(file);
      checks.push({ file, exists: info.success, size: info.success ? info.size : 0 });
    }

    const findings = [];
    if (!checks.find(c => c.file === 'package.json' && c.exists)) findings.push('package.json missing - deployment will fail');
    if (!checks.find(c => c.file === 'render.yaml' && c.exists) && !checks.find(c => c.file === 'Dockerfile' && c.exists)) {
      findings.push('No deployment config (render.yaml or Dockerfile) found');
    }

    return {
      success: findings.length === 0,
      findings,
      suggestions: findings.length ? ['Add deployment config'] : ['Deployment config looks OK'],
      data: { checks },
      message: `Deployment check: ${checks.filter(c => c.exists).length}/${files.length} configs present`
    };
  }

  async analyzeBug(task, step) {
    // Generic bug analysis
    const bugRes = this.inspector.inspectForBugs();
    return {
      success: true,
      findings: bugRes.findings || [],
      suggestions: bugRes.suggestions || [],
      data: bugRes,
      message: `Bug analysis: ${bugRes.findings?.length || 0} potential issues in ${bugRes.checkedFiles} files`
    };
  }

  async generalInspection(task, step) {
    const full = this.inspector.fullInspection();
    return {
      success: true,
      findings: full.findings || [],
      suggestions: full.suggestions || [],
      data: full,
      message: full.summary?.totalFindings ? `Inspection: ${full.summary.totalFindings} findings` : 'General inspection completed'
    };
  }

  // Full task execution (used when called directly)
  async execute(task) {
    this.setStatus('BUSY', task.task_id);
    try {
      task.addLog('INFO', 'SP Vikas starting full inspection');
      const full = this.inspector.fullInspection();
      task.addLog('INFO', `Vikas completed: ${full.findings.length} findings, health=${full.health}`);
      this.setStatus('IDLE');
      this.stats.tasksCompleted++;
      this.tasksCompleted++;
      return {
        success: true,
        findings: full.findings,
        suggestions: full.suggestions,
        report: full.report,
        health: full.health,
        summary: full.summary,
        data: full
      };
    } catch (err) {
      this.setStatus('ERROR', task.task_id);
      this.stats.tasksFailed++;
      throw err;
    }
  }

  getStats() {
    return {
      ...this.getInfo(),
      tasksCompleted: this.tasksCompleted,
      inspectorRoot: this.fsTools.root
    };
  }
}

const vikas = new Vikas();

module.exports = { Vikas, vikas };
