# SP SAARTHI — Master Agent Orchestration System (PART 1)

**SP Saarthi** is the central Master Agent that orchestrates 4 sub-agents to handle user commands safely.

## Architecture

```
USER
 ↓
SP SAARTHI — Master Agent (Orchestrator)
 ↓
SP RAKSHAK — Guardian (Permission checks: READ, WRITE, DESTRUCTIVE)
 ↓
SP NIYOJAK — Planner (Converts command → structured steps, plan only, no execution)
 ↓
SP SAMANVAYAK — Manager (Tracks PENDING → PLANNING → RUNNING → VERIFYING → COMPLETED / FAILED / CANCELLED)
 ↓
SP VIKAS — Development Worker (Inspects code, analyzes bugs, suggests fixes, safe changes, runs tests)
```

## Features — PART 1

### 1. SP Saarthi (Master)
- Receives user command
- Understands request (intent detection)
- Creates task
- Sends to Planner, receives plan
- Sends plan to Manager
- Collects worker results
- Returns final report

### 2. SP Rakshak (Guardian)
- Checks every action before execution
- Permission levels: READ, WRITE, DESTRUCTIVE
- DESTRUCTIVE never executes automatically
- Safe Mode protections: no prod deletion, no credential exposure, no unauthorized deployment

### 3. SP Niyojak (Planner)
- Converts user command into structured steps
- Example: "TalkoraA ka memory problem check karo." → 5 steps (inspect project, deps, server, identify, report)
- Plan only, never executes tools

### 4. SP Samanvayak (Manager)
- Manages execution
- Tracks: PENDING, PLANNING, RUNNING, FAILED, VERIFYING, COMPLETED, CANCELLED
- Coordinates Vikas, handles Rakshak blocks

### 5. SP Vikas (Worker)
- Inspects source code
- Analyzes bugs
- Suggests fixes
- Makes safe code changes
- Runs tests (syntax, health)

### 6. Task Engine
- Task object: task_id, command, plan, assigned_agent, status, logs, result, created_at, updated_at
- Queue management, persistence

### 7. Communication System
- Event bus for agent messaging
- Request-response, broadcast, direct messaging
- History tracking

### 8. Logging
- File + console logging
- Task-specific logs
- Global system log

### 9. Safe Mode
- Default: SAFE_MODE=true
- When ON: blocks destructive, prod deletion, credential exposure, unauthorized deployment

## Project Structure

```
sp-saarthi/
├── src/
│   ├── master/
│   │   └── saarthi.js
│   ├── agents/
│   │   ├── base-agent.js
│   │   ├── rakshak.js
│   │   ├── niyojak.js
│   │   ├── samanvayak.js
│   │   └── vikas.js
│   ├── engine/
│   │   ├── task.js
│   │   ├── task-engine.js
│   │   ├── communication.js
│   │   ├── logger.js
│   │   ├── safe-mode.js
│   │   └── index.js
│   ├── tools/
│   │   ├── fs-tools.js
│   │   └── inspector.js
│   └── api/
│       ├── server.js
│       └── routes.js
├── dashboard/
│   └── public/
│       ├── index.html
│       ├── style.css
│       └── app.js
├── tests/
│   └── test-runner.js
├── logs/
├── package.json
└── README.md
```

## Control Panel Dashboard

Separate website with:
- Command input to talk to Saarthi
- Real-time task tracking
- Agent status indicators
- Safe Mode toggle
- Task history, logs, communication bus viewer
- Architecture visualization

### Run Dashboard

```bash
cd sp-saarthi
npm start
# or
node src/api/server.js
# Dashboard: http://localhost:3100
# API: http://localhost:3100/api/status
```

Port can be changed via `SAARTHI_PORT` env var.

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/status` - Full system status
- `GET /api/safe-mode` - Safe Mode status
- `POST /api/safe-mode/toggle` - Toggle Safe Mode
- `POST /api/safe-mode/enable` / `disable`
- `GET /api/tasks` - List tasks
- `POST /api/tasks` - Create task (async)
- `GET /api/tasks/:id` - Get task detail
- `DELETE /api/tasks/:id` - Cancel task
- `POST /api/execute` - Execute command synchronously (waits for result)
- `GET /api/agents` - Agents status
- `GET /api/communication` - Communication history
- `GET /api/logs` - Logs

## Testing

### Test Command

```
Inspect TalkoraA project and tell me what is wrong.
```

This triggers:
1. Saarthi understands: intent=project_inspection
2. Creates task
3. Niyojak plans 6 steps: inspect root, server, public, analyze bugs, run checks, report
4. Rakshak checks each step (all READ, allowed)
5. Samanvayak manages execution via Vikas
6. Vikas inspects actual Panika/TalkoraA project files
7. Returns final report with findings, suggestions, health

### Run Tests

```bash
cd sp-saarthi
node tests/test-runner.js
```

## Safe Mode

Default `SAFE_MODE=true`. Set env var to override:

```bash
SAFE_MODE=false npm start
```

When ON:
- No destructive commands (rm -rf, drop table, etc.)
- No production deletion
- No credential exposure (process.env SECRET, .env cat, etc.)
- No unauthorized deployment
- DESTRUCTIVE permission always blocked

## No Extra Dependencies

Zero npm dependencies - uses only Node.js built-ins (http, fs, path, crypto, events, child_process).

## PART 2 Preview

Next parts will include:
- Deployment automation
- Database automation
- Advanced dashboard with analytics
- More worker agents (SP Parikshak - Tester, SP Suraksha - Security)
- Learning system
- Multi-project support

## License

UNLICENSED - Private
