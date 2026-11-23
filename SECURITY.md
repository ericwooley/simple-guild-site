# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Band of the Helping Hand, please **do not** open a public issue or pull request. Instead, report it privately via GitHub Security Advisories (`Security` → `Report a vulnerability`) or contact the repository maintainer directly.

## Repository Security Controls

- All GitHub Actions workflows run only on `main` pushes or manual dispatch (never `pull_request_target`) and pin third-party actions to full commit SHAs.
- External fork pull requests require maintainer approval before running workflows.
- Branch protection on `main` blocks force-pushes, deletions, and unapproved merges.
- Secret scanning and push protection are enabled on the repository.
