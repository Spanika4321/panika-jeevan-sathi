'use strict';

const EventEmitter = require('events');
const { Logger } = require('./logger');

const logger = new Logger('COMMUNICATION');

/**
 * Agent Communication System
 * Handles messaging between agents: Saarthi -> Rakshak -> Niyojak -> Samanvayak -> Vikas
 */

class AgentMessage {
  constructor(from, to, type, payload, taskId = null) {
    this.id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.from = from;
    this.to = to;
    this.type = type; // TASK_ASSIGN, PLAN_REQUEST, PLAN_RESPONSE, EXECUTION_REQUEST, RESULT, GUARD_CHECK, LOG
    this.payload = payload;
    this.taskId = taskId;
    this.timestamp = new Date().toISOString();
  }
}

class CommunicationBus extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this.agents = new Map(); // agentName -> agentInstance
    this.channels = new Map(); // channelName -> listeners
    this.maxHistory = 1000;
  }

  registerAgent(name, agentInstance) {
    this.agents.set(name, agentInstance);
    logger.info(`Agent registered: ${name}`);
    this.emit('agent:registered', { name, timestamp: new Date().toISOString() });
  }

  unregisterAgent(name) {
    this.agents.delete(name);
    logger.info(`Agent unregistered: ${name}`);
  }

  // Send direct message from one agent to another
  send(from, to, type, payload, taskId = null) {
    const msg = new AgentMessage(from, to, type, payload, taskId);
    this.messages.push(msg);
    if (this.messages.length > this.maxHistory) this.messages = this.messages.slice(-this.maxHistory);

    logger.debug(`Message: ${from} -> ${to} [${type}]`, { taskId, msgId: msg.id });

    // Emit specific events
    this.emit(`message:${to}`, msg);
    this.emit(`message:${type}`, msg);
    this.emit('message', msg);

    // If target agent exists and has onMessage, deliver
    const target = this.agents.get(to);
    if (target && typeof target.onMessage === 'function') {
      try {
        target.onMessage(msg);
      } catch (err) {
        logger.error(`Failed to deliver message to ${to}: ${err.message}`);
      }
    }

    return msg;
  }

  // Broadcast to all agents
  broadcast(from, type, payload, taskId = null) {
    const msg = new AgentMessage(from, 'ALL', type, payload, taskId);
    this.messages.push(msg);
    if (this.messages.length > this.maxHistory) this.messages = this.messages.slice(-this.maxHistory);

    logger.info(`Broadcast: ${from} -> ALL [${type}]`, { taskId });

    this.emit('broadcast', msg);
    this.emit(`message:${type}`, msg);
    this.emit('message', msg);

    for (const [name, agent] of this.agents) {
      if (name !== from && typeof agent.onMessage === 'function') {
        try { agent.onMessage(msg); } catch (e) { logger.error(`Broadcast failed to ${name}: ${e.message}`); }
      }
    }
    return msg;
  }

  // Request-Response pattern with timeout
  async request(from, to, type, payload, taskId = null, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const requestMsg = this.send(from, to, type, payload, taskId);
      const timer = setTimeout(() => {
        this.removeListener(`response:${requestMsg.id}`, handler);
        reject(new Error(`Request timeout: ${from} -> ${to} [${type}] after ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (responseMsg) => {
        clearTimeout(timer);
        resolve(responseMsg);
      };

      this.once(`response:${requestMsg.id}`, handler);
    });
  }

  // Respond to a request
  respond(originalMsg, from, payload) {
    const responseMsg = new AgentMessage(from, originalMsg.from, `${originalMsg.type}_RESPONSE`, payload, originalMsg.taskId);
    responseMsg.responseTo = originalMsg.id;
    this.messages.push(responseMsg);
    this.emit(`response:${originalMsg.id}`, responseMsg);
    this.emit(`message:${responseMsg.to}`, responseMsg);
    this.emit('message', responseMsg);

    const target = this.agents.get(originalMsg.from);
    if (target && typeof target.onMessage === 'function') {
      try { target.onMessage(responseMsg); } catch (e) { logger.error(`Response delivery failed: ${e.message}`); }
    }
    return responseMsg;
  }

  getHistory(taskId = null, limit = 100) {
    let filtered = this.messages;
    if (taskId) filtered = filtered.filter(m => m.taskId === taskId);
    return filtered.slice(-limit);
  }

  getStats() {
    return {
      totalMessages: this.messages.length,
      registeredAgents: Array.from(this.agents.keys()),
      channels: Array.from(this.channels.keys()),
      lastMessage: this.messages[this.messages.length - 1] || null
    };
  }

  clearHistory() {
    this.messages = [];
    logger.info('Communication history cleared');
  }
}

// Singleton bus
const bus = new CommunicationBus();

module.exports = { CommunicationBus, AgentMessage, bus };
