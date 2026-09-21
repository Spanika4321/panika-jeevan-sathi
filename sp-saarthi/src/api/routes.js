'use strict';

const { saarthi } = require('../master/saarthi');
const { taskEngine } = require('../engine/task-engine');
const { safeMode } = require('../engine/safe-mode');
const { rakshak } = require('../agents/rakshak');
const { bus } = require('../engine/communication');
const { Logger } = require('../engine/logger');

const logger = new Logger('API-ROUTES');

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) { req.destroy(); reject(new Error('Body too large')); } });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function handleRoutes(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return true;
  }

  // Health
  if (pathname === '/api/health' && method === 'GET') {
    json(res, 200, { status: 'ok', service: 'SP SAARTHI', version: saarthi.version, timestamp: new Date().toISOString(), safeMode: safeMode.isEnabled() });
    return true;
  }

  // System status
  if (pathname === '/api/status' && method === 'GET') {
    json(res, 200, saarthi.getStatus());
    return true;
  }

  // Safe Mode
  if (pathname === '/api/safe-mode' && method === 'GET') {
    json(res, 200, safeMode.getStatus());
    return true;
  }

  if (pathname === '/api/safe-mode/toggle' && method === 'POST') {
    const newState = safeMode.toggle();
    logger.warn(`Safe Mode toggled via API to ${newState ? 'ON' : 'OFF'}`);
    json(res, 200, { ...safeMode.getStatus(), message: `Safe Mode ${newState ? 'ENABLED' : 'DISABLED'}` });
    return true;
  }

  if (pathname === '/api/safe-mode/enable' && method === 'POST') {
    safeMode.enable();
    json(res, 200, { ...safeMode.getStatus(), message: 'Safe Mode ENABLED' });
    return true;
  }

  if (pathname === '/api/safe-mode/disable' && method === 'POST') {
    safeMode.disable();
    json(res, 200, { ...safeMode.getStatus(), message: 'Safe Mode DISABLED - Use with caution' });
    return true;
  }

  // Tasks
  if (pathname === '/api/tasks' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    json(res, 200, { tasks: taskEngine.getAllTasks(limit), stats: taskEngine.getStats() });
    return true;
  }

  if (pathname === '/api/tasks' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const command = body.command || body.message;
      if (!command || typeof command !== 'string' || command.trim().length === 0) {
        json(res, 400, { error: 'Command is required' });
        return true;
      }
      if (command.length > 2000) {
        json(res, 400, { error: 'Command too long (max 2000 chars)' });
        return true;
      }

      // Async execution - return task id immediately, then process
      const task = taskEngine.createTask(command, { metadata: { source: 'api', ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress } });

      // Process in background
      saarthi.receiveCommand(command, { metadata: { taskId: task.task_id } }).then(report => {
        logger.info(`Background task ${task.task_id} finished: ${report.success ? 'SUCCESS' : 'FAILED'}`);
      }).catch(err => {
        logger.error(`Background task ${task.task_id} error: ${err.message}`);
        const t = taskEngine.getTask(task.task_id);
        if (t) t.setError(err);
      });

      json(res, 202, {
        message: 'Task accepted and processing',
        task_id: task.task_id,
        command,
        status: 'PENDING',
        poll_url: `/api/tasks/${task.task_id}`
      });
      return true;
    } catch (err) {
      json(res, 400, { error: err.message });
      return true;
    }
  }

  // Single task
  const taskMatch = pathname.match(/^\/api\/tasks\/([^\/]+)$/);
  if (taskMatch && method === 'GET') {
    const taskId = taskMatch[1];
    const task = taskEngine.getTask(taskId);
    if (!task) { json(res, 404, { error: 'Task not found' }); return true; }
    json(res, 200, task.toFullJSON());
    return true;
  }

  if (taskMatch && method === 'DELETE') {
    const taskId = taskMatch[1];
    try {
      const task = await taskEngine.cancelTask(taskId);
      json(res, 200, { message: 'Task cancelled', task: task.toJSON() });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }

  // Execute command synchronously (for dashboard - waits for result)
  if (pathname === '/api/execute' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const command = body.command;
      if (!command) { json(res, 400, { error: 'Command required' }); return true; }
      logger.info(`Synchronous execute: ${command.slice(0, 100)}`);
      const report = await saarthi.receiveCommand(command, { metadata: { source: 'api-sync' } });
      json(res, 200, report);
      return true;
    } catch (err) {
      json(res, 500, { error: err.message, stack: err.stack });
      return true;
    }
  }

  // Agents status
  if (pathname === '/api/agents' && method === 'GET') {
    json(res, 200, {
      saarthi: saarthi.getStatus(),
      rakshak: rakshak.getStats(),
      niyojak: require('../agents/niyojak').niyojak.getStats(),
      samanvayak: require('../agents/samanvayak').samanvayak.getStats(),
      vikas: require('../agents/vikas').vikas.getStats()
    });
    return true;
  }

  // Communication history
  if (pathname === '/api/communication' && method === 'GET') {
    const taskId = url.searchParams.get('taskId');
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    json(res, 200, { messages: bus.getHistory(taskId, limit), stats: bus.getStats() });
    return true;
  }

  // Logs
  if (pathname === '/api/logs' && method === 'GET') {
    const taskId = url.searchParams.get('taskId');
    const limit = parseInt(url.searchParams.get('limit') || '200', 10);
    const { Logger } = require('../engine/logger');
    const tmpLogger = new Logger('API');
    json(res, 200, { logs: tmpLogger.getLogs(taskId, limit) });
    return true;
  }

  // Clear completed tasks
  if (pathname === '/api/tasks/clear/completed' && method === 'POST') {
    const count = taskEngine.clearCompleted();
    json(res, 200, { message: `Cleared ${count} tasks`, cleared: count });
    return true;
  }

  return false; // not handled
}

module.exports = { handleRoutes };
