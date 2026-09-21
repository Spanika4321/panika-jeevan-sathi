'use strict';

const fs = require('fs');
const path = require('path');
const { FsTools } = require('./fs-tools');

class ProjectInspector {
  constructor(rootDir = null) {
    this.fsTools = new FsTools(rootDir);
    this.root = this.fsTools.root;
  }

  // Inspect project structure
  inspectStructure() {
    const stats = this.fsTools.getProjectStats();
    const findings = [];
    const suggestions = [];

    if (!stats.success) {
      return { success: false, error: stats.error, findings, suggestions };
    }

    // Analyze findings
    if (stats.rootFiles > 30) findings.push(`Large root directory: ${stats.rootFiles} entries - consider organizing`);
    if (stats.dependenciesCount > 20) findings.push(`Many dependencies: ${stats.dependenciesCount} - check for unused`);
    if (stats.serverSize > 20000) findings.push(`Large server.js: ${stats.serverSize} bytes - consider splitting`);
    if (stats.libFiles === 0) findings.push('No lib/ directory found or empty');
    if (stats.publicFiles === 0) findings.push('No public/ files found');

    if (stats.hasServer) suggestions.push('Server file exists - check for memory leaks and error handling');
    if (stats.dependenciesCount === 0) suggestions.push('No dependencies - verify package.json');

    // Check for common files
    const checks = [
      { file: 'README.md', important: true },
      { file: '.gitignore', important: true },
      { file: 'Dockerfile', important: false },
      { file: 'render.yaml', important: false },
      { file: 'server.js', important: true }
    ];

    const fileChecks = checks.map(c => {
      const info = this.fsTools.getFileInfo(c.file);
      return { file: c.file, exists: info.success, important: c.important, size: info.success ? info.size : 0 };
    });

    const missingImportant = fileChecks.filter(f => f.important && !f.exists).map(f => f.file);
    if (missingImportant.length) findings.push(`Missing important files: ${missingImportant.join(', ')}`);

    return {
      success: true,
      stats,
      fileChecks,
      findings,
      suggestions,
      summary: `Project has ${stats.rootFiles} root entries, ${stats.dependenciesCount} deps, server ${stats.hasServer ? 'present' : 'missing'}`
    };
  }

  inspectDependencies() {
    const pkgRes = this.fsTools.readFile('package.json');
    const findings = [];
    const suggestions = [];
    let pkg = null;

    if (!pkgRes.success) {
      return { success: false, error: 'package.json not found', findings: ['package.json missing'], suggestions: ['Create package.json'] };
    }

    try {
      pkg = JSON.parse(pkgRes.content);
    } catch (e) {
      return { success: false, error: 'Invalid package.json', findings: ['package.json parse error'], suggestions: ['Fix package.json JSON'] };
    }

    const deps = Object.keys(pkg.dependencies || {});
    const devDeps = Object.keys(pkg.devDependencies || {});

    // Check for heavy dependencies
    const heavy = ['puppeteer', 'playwright', 'sharp', 'canvas', 'bcrypt'];
    const foundHeavy = deps.filter(d => heavy.includes(d));
    if (foundHeavy.length) findings.push(`Heavy dependencies found: ${foundHeavy.join(', ')} - may cause memory issues`);

    // Check for outdated patterns
    if (deps.includes('nodemailer') && !pkg.dependencies.nodemailer.match(/^\^?10/)) {
      findings.push('nodemailer version may be outdated');
    }

    // Check engines
    if (!pkg.engines || !pkg.engines.node) {
      findings.push('No Node.js engine specified in package.json');
      suggestions.push('Add engines.node to package.json for consistent runtime');
    }

    // Check scripts
    const scripts = Object.keys(pkg.scripts || {});
    if (!scripts.includes('start')) findings.push('No start script in package.json');
    if (!scripts.includes('test')) suggestions.push('Add test script');

    return {
      success: true,
      packageName: pkg.name,
      version: pkg.version,
      dependencies: deps,
      devDependencies: devDeps,
      depCount: deps.length,
      devDepCount: devDeps.length,
      heavyDeps: foundHeavy,
      hasEngines: !!pkg.engines,
      scripts,
      findings,
      suggestions
    };
  }

