#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TAG_RE = /^(?:desktop-)?v(\d+)\.(\d+)\.(\d+)$/;
const BREAKING_HEADER_RE = /^[a-z]+(?:\([^)]+\))?!:/i;
const FEAT_HEADER_RE = /^feat(?:\([^)]+\))?:/i;
const FIX_HEADER_RE = /^fix(?:\([^)]+\))?:/i;

export function parseSemverTag(tag) {
  const m = TAG_RE.exec(String(tag || '').trim());
  if (!m) return null;
  return {
    tag: String(tag).trim(),
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

export function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function findLatestSemverTag(tags) {
  const parsed = tags.map(parseSemverTag).filter(Boolean);
  if (!parsed.length) return null;
  parsed.sort((a, b) => compareSemver(b, a));
  return parsed[0];
}

export function determineBump(commits) {
  let bump = 'patch';
  for (const c of commits) {
    const subject = String(c.subject || '').trim();
    const body = String(c.body || '');
    if (BREAKING_HEADER_RE.test(subject) || /(?:^|\n)BREAKING[ -]CHANGE:/i.test(body)) {
      return 'major';
    }
    if (FEAT_HEADER_RE.test(subject)) {
      bump = 'minor';
    }
  }
  return bump;
}

export function bumpSemver(base, bump) {
  const start = base ?? { major: 0, minor: 1, patch: 0 };
  if (bump === 'major') return { major: start.major + 1, minor: 0, patch: 0 };
  if (bump === 'minor') return { major: start.major, minor: start.minor + 1, patch: 0 };
  return { major: start.major, minor: start.minor, patch: start.patch + 1 };
}

export function formatVersion(v) {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export function buildReleaseNotes(commits, prevTag, nextTag) {
  const breaking = [];
  const features = [];
  const fixes = [];
  const other = [];

  for (const c of commits) {
    const subject = String(c.subject || '').trim();
    const body = String(c.body || '');
    const shortSha = String(c.sha || '').slice(0, 7);
    const line = shortSha ? `- ${subject} (\`${shortSha}\`)` : `- ${subject}`;
    if (!subject) continue;
    if (BREAKING_HEADER_RE.test(subject) || /(?:^|\n)BREAKING[ -]CHANGE:/i.test(body)) {
      breaking.push(line);
    } else if (FEAT_HEADER_RE.test(subject)) {
      features.push(line);
    } else if (FIX_HEADER_RE.test(subject)) {
      fixes.push(line);
    } else {
      other.push(line);
    }
  }

  const sections = [];
  if (breaking.length) sections.push(`### Breaking Changes\n${breaking.join('\n')}`);
  if (features.length) sections.push(`### Features\n${features.join('\n')}`);
  if (fixes.length) sections.push(`### Fixes\n${fixes.join('\n')}`);
  if (other.length) sections.push(`### Other Changes\n${other.join('\n')}`);

  if (!sections.length) {
    sections.push(`Release \`${nextTag}\`.`);
  }
  if (prevTag) {
    sections.push(`**Previous release:** \`${prevTag}\``);
  }
  return sections.join('\n\n') + '\n';
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function readCommitsSince(prevTag) {
  const range = prevTag ? `${prevTag}..HEAD` : 'HEAD';
  const raw = git(['log', range, '--format=%H%x1f%s%x1f%b%x1e']);
  const commits = [];
  for (const rec of raw.split('\x1e')) {
    const trimmed = rec.trim();
    if (!trimmed) continue;
    const [sha = '', subject = '', body = ''] = trimmed.split('\x1f');
    commits.push({ sha: sha.trim(), subject: subject.trim(), body: body.trim() });
  }
  return commits;
}

function main() {
  const args = process.argv.slice(2);
  let githubOutput = '';
  let notesFile = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--github-output' && args[i + 1]) githubOutput = args[++i];
    else if (args[i] === '--notes-file' && args[i + 1]) notesFile = args[++i];
  }

  const tags = git(['tag', '--list']).split('\n').map(s => s.trim()).filter(Boolean);
  const latest = findLatestSemverTag(tags);
  const commits = readCommitsSince(latest?.tag ?? null);
  const bump = determineBump(commits);
  const next = bumpSemver(latest, bump);
  const version = formatVersion(next);
  const tag = `v${version}`;
  const notes = buildReleaseNotes(commits, latest?.tag ?? null, tag);

  if (notesFile) {
    writeFileSync(notesFile, notes, 'utf8');
  }
  if (githubOutput) {
    appendFileSync(
      githubOutput,
      `version=${version}\ntag=${tag}\nbump=${bump}\nprevious_tag=${latest?.tag ?? ''}\n`,
      'utf8'
    );
  } else {
    console.log(JSON.stringify({ version, tag, bump, previousTag: latest?.tag ?? null, commitCount: commits.length }, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
