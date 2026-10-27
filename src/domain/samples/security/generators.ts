/**
 * Per-source backdated event generators for the AI Investigator security demo.
 *
 * Five correlated feeds model a supply-chain compromise (malicious MCP server).
 * Everything is deterministic from `(seed, windowHours, anchorSec)` so every feed
 * reconstructs the SAME shared entities and the SAME attack timestamps — that
 * cross-feed alignment is what lets the investigator correlate by user / host /
 * ip / time. Design rules (per realism guidance):
 *   - majority-benign background; the attack is a small minority
 *   - causal chains joined by shared entities + timestamps
 *     (install -> file read -> DNS -> firewall egress -> token use)
 *   - operational imperfections: clock skew, occasional missing fields + dups
 *   - realistic distributions: business-hours logins, long-tail DNS
 *   - NO over-signaling labels (no `malicious`, `threat`, `ioc` fields)
 *   - backdated top-level `_time` (epoch seconds) across the window with jitter
 *
 * The private ground-truth manifest is NEVER serialized into events.
 */

import {
  HOUR,
  buildEnvironment,
  buildGroundTruth,
  makeRng,
  type Developer,
  type Environment,
  type GroundTruth,
  type Rng,
} from './environment';

export type SecurityFeed = 'endpoint' | 'dns' | 'firewall' | 'identity' | 'vcs';

export const SECURITY_FEEDS: SecurityFeed[] = [
  'endpoint',
  'dns',
  'firewall',
  'identity',
  'vcs',
];

type Event = Record<string, unknown>;

