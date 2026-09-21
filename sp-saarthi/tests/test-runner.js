'use strict';

const { saarthi } = require('../src/master/saarthi');
const { taskEngine, TASK_STATUS } = require('../src/engine/task-engine');
const { safeMode } = require('../src/engine/safe-mode');
const { rakshak } = require('../src/agents/rakshak');
const { niyojak } = require('../src/agents/niyojak');
const { samanvayak } = require('../src/agents/samanvayak');
const { vikas } = require('../src/agents/vikas');
const { bus } = require('../src/engine/communication');

let passed = 0;
let failed = 0;
let tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${b} but got ${a}`);
}

// --- Tests ---

test('Safe Mode default ON', () => {
  assert(safeMode.isEnabled() === true, 'Safe Mode should be ON by default');
  const status = safeMode.getStatus();
  assert(status.enabled === true, 'Status should show enabled');
  assert(status.protections.length > 0, 'Should have protections');
});

test('Rakshak blocks DESTRUCTIVE', () => {
  const check = rakshak.checkPermission('rm -rf /', 'DESTRUCTIVE', { taskId: 'test' });
  assert(check.allowed === false, 'DESTRUCTIVE should be blocked');
  assert(check.level === 'BLOCKED_DESTRUCTIVE' || check.level === 'BLOCKED_SAFE_MODE', 'Should be blocked as destructive');
});

test('Rakshak allows READ', () => {
  const check = rakshak.checkPermission('Inspect project structure', 'READ', { taskId: 'test' });
  assert(check.allowed === true, 'READ should be allowed');
});

test('Rakshak blocks credential exposure', () => {
  const check = rakshak.checkPermission('console.log(process.env.SUPABASE_SERVICE_ROLE_KEY)', 'READ', { taskId: 'test' });
  assert(check.allowed === false, 'Credential exposure should be blocked');
});

test('Niyojak creates plan for memory inspection', () => {
  const plan = niyojak.createPlan('TalkoraA ka memory problem check karo.', 'test-task');
  assert(plan.steps.length >= 4, 'Memory inspection plan should have at least 4 steps');
  assert(plan.intent === 'memory_inspection' || plan.intent === 'project_inspection', `Intent should be memory related, got ${plan.intent}`);
  assert(plan.plan_id.startsWith('plan_'), 'Plan ID should start with plan_');
});

test('Niyojak creates plan for project inspection', () => {
  const plan = niyojak.createPlan('Inspect TalkoraA project and tell me what is wrong.', 'test-task-2');
  assert(plan.steps.length >= 5, 'Project inspection should have at least 5 steps');
  assert(plan.intent === 'project_inspection' || plan.intent === 'inspection', `Intent should be inspection, got ${plan.intent}`);
  // Ensure planner does not execute tools (plan only)
  assert(!plan.executed, 'Planner should not execute, only plan');
});

test('Task creation and lifecycle', () => {
  const task = taskEngine.createTask('Test command', { metadata: { test: true } });
  assert(task.task_id.startsWith('task_'), 'Task ID format');
  assert(task.status === TASK_STATUS.PENDING, 'Should start as PENDING');
  assert(task.command === 'Test command', 'Command should match');

  task.updateStatus(TASK_STATUS.PLANNING);
  assert(task.status === TASK_STATUS.PLANNING, 'Should be PLANNING');

  task.updateStatus(TASK_STATUS.RUNNING);
  assert(task.status === TASK_STATUS.RUNNING, 'Should be RUNNING');

  task.updateStatus(TASK_STATUS.COMPLETED);
  assert(task.status === TASK_STATUS.COMPLETED, 'Should be COMPLETED');
});

test('Communication bus', () => {
  const msg = bus.send('TEST_FROM', 'TEST_TO', 'TEST_TYPE', { hello: 'world' }, 'test-task');
  assert(msg.from === 'TEST_FROM', 'From should match');
  assert(msg.to === 'TEST_TO', 'To should match');
  assert(msg.type === 'TEST_TYPE', 'Type should match');
  assert(msg.payload.hello === 'world', 'Payload should match');

  const history = bus.getHistory('test-task', 10);
  assert(history.length >= 1, 'History should contain message');
});

test('Vikas inspector - structure', async () => {
  const result = await vikas.inspectStructure({ task_id: 'test', addLog: () => {}, steps: [] });
  assert(result.success !== undefined, 'Should have success field');
  // Might have findings but should not throw
});

test('Vikas inspector - dependencies', async () => {
  const result = await vikas.inspectDependencies({ task_id: 'test', addLog: () => {}, steps: [] });
  assert(result.success !== undefined, 'Should have success');
});

test('Full orchestration - Inspect project', async () => {
  const report = await saarthi.receiveCommand('Inspect TalkoraA project and tell me what is wrong.', { metadata: { test: true } });
  assert(report.task_id, 'Should have task_id');
  assert(report.success !== undefined, 'Should have success');
  assert(report.plan, 'Should have plan');
  assert(report.execution, 'Should have execution');
  assert(report.findings, 'Should have findings array');
  assert(report.report, 'Should have report string');
  // Report should mention project inspection
  assert(report.report.length > 100, 'Report should be substantial');
  console.log('\n--- Sample Report (first 500 chars) ---\n' + report.report.slice(0, 500) + '\n--- End Sample ---\n');
});

test('Safe Mode protections list', () => {
  const status = safeMode.getStatus();
  assert(status.protections.includes('no destructive commands') || status.protections.length > 0, 'Should list protections');
});

test('Task Engine stats', () => {
  const stats = taskEngine.getStats();
  assert(stats.total >= 1, 'Should have at least 1 task from previous tests');
  assert(stats.byStatus, 'Should have byStatus');
});

test('Agents registration', () => {
  const stats = bus.getStats();
  assert(stats.registeredAgents.includes('SP_SAARTHI'), 'Saarthi should be registered');
  assert(stats.registeredAgents.includes('SP_RAKSHAK'), 'Rakshak should be registered');
  assert(stats.registeredAgents.includes('SP_NIYOJAK'), 'Niyojak should be registered');
  assert(stats.registeredAgents.includes('SP_SAMANVAYAK'), 'Samanvayak should be registered');
  assert(stats.registeredAgents.includes('SP_VIKAS'), 'Vikas should be registered');
});

// Run all tests
async function run() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   SP SAARTHI - PART 1 TEST RUNNER       ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  for (const { name, fn } of tests) {
    try {
      const result = fn();
      if (result instanceof Promise) await result;
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ FAIL: ${name}`);
      console.log(`     ${err.message}`);
      if (err.stack) console.log(`     ${err.stack.split('\n')[1]?.trim()}`);
      failed++;
    }
  }

  console.log('');
  console.log('  ──────────────────────────────────────────');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${tests.length} total`);
  console.log(`  Status: ${failed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('');

  // Final system status
  console.log('  System Status:');
  console.log(`    Safe Mode: ${safeMode.isEnabled() ? 'ON' : 'OFF'}`);
  console.log(`    Tasks: ${taskEngine.getStats().total} total`);
  console.log(`    Agents: ${bus.getStats().registeredAgents.length} registered`);
  console.log(`    Communication: ${bus.getStats().totalMessages} messages`);
  console.log('');

  // Detailed file report
  console.log('  Files Created:');
  const fs = require('fs');
  const path = require('path');
  function listFiles(dir, prefix = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'logs') continue;
          console.log(`    ${prefix}${entry.name}/`);
          listFiles(full, prefix + '  ');
        } else {
          console.log(`    ${prefix}${entry.name}`);
        }
      }
    } catch {}
  }
  listFiles(path.join(__dirname, '..'));

  console.log('');
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
