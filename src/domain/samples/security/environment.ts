/**
 * Environment model for the AI Investigator security demo (SE Demo Launcher).
 *
 * The demo backfills a realistic **supply-chain / malicious MCP server** incident
 * across five correlated Cribl Lake datasets so the Cribl Search AI Investigator
 * can reconstruct the timeline via federated search. Realism is the point: the
 * data has to look real enough that Copilot does not flag it as synthetic.
 *
 * This module authors ONE coherent environment (people, workstations, IdP, VCS,
 * DNS, egress firewall, C2 infrastructure) that every generator reuses, plus a
 * PRIVATE ground-truth manifest (attack window, IOCs, affected entities, verdict
 * counts). The manifest is used only for authoring + validation and is NEVER
 * written into any event — the investigator must reach the verdict by
 * correlation, not by reading a label.
 *
 * Narrative (internal Tradeshow Demo Guide, Demo 11): Cribl Coffee Co. developers
 * install a "revolutionary" MCP server from GitHub (~2,000 stars, promises 40%
 * cost savings). It is a trojan that reads token/auth files and exfiltrates
 * credentials to Eastern Europe. Verdict: 11 users touched sensitive files, 4
 * machines were compromised, and M. Brown is the most affected.
 */

/** Small deterministic PRNG so the whole environment + incident is stable. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next: () => number;
  pick: <T>(arr: readonly T[]) => T;
  int: (min: number, max: number) => number;
  float: (min: number, max: number) => number;
  chance: (p: number) => boolean;
  /** Gaussian-ish jitter in [-spread, +spread] (sum of uniforms). */
  jitter: (spread: number) => number;
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (min: number, max: number) => Math.floor(min + next() * (max - min + 1));
  return {
    next,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    int,
    float: (min: number, max: number) => min + next() * (max - min),
    chance: (p: number) => next() < p,
    jitter: (spread: number) => (next() + next() + next() - 1.5) * ((2 / 3) * spread),
  };
}

export interface Developer {
  /** Login / short username, e.g. `m.brown`. Shared entity across all sources. */
  user: string;
  fullName: string;
  email: string;
  team: string;
  /** Workstation hostname, e.g. `wks-brown-mbp`. */
  host: string;
  /** Corp LAN IP for the workstation (stable per host). */
  ip: string;
  /** macOS build string for EDR/host fields. */
  os: string;
  /** Home-office / VPN egress country for benign logins (mostly US). */
  homeCountry: string;
}

export interface C2Node {
  domain: string;
  ip: string;
  country: string;
  /** ASN/org label used in firewall/geo enrichment. */
  asnOrg: string;
}

export interface MaliciousPackage {
  /** npm-style package name developers `npm install`. */
  name: string;
  /** GitHub org/repo the package ships from. */
  repo: string;
  /** Star count that makes it look legitimate/popular. */
  stars: number;
  /** Version string seen in install/audit events. */
  version: string;
  /** Post-install script path that does the credential theft. */
  postInstallScript: string;
}

export interface Environment {
  orgId: string;
  orgDomain: string;
  emailDomain: string;
  githubOrg: string;
  oktaOrg: string;
  dnsResolvers: string[];
  egressFirewall: string;
  developers: Developer[];
  /** Subset of developers whose hosts are fully compromised (the causal chain). */
  compromised: Developer[];
  /** The single worst-affected developer (verdict headline). */
  patientZero: Developer;
  malicious: MaliciousPackage;
  c2: C2Node[];
  /** Absolute sensitive files the trojan reads (exfil targets). */
  sensitiveFiles: string[];
  /** Popular benign domains for long-tail DNS + firewall allows. */
  benignDomains: string[];
  /** Benign SaaS destinations (host, country) for firewall background. */
  benignEgress: Array<{ domain: string; ip: string; country: string; asnOrg: string }>;
}

/**
 * PRIVATE ground truth. Authoring + validation only. NEVER emitted into events.
 */