/** Round to millisecond-precision epoch seconds, as Cribl stores `_time`. */
function t(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

/**
 * Background event count for one developer, scaled to the window length so a
 * 90-day archive doesn't look sparse, but clamped so ingest stays bounded.
 */
function bgCount(rng: Rng, truth: GroundTruth, perDay: number, min: number, max: number): number {
  const days = Math.max(1, (truth.windowEnd - truth.windowStart) / (24 * HOUR));
  const target = Math.min(max, Math.max(min, Math.round(days * perDay)));
  return rng.int(Math.round(target * 0.8), Math.round(target * 1.2));
}

/** Business-hours-weighted timestamp within [start, end] (epoch seconds). */
function businessTime(rng: Rng, start: number, end: number): number {
  for (let i = 0; i < 6; i += 1) {
    const ts = start + rng.next() * (end - start);
    const hod = ((Math.floor(ts / HOUR) % 24) + 24) % 24;
    const weight = hod >= 8 && hod <= 19 ? 1 : 0.12;
    if (rng.next() < weight) return ts;
  }
  return start + rng.next() * (end - start);
}

/** Per-developer install time for the trojan, staggered across the attack band. */
interface Install {
  dev: Developer;
  installTime: number;
  /** Higher for patient zero → more files read + more egress. */
  intensity: number;
}

function planInstalls(env: Environment, truth: GroundTruth, rng: Rng): Install[] {
  const band = truth.attackEnd - truth.attackStart;
  return env.compromised.map((dev, i) => ({
    dev,
    // Patient zero installs first; others fan out over the first ~half of the band.
    installTime:
      truth.attackStart + (i === 0 ? band * 0.05 : band * (0.2 + rng.next() * 0.45)),
    intensity: i === 0 ? 1 : 0.45 + rng.next() * 0.3,
  }));
}

/* --------------------------------- endpoint -------------------------------- */
/** EDR file/process activity (OCSF-ish). Benign dev tooling + the trojan reads. */
function generateEndpoint(
  env: Environment,
  truth: GroundTruth,
  installs: Install[],
  rng: Rng,
): Event[] {
  const events: Event[] = [];
  const benignParents = ['zsh', 'bash', 'git', 'node', 'Code Helper', 'Cursor Helper', 'aws', 'gh', 'docker'];
  const benignProcs = ['git', 'node', 'npm', 'python3.11', 'docker', 'clang', 'go', 'rg', 'esbuild'];
  const benignFiles = [
    '~/src/order-api/package.json',
    '~/src/checkout/src/index.ts',
    '~/go/pkg/mod/cache/lock',
    '/tmp/build-cache/artifact.tar',
    '~/Library/Caches/pip/wheels/x.whl',
    '~/src/storefront/node_modules/.package-lock.json',
  ];

  // Benign background: routine process + file events for every developer.
  for (const dev of env.developers) {
    const n = bgCount(rng, truth, 5, 30, 180);
    for (let i = 0; i < n; i += 1) {
      const ts = businessTime(rng, truth.windowStart, truth.windowEnd);
      const isFile = rng.chance(0.55);
      const proc = rng.pick(benignProcs);
      const ev: Event = {
        _time: t(ts + rng.jitter(1.5)),
        event_type: isFile ? 'file' : 'process',
        host: dev.host,
        user: dev.user,
        src_ip: dev.ip,
        process_name: proc,
        parent_process: rng.pick(benignParents),
        pid: rng.int(300, 65000),
        os: dev.os,
      };
      if (isFile) {
        ev.file_path = rng.pick(benignFiles);
        ev.action = rng.pick(['open', 'read', 'write']);
      } else {
        ev.cmdline = `${proc} ${rng.pick(['build', 'test', 'run', 'status', 'pull', 'install'])}`;
        ev.action = 'exec';
        ev.ppid = rng.int(300, 65000);
      }
      events.push(ev);
    }
  }

  // Benign-but-sensitive reads: legitimate tools touching credential files during
  // normal work. This is why 11 users "touched" sensitive files but only 4 hosts
  // are compromised — the differentiator is the PARENT process, not the file.
  for (const user of truth.sensitiveFileUsers) {
    const dev = env.developers.find((d) => d.user === user);
    if (!dev) continue;
    const legitTool = rng.pick([
      { proc: 'aws', parent: 'zsh', file: '~/.aws/credentials' },
      { proc: 'gh', parent: 'zsh', file: '~/.config/gh/hosts.yml' },
      { proc: 'git', parent: 'zsh', file: '~/.git-credentials' },
      { proc: 'npm', parent: 'node', file: '~/.npmrc' },
      { proc: 'docker', parent: 'zsh', file: '~/.docker/config.json' },
    ]);
    const reads = rng.int(1, 3);
    for (let i = 0; i < reads; i += 1) {
      events.push({
        _time: t(businessTime(rng, truth.windowStart, truth.windowEnd)),
        event_type: 'file',
        host: dev.host,
        user: dev.user,
        src_ip: dev.ip,
        process_name: legitTool.proc,
        parent_process: legitTool.parent,
        file_path: legitTool.file,
        action: 'read',
        pid: rng.int(300, 65000),
        os: dev.os,
      });
    }
  }

  // Attack: postinstall.js (run by node, parent npm) reads the token/credential
  // files shortly after install. Patient zero reads the most files.
  for (const { dev, installTime, intensity } of installs) {
    const fileCount = Math.max(3, Math.round(env.sensitiveFiles.length * intensity));
    const files = env.sensitiveFiles.slice(0, fileCount);
    // The install itself: npm exec + postinstall spawn.
    events.push({
      _time: t(installTime + rng.jitter(0.8)),
      event_type: 'process',
      host: dev.host,
      user: dev.user,
      src_ip: dev.ip,
      process_name: 'node',
      parent_process: 'npm',
      cmdline: `node ${env.malicious.postInstallScript}`,
      action: 'exec',
      pid: rng.int(300, 65000),
      ppid: rng.int(300, 65000),
      os: dev.os,
    });
    files.forEach((file, i) => {
      events.push({
        _time: t(installTime + 5 + i * rng.float(2, 9) + rng.jitter(0.5)),
        event_type: 'file',
        host: dev.host,
        user: dev.user,
        src_ip: dev.ip,
        process_name: 'node',
        parent_process: env.malicious.postInstallScript.split('/').pop(),
        file_path: file,
        action: 'read',
        pid: rng.int(300, 65000),
        os: dev.os,
      });
    });
  }

  return finalize(events, rng);
}

/* ------------------------------------ dns ---------------------------------- */
/** Resolver query logs. Long-tail benign + C2 lookups from compromised hosts. */
function generateDns(
  env: Environment,
  truth: GroundTruth,
  installs: Install[],
  rng: Rng,
): Event[] {
  const events: Event[] = [];
  const qtypes = ['A', 'A', 'A', 'AAAA', 'HTTPS', 'CNAME', 'TXT'];

  for (const dev of env.developers) {
    const n = bgCount(rng, truth, 7, 50, 240);
    for (let i = 0; i < n; i += 1) {
      const ts = businessTime(rng, truth.windowStart, truth.windowEnd);
      const domain = rng.pick(env.benignDomains);
      const nx = rng.chance(0.05);
      const ev: Event = {
        _time: t(ts + rng.jitter(1)),
        host: dev.host,
        client_ip: dev.ip,
        src_ip: dev.ip,
        user: dev.user,
        query: domain,
        domain,
        qtype: rng.pick(qtypes),
        rcode: nx ? 'NXDOMAIN' : 'NOERROR',
        resolver: rng.pick(env.dnsResolvers),
      };
      // Missing answer on NXDOMAIN is realistic; also occasionally drop it.
      if (!nx && rng.chance(0.9)) ev.answer = `${rng.int(1, 223)}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`;
      events.push(ev);
    }
  }

  // Attack: compromised hosts resolve the C2 domains shortly after file reads.
  for (const { dev, installTime, intensity } of installs) {
    const lookups = Math.max(2, Math.round(env.c2.length * (0.6 + intensity)));
    for (let i = 0; i < lookups; i += 1) {
      const node = env.c2[i % env.c2.length];
      events.push({
        _time: t(installTime + 30 + i * rng.float(8, 40) + rng.jitter(1)),
        host: dev.host,
        client_ip: dev.ip,
        src_ip: dev.ip,
        user: dev.user,
        query: node.domain,
        domain: node.domain,
        qtype: 'A',
        rcode: 'NOERROR',
        answer: node.ip,
        resolver: rng.pick(env.dnsResolvers),
      });
    }
  }

  return finalize(events, rng);
}

/* --------------------------------- firewall -------------------------------- */
/** Egress firewall/proxy logs. Normal allows + the C2 exfil byte spike. */
function generateFirewall(
  env: Environment,
  truth: GroundTruth,
  installs: Install[],
  rng: Rng,
): Event[] {
  const events: Event[] = [];

  for (const dev of env.developers) {
    const n = bgCount(rng, truth, 8, 60, 260);
    for (let i = 0; i < n; i += 1) {
      const ts = businessTime(rng, truth.windowStart, truth.windowEnd);
      const dst = rng.pick(env.benignEgress);
      const deny = rng.chance(0.04);
      const ev: Event = {
        _time: t(ts + rng.jitter(1)),
        device: env.egressFirewall,
        user: dev.user,
        host: dev.host,
        src_ip: dev.ip,
        src_port: rng.int(49152, 65535),
        dest_ip: dst.ip,
        dest_port: rng.chance(0.85) ? 443 : rng.pick([80, 22, 8443, 3128]),
        protocol: 'tcp',
        app: rng.chance(0.85) ? 'ssl' : rng.pick(['web-browsing', 'ssh', 'git']),
        action: deny ? 'deny' : 'allow',
        dest_country: dst.country,
        asn_org: dst.asnOrg,
        rule: deny ? 'default-deny' : rng.pick(['allow-saas', 'allow-dev-egress', 'allow-web']),
        bytes_out: rng.int(400, 60000),
      };
      if (!deny && rng.chance(0.92)) ev.bytes_in = rng.int(600, 250000);
      events.push(ev);
    }
  }

  // Attack: HTTPS egress to the C2 IPs with an exfil byte spike, right after the
  // C2 DNS lookups. Bytes_out is elevated but plausible (archived creds upload).
  for (const { dev, installTime, intensity } of installs) {
    const sessions = Math.max(2, Math.round(env.c2.length * (0.7 + intensity)));
    for (let i = 0; i < sessions; i += 1) {
      const node = env.c2[i % env.c2.length];
      events.push({
        _time: t(installTime + 45 + i * rng.float(20, 120) + rng.jitter(1.5)),
        device: env.egressFirewall,
        user: dev.user,
        host: dev.host,
        src_ip: dev.ip,
        src_port: rng.int(49152, 65535),
        dest_ip: node.ip,
        dest_port: 443,
        protocol: 'tcp',
        app: 'ssl',
        action: 'allow',
        dest_country: node.country,
        asn_org: node.asnOrg,
        rule: 'allow-dev-egress',
        bytes_out: Math.round(rng.int(180000, 900000) * intensity),
        bytes_in: rng.int(400, 4000),
      });
    }
  }

  return finalize(events, rng);
}

/* --------------------------------- identity -------------------------------- */
/** Okta identity logs. Daily MFA logins + suspicious token use post-compromise. */
function generateIdentity(
  env: Environment,
  truth: GroundTruth,
  installs: Install[],
  rng: Rng,
): Event[] {
  const events: Event[] = [];
  const apps = ['AWS SSO', 'GitHub', 'Google Workspace', 'Datadog', 'Slack', 'Snowflake'];

  for (const dev of env.developers) {
    const days = Math.ceil((truth.windowEnd - truth.windowStart) / (24 * HOUR));
    for (let d = 0; d < days; d += 1) {
      const logins = rng.int(1, 3);
      for (let i = 0; i < logins; i += 1) {
        const dayStart = truth.windowEnd - (d + 1) * 24 * HOUR;
        const ts = businessTime(rng, dayStart, dayStart + 24 * HOUR);
        if (ts < truth.windowStart || ts > truth.windowEnd) continue;
        events.push({
          _time: t(ts),
          event_type: 'user.session.start',
          user: dev.user,
          actor: dev.email,
          result: rng.chance(0.03) ? 'FAILURE' : 'SUCCESS',
          src_ip: rng.chance(0.7) ? dev.ip : publicIp(rng),
          country: dev.homeCountry,
          app: rng.pick(apps),
          mfa_factor: rng.pick(['okta_verify_push', 'webauthn', 'totp']),
          auth_method: 'mfa',
        });
      }
    }
  }

  // Attack: stolen tokens → new Okta API token creation + use from foreign IPs,
  // hours after exfil. Patient zero shows the clearest sequence.
  for (const { dev, installTime, intensity } of installs) {
    const node = rng.pick(env.c2);
    const created = installTime + rng.float(0.5, 3) * HOUR;
    events.push({
      _time: t(created),
      event_type: 'system.api_token.create',
      user: dev.user,
      actor: dev.email,
      result: 'SUCCESS',
      src_ip: node.ip,
      country: node.country,
      app: 'Okta API',
      auth_method: 'api_token',
    });
    const uses = Math.max(1, Math.round(3 * intensity));
    for (let i = 0; i < uses; i += 1) {
      events.push({
        _time: t(created + (i + 1) * rng.float(3, 20) * 60),
        event_type: 'system.api_token.use',
        user: dev.user,
        actor: dev.email,
        result: 'SUCCESS',
        src_ip: node.ip,
        country: node.country,
        app: rng.pick(['AWS SSO', 'GitHub', 'Snowflake']),
        auth_method: 'api_token',
      });
    }
  }

  return finalize(events, rng);
}

/* ------------------------------------ vcs ---------------------------------- */
/** GitHub / package audit logs. Normal repo activity + the malicious install. */
function generateVcs(
  env: Environment,
  truth: GroundTruth,
  installs: Install[],
  rng: Rng,
): Event[] {
  const events: Event[] = [];
  const internalRepos = [
    `${env.githubOrg}/order-api`,
    `${env.githubOrg}/checkout-payments`,
    `${env.githubOrg}/inventory-sync`,
    `${env.githubOrg}/storefront-web`,
    `${env.githubOrg}/data-pipelines`,
  ];
  const popularPkgs = ['react', 'express', 'zod', 'vite', 'typescript', 'axios', 'pytest', 'boto3'];

  for (const dev of env.developers) {
    const n = bgCount(rng, truth, 0.6, 8, 40);
    for (let i = 0; i < n; i += 1) {
      const ts = businessTime(rng, truth.windowStart, truth.windowEnd);
      const kind = rng.pick(['git.clone', 'git.push', 'package.install', 'repo.pull']);
      const ev: Event = {
        _time: t(ts),
        event_type: kind,
        action: kind,
        actor: dev.user,
        user: dev.user,
        host: dev.host,
        src_ip: dev.ip,
      };
      if (kind === 'package.install') {
        ev.package = rng.pick(popularPkgs);
        ev.registry = 'registry.npmjs.org';
      } else {
        ev.repo = rng.pick(internalRepos);
      }
      events.push(ev);
    }
  }

  // Attack: the compromised developers install the malicious package from GitHub.
  // A few OTHER developers browse/star the repo too (it looks popular) but never
  // run the install — so the repo is a lead, not proof by itself.
  const browsers = env.developers
    .slice(0, 9)
    .filter((d) => !installs.some((it) => it.dev.user === d.user));
  for (const dev of browsers) {
    events.push({
      _time: t(businessTime(rng, truth.attackStart - 12 * HOUR, truth.attackEnd)),
      event_type: 'repo.view',
      action: 'repo.view',
      actor: dev.user,
      user: dev.user,
      host: dev.host,
      src_ip: dev.ip,
      repo: env.malicious.repo,
      stars: env.malicious.stars,
    });
  }
  for (const { dev, installTime } of installs) {
    events.push({
      _time: t(installTime - rng.float(20, 90)),
      event_type: 'git.clone',
      action: 'git.clone',
      actor: dev.user,
      user: dev.user,
      host: dev.host,
      src_ip: dev.ip,
      repo: env.malicious.repo,
      stars: env.malicious.stars,
    });
    events.push({
      _time: t(installTime + rng.jitter(1)),
      event_type: 'package.install',
      action: 'package.install',
      actor: dev.user,
      user: dev.user,
      host: dev.host,
      src_ip: dev.ip,
      package: env.malicious.name,
      version: env.malicious.version,
      repo: env.malicious.repo,
      registry: 'github.com',
    });
  }

  return finalize(events, rng);
}

/* --------------------------------- helpers --------------------------------- */

function publicIp(rng: Rng): string {
  return `${rng.pick([24, 71, 98, 173, 208])}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`;
}

/**
 * Apply operational imperfections and return the event list: a few exact
 * duplicates (retransmits) and a light shuffle (out-of-order delivery). We do
 * NOT strictly time-sort — real ingest is not perfectly ordered.
 */
function finalize(events: Event[], rng: Rng): Event[] {
  const out = events.slice();
  const dupCount = Math.max(1, Math.floor(out.length * 0.006));
  for (let i = 0; i < dupCount; i += 1) {
    out.push({ ...rng.pick(events) });
  }
  // Light Fisher-Yates-ish partial shuffle for realistic out-of-order arrival.
  for (let i = out.length - 1; i > 0; i -= 1) {
    if (rng.chance(0.35)) {
      const j = rng.int(Math.max(0, i - 4), i);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
  }
  return out;
}

const GENERATORS: Record<
  SecurityFeed,
  (env: Environment, truth: GroundTruth, installs: Install[], rng: Rng) => Event[]
> = {
  endpoint: generateEndpoint,
  dns: generateDns,
  firewall: generateFirewall,
  identity: generateIdentity,
  vcs: generateVcs,
};

/**
 * Authentic, operational-looking Cribl Lake dataset ids — deliberately NOT
 * `demo_`/`aisecurity`-prefixed so the AI Investigator (and an analyst) treats
 * them as genuine telemetry archives rather than a synthetic demo. Fixed (not
 * per-scenario) so redeploys are idempotent; cleanup keys off this exact list
 * (see resetService) since they don't carry the `demo_` sweep prefix.
 */
export const SECURITY_DATASET_ID: Record<SecurityFeed, string> = {
  endpoint: 'archive_edr',
  dns: 'archive_dns',
  firewall: 'archive_firewall',
  identity: 'archive_identity',
  vcs: 'archive_vcs',
};

/** Flat list of the security-demo Lake dataset ids, for teardown. */
export const SECURITY_DATASET_IDS: string[] = SECURITY_FEEDS.map((f) => SECURITY_DATASET_ID[f]);

export interface SecurityDatasetMeta {
  feed: SecurityFeed;
  /** The Cribl Lake dataset id this feed lands in. */
  datasetId: string;
  title: string;
  /** Rich description that drives AI Investigator dataset discovery. */
  description: string;
  /** Tags that help the investigator select the right datasets. */
  tags: string[];
}

export const SECURITY_DATASET_META: Record<SecurityFeed, SecurityDatasetMeta> = {
  endpoint: {
    feed: 'endpoint',
    datasetId: SECURITY_DATASET_ID.endpoint,
    title: 'Endpoint EDR (file & process)',
    description:
      'Endpoint detection & response file and process telemetry from developer macOS workstations. Fields: _time, host, user, process_name, parent_process, cmdline, file_path, action, pid. Use to see which process read which file on which host.',
    tags: ['security', 'edr', 'endpoint', 'process', 'filesystem', 'ocsf'],
  },
  dns: {
    feed: 'dns',
    datasetId: SECURITY_DATASET_ID.dns,
    title: 'DNS resolver logs',
    description:
      'Internal DNS resolver query logs for corporate workstations. Fields: _time, host, client_ip, src_ip, user, query, domain, qtype, rcode, answer, resolver. Use to see which host resolved which domain and the answer IP.',
    tags: ['security', 'dns', 'network', 'resolution'],
  },
  firewall: {
    feed: 'firewall',
    datasetId: SECURITY_DATASET_ID.firewall,
    title: 'Egress firewall / proxy',
    description:
      'Perimeter egress firewall and proxy connection logs with geo enrichment. Fields: _time, host, user, src_ip, dest_ip, src_port, dest_port, action, app, protocol, dest_country, asn_org, bytes_out, bytes_in. Use to see outbound connections, destination country, and data volume.',
    tags: ['security', 'firewall', 'network', 'egress', 'geo'],
  },
  identity: {
    feed: 'identity',
    datasetId: SECURITY_DATASET_ID.identity,
    title: 'Identity (Okta) logs',
    description:
      'Corporate identity provider (Okta) system and authentication logs. Fields: _time, user, actor, event_type, result, src_ip, country, app, mfa_factor, auth_method. Use to see logins, MFA, and API token creation/use, including from unexpected countries.',
    tags: ['security', 'identity', 'okta', 'authentication', 'iam'],
  },
  vcs: {
    feed: 'vcs',
    datasetId: SECURITY_DATASET_ID.vcs,
    title: 'Source control & package audit',
    description:
      'GitHub / package manager audit logs. Fields: _time, actor, user, host, src_ip, event_type, action, repo, package, version, stars, registry. Use to see repository clones and package installs, including third-party packages pulled from GitHub.',
    tags: ['security', 'vcs', 'github', 'supply-chain', 'package'],
  },
};

/**
 * Full incident dataset built once from a stable anchor. All feeds share the
 * same environment + timestamps so they correlate exactly.
 */
export interface IncidentData {
  env: Environment;
  truth: GroundTruth;
  feeds: Record<SecurityFeed, Event[]>;
}

export function buildIncidentData(
  seed: number,
  windowHours: number,
  anchorSec: number,
): IncidentData {
  const env = buildEnvironment(seed);
  const truth = buildGroundTruth(env, windowHours, anchorSec);
  // Dedicated RNG streams per feed (offset the seed) so adding/removing one feed
  // doesn't change the others, but everything stays deterministic.
  const installsRng = makeRng(seed ^ 0x9e3779b9);
  const installs = planInstalls(env, truth, installsRng);
  const feeds = {} as Record<SecurityFeed, Event[]>;
  SECURITY_FEEDS.forEach((feed, i) => {
    const rng = makeRng((seed ^ 0x85ebca6b) + i * 0x27d4eb2f);
    feeds[feed] = GENERATORS[feed](env, truth, installs, rng);
  });
  return { env, truth, feeds };
}

/**
 * Generate one feed's backdated events as NDJSON lines (one JSON object per
 * line). Deterministic given the same `(seed, windowHours, anchorSec)`.
 */
export function generateSecurityFeed(
  seed: number,
  windowHours: number,
  anchorSec: number,
  feed: SecurityFeed,
): string[] {
  const { feeds } = buildIncidentData(seed, windowHours, anchorSec);
  return feeds[feed].map((e) => JSON.stringify(e));
}