  inspectServer() {
    const findings = [];
    const suggestions = [];
    const serverRes = this.fsTools.readFile('server.js');

    if (!serverRes.success) {
      return { success: false, error: serverRes.error, findings: ['server.js not found'], suggestions: [] };
    }

    const content = serverRes.content;

    // Check for memory leak patterns
    if (content.includes('setInterval') && !content.includes('clearInterval')) {
      findings.push('setInterval without clearInterval - potential memory leak');
      suggestions.push('Ensure all intervals are cleared on shutdown');
    }
    if (content.match(/\.on\(.*\)/g)?.length > 20) {
      findings.push('Many event listeners - check for listener leaks');
    }
    if (content.includes('global.') || content.includes('globalThis')) {
      findings.push('Global variables used - may cause memory retention');
    }
    if (content.includes('cache') && content.toLowerCase().includes('map')) {
      const cacheMatches = content.match(/new Map\(\)|new Set\(\)|\{\}/g);
      if (cacheMatches && cacheMatches.length > 5) findings.push('Multiple caches/maps without eviction - possible memory leak');
    }
    if (!content.includes('process.on(\'SIGINT\'') && !content.includes('process.on("SIGINT"')) {
      findings.push('No SIGINT handler - may not cleanup on shutdown');
      suggestions.push('Add graceful shutdown handler');
    }
    if (content.includes('console.log') && (content.match(/console\.log/g) || []).length > 20) {
      findings.push('Many console.log statements - may impact performance');
    }

    // Security checks
    if (content.includes('process.env') && content.includes('console.log')) {
      findings.push('Potential credential exposure via console.log of env');
      suggestions.push('Remove env logging in production');
    }

    // Check for large file handling
    if (content.includes('fs.readFileSync') && content.includes('server.js')) {
      findings.push('Sync file reads in server - may block event loop');
    }

    // Check lib files
    const libList = this.fsTools.listDir('lib');
    let libFindings = [];
    if (libList.success) {
      for (const entry of libList.entries.slice(0, 10)) {
        if (entry.isFile) {
          const fileRes = this.fsTools.readFile(`lib/${entry.name}`);
          if (fileRes.success) {
            const fc = fileRes.content;
            if (fc.length > 50000) libFindings.push(`Large file lib/${entry.name}: ${fc.length} bytes`);
            if (fc.includes('setInterval') && !fc.includes('clearInterval')) libFindings.push(`Potential interval leak in lib/${entry.name}`);
          }
        }
      }
    }

    findings.push(...libFindings);

    // Overall health
    const sizeKB = Math.round(content.length / 1024);
    const health = findings.length === 0 ? 'GOOD' : findings.length < 3 ? 'WARNING' : 'NEEDS_ATTENTION';

    return {
      success: true,
      size: content.length,
      sizeKB,
      lines: content.split('\n').length,
      findings,
      suggestions,
      health,
      summary: `server.js: ${sizeKB}KB, ${findings.length} potential issues, health: ${health}`
    };
  }

  inspectForBugs() {
    const findings = [];
    const suggestions = [];

    // Check common bug patterns in lib/
    const libList = this.fsTools.listDir('lib');
    if (libList.success) {
      for (const entry of libList.entries) {
        if (!entry.isFile) continue;
        const res = this.fsTools.readFile(entry.path);
        if (!res.success) continue;
        const c = res.content;
        // Common bugs
        if (c.includes('==') && !c.includes('===') && !c.includes('!=') ) {
          // naive check
        }
        if (c.match(/catch\s*\(\s*\)/) || c.match(/catch\s*\(\s*_\s*\)\s*\{\s*\}/)) {
          findings.push(`Empty catch block in ${entry.path} - hides errors`);
        }
        if (c.includes('TODO') || c.includes('FIXME')) {
          const todos = (c.match(/TODO|FIXME/g) || []).length;
          findings.push(`${todos} TODO/FIXME in ${entry.path}`);
        }
        if (c.includes('process.exit') && entry.path !== 'server.js') {
          findings.push(`process.exit in ${entry.path} - may cause abrupt shutdown`);
        }
      }
    }

    // Check public/ for issues
    const publicList = this.fsTools.listDir('public');
    if (publicList.success) {
      const htmlFiles = publicList.entries.filter(e => e.name.endsWith('.html'));
      if (htmlFiles.length > 15) findings.push(`Many HTML files: ${htmlFiles.length} - check for duplication`);
    }

    return {
      success: true,
      findings,
      suggestions,
      checkedFiles: libList.success ? libList.count : 0
    };
  }