export interface GroundTruth {
  /** Attack window (epoch seconds). Backdated within the demo window. */
  attackStart: number;
  attackEnd: number;
  /** Full demo data window (epoch seconds). */
  windowStart: number;
  windowEnd: number;
  maliciousPackage: string;
  c2Domains: string[];
  c2Ips: string[];
  sensitiveFiles: string[];
  /** Users who touched sensitive files (benign + malicious) — the "11". */
  sensitiveFileUsers: string[];
  /** Hosts that show the full compromise chain — the "4". */
  compromisedHosts: string[];
  /** Worst-affected user (verdict headline). */
  patientZero: string;
  /** Expected pivots the investigator should traverse. */
  expectedPivots: string[];
  verdict: {
    usersWithSensitiveFileAccess: number;
    compromisedMachines: number;
    mostAffectedUser: string;
  };
}

const MACOS_BUILDS = [
  'macOS 14.5 (23F79)',
  'macOS 14.6 (23G80)',
  'macOS 15.1 (24B83)',
  'macOS 15.2 (24C101)',
];

/**
 * Roster of Cribl Coffee Co. developers. `m.brown` is patient zero; the first
 * four entries are the compromised hosts. Ordering matters: `buildEnvironment`
 * takes the first N as the compromised set so the incident is deterministic.
 */
const ROSTER: Array<Omit<Developer, 'ip' | 'os' | 'homeCountry'>> = [
  { user: 'm.brown', fullName: 'Morgan Brown', email: 'm.brown', team: 'platform-eng', host: 'wks-brown-mbp' },
  { user: 'd.lee', fullName: 'Dana Lee', email: 'd.lee', team: 'data-platform', host: 'wks-lee-mbp' },
  { user: 'r.patel', fullName: 'Ravi Patel', email: 'r.patel', team: 'payments', host: 'wks-patel-mbp' },
  { user: 's.kim', fullName: 'Soo Kim', email: 's.kim', team: 'frontend', host: 'wks-kim-mbp' },
  { user: 'j.nguyen', fullName: 'Jamie Nguyen', email: 'j.nguyen', team: 'platform-eng', host: 'wks-nguyen-mbp' },
  { user: 'a.silva', fullName: 'Ana Silva', email: 'a.silva', team: 'payments', host: 'wks-silva-mbp' },
  { user: 'c.okafor', fullName: 'Chidi Okafor', email: 'c.okafor', team: 'sre', host: 'wks-okafor-mbp' },
  { user: 'l.zhang', fullName: 'Lin Zhang', email: 'l.zhang', team: 'data-platform', host: 'wks-zhang-mbp' },
  { user: 'p.nair', fullName: 'Priya Nair', email: 'p.nair', team: 'frontend', host: 'wks-nair-mbp' },
  { user: 't.wright', fullName: 'Terry Wright', email: 't.wright', team: 'sre', host: 'wks-wright-mbp' },
  { user: 'g.rossi', fullName: 'Gio Rossi', email: 'g.rossi', team: 'platform-eng', host: 'wks-rossi-mbp' },
  { user: 'h.mueller', fullName: 'Hans Mueller', email: 'h.mueller', team: 'security', host: 'wks-mueller-mbp' },
  { user: 'e.davis', fullName: 'Erin Davis', email: 'e.davis', team: 'payments', host: 'wks-davis-mbp' },
  { user: 'n.ito', fullName: 'Naomi Ito', email: 'n.ito', team: 'frontend', host: 'wks-ito-mbp' },
  { user: 'o.hassan', fullName: 'Omar Hassan', email: 'o.hassan', team: 'data-platform', host: 'wks-hassan-mbp' },
  { user: 'k.novak', fullName: 'Karel Novak', email: 'k.novak', team: 'sre', host: 'wks-novak-mbp' },
  { user: 'f.costa', fullName: 'Filipa Costa', email: 'f.costa', team: 'platform-eng', host: 'wks-costa-mbp' },
  { user: 'v.popov', fullName: 'Vera Popov', email: 'v.popov', team: 'security', host: 'wks-popov-mbp' },
];

