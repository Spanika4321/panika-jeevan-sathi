# BATCH-01 / T-01 — raw execution log
executor : arena-coordinator-sandbox (linux/x64, node v22.22.3)
head     : 62c68d53eb7cf6b6c7ae8c46a10e6fc932c304e5
objective: Produce the device's real capability record: Node version (must be >= 22.5 for node:sqlite, otherwise the JSON store fallback is the only supported mode), git and curl presence, free disk, current HEAD and branch, worktree cleanliness, the public/ UI file count and fingerprint, and whether the production hosts answer from this network. No check may be assumed; every line must come from a command that ran.
verdict  : PASS

$ node scripts/termux-batch.mjs preflight --json
(exit 0, 267ms)
--- stdout ---
{
  "protocol": "arena-termux-batch/1",
  "runner_version": "1.0.0",
  "generated_at": "2026-08-31T18:57:12.438Z",
  "executor": {
    "id": "arena-coordinator-sandbox",
    "hostname": "e2b.local",
    "platform": "linux",
    "arch": "x64",
    "release": "6.1.158+",
    "node": "v22.22.3",
    "node_ok_22_5": true,
    "npm": "10.9.8",
    "git": "git version 2.39.5",
    "curl": "curl 7.88.1 (x86_64-pc-linux-gnu) libcurl/7.88.1 OpenSSL/3.0.20 zlib/1.2.13 brot",
    "python": "Python 3.11.2",
    "uname": "Linux e2b.local 6.1.158+ #1 SMP PREEMPT_DYNAMIC Mon May 11 18:48:24 UTC 2026 x86_64 GNU/Linux",
    "shell": "/bin/bash",
    "termux_detected": false,
    "termux_android_release": null,
    "cwd": "/home/user/panika-jeevan-sathi",
    "git_head": "62c68d53eb7cf6b6c7ae8c46a10e6fc932c304e5",
    "git_branch": "arena/01a0591c-panika-jeevan-sathi",
    "tree_dirty": false,
    "disk_free_mb": 19733,
    "cpus": 2,
    "mem_total_mb": 3940,
    "public_ui_fingerprint": "5469d2287361f57f84cca9a587b29025a6dc955d0fed79cbaa091a3975ecb531",
    "public_ui_files": 25
  },
  "git_head_short": "62c68d53eb7c",
  "missing_files": [],
  "live_probes": [
    {
      "url": "https://panikajeevansathi.onrender.com/api/health",
      "http_code": 0,
      "time_total_s": null,
      "error": "Command failed: curl -sS -o /dev/null --max-time 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.onrender.com/api/health\ncurl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in con"
    },
    {
      "url": "https://panikajeevansathi.onrender.com/",
      "http_code": 0,
      "time_total_s": null,
      "error": "Command failed: curl -sS -o /dev/null --max-time 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.onrender.com/\ncurl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to"
    },
    {
      "url": "https://panikajeevansathi.coolstore.in/",
      "http_code": 0,
      "time_total_s": null,
      "error": "Command failed: curl -sS -o /dev/null --max-time 20 -w %{http_code} %{time_total} %{errormsg} https://panikajeevansathi.coolstore.in/\ncurl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to"
    }
  ],
  "capability": {
    "node_ge_22_5_sqlite": true,
    "sqlite_fallback": "PJS_STORAGE=json works on Node < 22.5",
    "git": true,
    "curl": true,
    "disk_ok": true
  },
  "notes": [
    "Read-only probe. No deploy, no git push, no database change, no credential read.",
    "A live host that is unreachable here must be reported BLOCKED with the exact error — never PASS."
  ]
}

--- stderr ---
(none)