  runSyntaxCheck() {
    // Use node --check for JS files
    const { execSync } = require('child_process');
    const results = [];
    try {
      const filesToCheck = ['server.js', 'lib/api.js', 'lib/db.js', 'lib/auth.js'];
      for (const file of filesToCheck) {
        const info = this.fsTools.getFileInfo(file);
        if (!info.success) continue;
        try {
          execSync(`node --check ${path.join(this.root, file)}`, { stdio: 'pipe' });
          results.push({ file, ok: true });
        } catch (e) {
          results.push({ file, ok: false, error: e.message.slice(0, 200) });
        }
      }
      return {
        success: results.every(r => r.ok),
        results,
        findings: results.filter(r => !r.ok).map(r => `Syntax error in ${r.file}: ${r.error}`),
        suggestions: results.some(r => !r.ok) ? ['Fix syntax errors'] : []
      };
    } catch (err) {
      return { success: false, error: err.message, results, findings: [err.message], suggestions: [] };
    }
  }

  // Full inspection combining all
  fullInspection() {
    const structure = this.inspectStructure();
    const deps = this.inspectDependencies();
    const server = this.inspectServer();
    const bugs = this.inspectForBugs();
    const syntax = this.runSyntaxCheck();

    const allFindings = [
      ...(structure.findings || []),
      ...(deps.findings || []),
      ...(server.findings || []),
      ...(bugs.findings || [])
    ];

    const allSuggestions = [
      ...(structure.suggestions || []),
      ...(deps.suggestions || []),
      ...(server.suggestions || []),
      ...(bugs.suggestions || [])
    ];

    const critical = allFindings.filter(f => f.toLowerCase().includes('leak') || f.toLowerCase().includes('credential') || f.toLowerCase().includes('exposure'));

    return {
      success: true,
      timestamp: new Date().toISOString(),
      project: structure.stats?.packageName || 'unknown',
      health: critical.length > 0 ? 'CRITICAL' : allFindings.length > 5 ? 'WARNING' : 'GOOD',
      summary: {
        totalFindings: allFindings.length,
        critical: critical.length,
        suggestions: allSuggestions.length,
        syntaxOk: syntax.success
      },
      sections: {
        structure,
        dependencies: deps,
        server,
        bugs,
        syntax
      },
      findings: allFindings,
      criticalFindings: critical,
      suggestions: allSuggestions,
      report: this.generateTextReport(structure, deps, server, bugs, syntax, allFindings, allSuggestions)
    };
  }

  generateTextReport(structure, deps, server, bugs, syntax, findings, suggestions) {
    return `
=== SP SAARTHI PROJECT INSPECTION REPORT ===
Generated: ${new Date().toISOString()}
Project: ${structure.stats?.packageName || 'Panika Jeevan Sathi / TalkoraA'}

--- STRUCTURE ---
${structure.summary || 'No summary'}
Files checked: ${structure.fileChecks?.map(f => `${f.file}: ${f.exists ? 'OK' : 'MISSING'}`).join(', ')}

--- DEPENDENCIES ---
Deps: ${deps.depCount || 0}, DevDeps: ${deps.devDepCount || 0}
Heavy: ${deps.heavyDeps?.join(', ') || 'none'}

--- SERVER ---
${server.summary || ''}
Health: ${server.health}
Size: ${server.sizeKB}KB, Lines: ${server.lines}

--- SYNTAX ---
${syntax.results?.map(r => `${r.file}: ${r.ok ? 'OK' : 'FAIL'}`).join('\n') || 'No checks'}

--- FINDINGS (${findings.length}) ---
${findings.map((f, i) => `${i + 1}. ${f}`).join('\n') || 'No issues found'}

--- SUGGESTIONS (${suggestions.length}) ---
${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n') || 'No suggestions'}

--- CONCLUSION ---
Health: ${findings.length === 0 ? 'GOOD - No major issues' : findings.length < 3 ? 'WARNING - Minor issues' : 'NEEDS_ATTENTION - Multiple issues found'}
Critical issues: ${findings.filter(f => f.toLowerCase().includes('leak') || f.toLowerCase().includes('credential')).length}

=== END REPORT ===
`.trim();
  }
}

module.exports = { ProjectInspector };