/** Eastern-European C2 nodes. Domains look like plausible package/telemetry CDNs. */
const C2_NODES: C2Node[] = [
  { domain: 'telemetry-sync-eu.mcp-labs.ro', ip: '5.2.72.184', country: 'RO', asnOrg: 'AS9009 M247 Europe SRL' },
  { domain: 'cdn-metrics.mcp-labs.ro', ip: '188.215.104.23', country: 'RO', asnOrg: 'AS8708 RCS & RDS' },
  { domain: 'pkg-registry-eu.mcp-cdn.net', ip: '86.120.44.9', country: 'RO', asnOrg: 'AS8708 RCS & RDS' },
  { domain: 'edge-collector.mcp-labs.ro', ip: '45.146.164.77', country: 'MD', asnOrg: 'AS200593 Alexhost SRL' },
];

const SENSITIVE_FILES = [
  '~/.aws/credentials',
  '~/.config/gh/hosts.yml',
  '~/.npmrc',
  '~/.ssh/id_ed25519',
  '~/.git-credentials',
  '~/.docker/config.json',
  '~/.config/gcloud/credentials.db',
  '~/Library/Application Support/Cursor/User/globalStorage/storage.json',
];

const BENIGN_DOMAINS = [
  'github.com',
  'api.github.com',
  'registry.npmjs.org',
  'api.anthropic.com',
  'pypi.org',
  'files.pythonhosted.org',
  'auth.docker.io',
  'registry-1.docker.io',
  'slack.com',
  'hooks.slack.com',
  'www.google.com',
  'accounts.google.com',
  'login.microsoftonline.com',
  'sentry.io',
  'datadoghq.com',
  'grafana.com',
  's3.amazonaws.com',
  'sts.amazonaws.com',
  'ec2.us-east-1.amazonaws.com',
  'objects.githubusercontent.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'raw.githubusercontent.com',
  'update.code.visualstudio.com',
  'marketplace.visualstudio.com',
];

const BENIGN_EGRESS = [
  { domain: 'github.com', ip: '140.82.121.4', country: 'US', asnOrg: 'AS36459 GitHub' },
  { domain: 'registry.npmjs.org', ip: '104.16.31.34', country: 'US', asnOrg: 'AS13335 Cloudflare' },
  { domain: 'api.anthropic.com', ip: '160.79.104.10', country: 'US', asnOrg: 'AS399358 Anthropic' },
  { domain: 's3.amazonaws.com', ip: '52.216.208.0', country: 'US', asnOrg: 'AS16509 Amazon' },
  { domain: 'slack.com', ip: '3.89.11.20', country: 'US', asnOrg: 'AS16509 Amazon' },
  { domain: 'login.microsoftonline.com', ip: '20.190.160.14', country: 'US', asnOrg: 'AS8075 Microsoft' },
  { domain: 'datadoghq.com', ip: '3.233.144.10', country: 'US', asnOrg: 'AS16509 Amazon' },
  { domain: 'cdn.jsdelivr.net', ip: '151.101.1.229', country: 'US', asnOrg: 'AS54113 Fastly' },
  { domain: 'marketplace.visualstudio.com', ip: '13.107.42.16', country: 'US', asnOrg: 'AS8075 Microsoft' },
  { domain: 'accounts.google.com', ip: '142.250.72.13', country: 'US', asnOrg: 'AS15169 Google' },
];

/** Number of developer hosts fully compromised by the trojan (the "4"). */
const COMPROMISED_COUNT = 4;
/** Total users who touched sensitive files (the "11") — compromised + benign. */
const SENSITIVE_FILE_USER_COUNT = 11;

/**
 * Build the coherent demo environment from a stable seed. The same seed always
 * yields the same people/hosts/IPs/C2, so every generator (and a re-deploy)
 * reconstructs identical shared entities and the incident stays correlated.
 */
