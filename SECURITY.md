# Security policy

## Supported versions

This project is pre-1.0. Only the latest `main` branch receives security fixes.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email: **rubenchch21@gmail.com** with the subject line `[financial-coach] security`.

Include:

- A description of the issue and its impact.
- Steps to reproduce (proof-of-concept welcome).
- Any suggested remediation.

If you would like your report encrypted, ask for a PGP key in your first email.

### What to expect

- **72 hours**: acknowledgment of your report.
- **7 days**: initial triage and severity assessment.
- **30 days** (typical): fix released, with public disclosure coordinated with you.

For critical issues (remote code execution, credential exfiltration, encryption bypass), we aim to turn around a fix in under 7 days.

## Scope

In scope:

- The application code in this repository.
- The scripts and launchers that ship with it.
- Default configuration choices that weaken security.

Out of scope:

- Third-party services (GoCardless, Ollama, Anthropic, OpenAI, Google) — report those directly to the vendors.
- Self-inflicted issues: running with `HOST=0.0.0.0` on an untrusted network, committing `.env.local`, using an easily-guessed PIN. We try to make these hard to do by accident; we cannot prevent them entirely.

## Recognition

Reporters who follow this policy in good faith will be credited (with their consent) in the release notes of the fix.
