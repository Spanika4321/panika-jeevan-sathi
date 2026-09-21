'use strict';

const { Logger } = require('./logger');
const logger = new Logger('SAFE-MODE');

class SafeMode {
  constructor() {
    // Default SAFE_MODE=true as per spec
    const env = process.env.SAFE_MODE;
    if (env === 'false' || env === '0') this.enabled = false;
    else this.enabled = true; // default true

    this.blockedPatterns = [
      /rm\s+-rf/i,
      /drop\s+table/i,
      /delete\s+from/i,
      /truncate\s+/i,
      /shutdown/i,
      /mkfs/i,
      /dd\s+if=/i,
      /:\(\)\{\s*:\|\:&\s*;\}/, // fork bomb
      /process\.env/i, // credential exposure attempt
      /AWS_SECRET/i,
      /SUPABASE_SERVICE_ROLE_KEY/i,
      /SESSION_SECRET/i,
    ];

    this.destructiveKeywords = [
      'rm -rf',
      'delete production',
      'drop database',
      'truncate',
      'format',
      'wipe',
      'credential',
      'secret',
      'deploy production',
      'force push',
      'overwrite production'
    ];

    logger.info(`Safe Mode initialized: ${this.enabled ? 'ON' : 'OFF'}`);
  }

  isEnabled() {
    return this.enabled;
  }

  enable() {
    this.enabled = true;
    logger.warn('Safe Mode ENABLED');
    return true;
  }

  disable() {
    this.enabled = false;
    logger.warn('Safe Mode DISABLED - Destructive actions now allowed with approval');
    return false;
  }

  toggle() {
    this.enabled = !this.enabled;
    logger.warn(`Safe Mode toggled to ${this.enabled ? 'ON' : 'OFF'}`);
    return this.enabled;
  }

  // Check if command/action contains destructive patterns
  containsDestructive(command) {
    const cmd = String(command).toLowerCase();
    return this.blockedPatterns.some(p => p.test(command)) ||
           this.destructiveKeywords.some(k => cmd.includes(k.toLowerCase()));
  }

  // Main guard check
  check(action, permission) {
    const result = {
      allowed: true,
      permission,
      reason: '',
      safeMode: this.enabled
    };

    // If safe mode ON, block DESTRUCTIVE always
    if (this.enabled && permission === 'DESTRUCTIVE') {
      result.allowed = false;
      result.reason = 'DESTRUCTIVE actions blocked in Safe Mode. Disable Safe Mode or get manual approval.';
      logger.warn(`Blocked DESTRUCTIVE action: ${action}`, { permission });
      return result;
    }

    // Even in safe mode OFF, still check for credential exposure
    if (this.containsCredentialExposure(action)) {
      result.allowed = false;
      result.reason = 'Credential exposure detected - blocked even in unsafe mode';
      logger.critical(`Credential exposure attempt blocked: ${action}`);
      return result;
    }

    // Check for production deletion patterns
    if (this.containsProductionDeletion(action)) {
      if (this.enabled) {
        result.allowed = false;
        result.reason = 'Production deletion blocked in Safe Mode';
        logger.warn(`Production deletion blocked: ${action}`);
        return result;
      } else {
        result.reason = 'WARNING: Production deletion - requires explicit approval even when Safe Mode OFF';
        logger.warn(`Production deletion warning (Safe Mode OFF): ${action}`);
      }
    }

    return result;
  }

  containsCredentialExposure(action) {
    const patterns = [
      /process\.env.*SECRET/i,
      /process\.env.*KEY/i,
      /process\.env.*PASSWORD/i,
      /console\.log.*process\.env/i,
      /cat.*\.env/i,
      /SUPABASE_SERVICE_ROLE_KEY/,
      /SESSION_SECRET/,
      /ADMIN_PASSWORD/
    ];
    return patterns.some(p => p.test(String(action)));
  }

  containsProductionDeletion(action) {
    const patterns = [
      /rm\s+-rf.*production/i,
      /delete.*production.*database/i,
      /drop.*production/i,
      /wipe.*production/i,
      /supabase.*delete/i,
      /d1.*delete/i
    ];
    return patterns.some(p => p.test(String(action)));
  }

  getStatus() {
    return {
      enabled: this.enabled,
      mode: this.enabled ? 'SAFE' : 'UNSAFE',
      protections: this.enabled ? [
        'no destructive commands',
        'no production deletion',
        'no credential exposure',
        'no unauthorized deployment'
      ] : [
        'credential exposure still blocked',
        'destructive requires approval'
      ],
      timestamp: new Date().toISOString()
    };
  }
}

// Singleton
const safeMode = new SafeMode();

module.exports = { SafeMode, safeMode };