export function buildEnvironment(seed: number): Environment {
  const rng = makeRng(seed);
  const emailDomain = 'criblcoffee.co';

  const developers: Developer[] = ROSTER.map((r, i) => ({
    ...r,
    email: `${r.email}@${emailDomain}`,
    ip: `10.20.${10 + Math.floor(i / 12)}.${20 + i}`,
    os: rng.pick(MACOS_BUILDS),
    homeCountry: rng.chance(0.12) ? rng.pick(['GB', 'DE', 'CA']) : 'US',
  }));

  const compromised = developers.slice(0, COMPROMISED_COUNT);

  return {
    orgId: 'org_criblcoffee',
    orgDomain: emailDomain,
    emailDomain,
    githubOrg: 'cribl-coffee',
    oktaOrg: 'criblcoffee',
    dnsResolvers: ['10.20.0.53', '10.20.0.54'],
    egressFirewall: 'fw-egress-01',
    developers,
    compromised,
    patientZero: developers[0],
    malicious: {
      name: 'mcp-cost-optimizer',
      repo: 'mcp-labs/mcp-cost-optimizer',
      stars: 2038,
      version: '1.4.2',
      postInstallScript: 'node_modules/mcp-cost-optimizer/scripts/postinstall.js',
    },
    c2: C2_NODES,
    sensitiveFiles: SENSITIVE_FILES,
    benignDomains: BENIGN_DOMAINS,
    benignEgress: BENIGN_EGRESS,
  };
}

/** Seconds in an hour, for window math. */
export const HOUR = 3600;

/**
 * Compute the private ground truth for a given environment + window. The demo
 * window ends "now" and spans `windowHours` (default 90 days). The attack
 * unfolds in a ~6h band around the middle of the window — old enough to have
 * aged out of a typical 30-day SIEM retention, which is the whole point of
 * showing federated search over the Lake archive — with plenty of benign
 * history both before and after it.
 */
export function buildGroundTruth(env: Environment, windowHours: number, nowSec: number): GroundTruth {
  const windowEnd = nowSec;
  const windowStart = nowSec - windowHours * HOUR;
  // Attack lands mid-window (~45 days back at the 90-day default), safely
  // beyond a 30-day SIEM horizon, with several hours of fan-out.
  const attackStart = Math.floor(windowStart + windowHours * HOUR * 0.5);
  const attackEnd = Math.floor(attackStart + 6 * HOUR);

  const compromisedUsers = env.compromised.map((d) => d.user);
  const benignSensitive = env.developers
    .slice(COMPROMISED_COUNT)
    .filter((d) => d.team !== 'security')
    .slice(0, SENSITIVE_FILE_USER_COUNT - COMPROMISED_COUNT)
    .map((d) => d.user);
  const sensitiveFileUsers = [...compromisedUsers, ...benignSensitive];

  return {
    attackStart,
    attackEnd,
    windowStart,
    windowEnd,
    maliciousPackage: env.malicious.name,
    c2Domains: env.c2.map((c) => c.domain),
    c2Ips: env.c2.map((c) => c.ip),
    sensitiveFiles: env.sensitiveFiles,
    sensitiveFileUsers,
    compromisedHosts: env.compromised.map((d) => d.host),
    patientZero: env.patientZero.user,
    expectedPivots: [
      'GitHub/npm install of mcp-cost-optimizer (vcs)',
      'postinstall.js reads token/credential files (endpoint)',
      'host resolves Eastern-European C2 domains (dns)',
      'HTTPS egress to RO/MD C2 IPs with byte spike (firewall)',
      'stolen tokens create/use Okta API tokens from foreign IPs (identity)',
    ],
    verdict: {
      usersWithSensitiveFileAccess: sensitiveFileUsers.length,
      compromisedMachines: env.compromised.length,
      mostAffectedUser: env.patientZero.user,
    },
  };
}
