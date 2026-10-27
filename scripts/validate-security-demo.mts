/**
 * Offline validation for the AI Investigator security demo generators.
 * Confirms: deterministic output, backdated _time within window, benign-majority
 * background, cross-feed correlation (shared entities/timestamps), correct
 * verdict counts, and NO ground-truth/over-signaling fields leaked into events.
 *
 * Run: npx tsx scripts/validate-security-demo.mts
 */
import {
  buildIncidentData,
  SECURITY_FEEDS,
  generateSecurityFeed,
} from '../src/domain/samples/security/index.ts';

const HOUR = 3600;
const seed = 0xC0FFEE;
const windowHours = 90 * 24;
const anchor = Math.floor(Date.now() / 1000);

let failures = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
};

const { env, truth, feeds } = buildIncidentData(seed, windowHours, anchor);

// Determinism: same inputs → identical serialization.
const a = generateSecurityFeed(seed, windowHours, anchor, 'endpoint').join('\n');
const b = generateSecurityFeed(seed, windowHours, anchor, 'endpoint').join('\n');
check('generators are deterministic', a === b);

// Every feed produces events.
for (const f of SECURITY_FEEDS) {
  check(`feed '${f}' has events`, feeds[f].length > 0, `${feeds[f].length}`);
}

const all = SECURITY_FEEDS.flatMap((f) => feeds[f]);
console.log(`\nTotal events across ${SECURITY_FEEDS.length} feeds: ${all.length}`);

// Every event has a top-level numeric _time within the window (+small jitter).
const lo = truth.windowStart - 5;
const hi = truth.windowEnd + 5;
const badTime = all.filter(
  (e) => typeof e._time !== 'number' || (e._time as number) < lo || (e._time as number) > hi,
);
check('all events have _time within the window', badTime.length === 0, `${badTime.length} out of range`);
const span = (truth.windowEnd - truth.windowStart) / HOUR;
check('window spans ~90 days', Math.abs(span - windowHours) < 0.1, `${(span / 24).toFixed(1)}d`);

// No over-signaling / ground-truth fields leaked into any event.
const FORBIDDEN = ['malicious', 'threat', 'ioc', 'is_c2', 'label', 'ground_truth', 'attack', 'compromised', 'verdict', 'suspicious'];
const leaked = new Set<string>();
for (const e of all) {
  for (const k of Object.keys(e)) {
    if (FORBIDDEN.includes(k.toLowerCase())) leaked.add(k);
  }
}
check('no over-signaling fields in events', leaked.size === 0, [...leaked].join(', '));

// Benign majority: C2 domains are a small minority of DNS.
const c2 = new Set(truth.c2Domains);
const dnsC2 = feeds.dns.filter((e) => c2.has(String(e.domain))).length;
check('C2 DNS is a small minority', dnsC2 / feeds.dns.length < 0.1, `${dnsC2}/${feeds.dns.length}`);

// Firewall egress to C2 IPs is a minority but present.
const c2ips = new Set(truth.c2Ips);
const fwC2 = feeds.firewall.filter((e) => c2ips.has(String(e.dest_ip)));
check('firewall shows C2 egress', fwC2.length > 0, `${fwC2.length} sessions`);
check('C2 egress is a minority', fwC2.length / feeds.firewall.length < 0.1);
check('C2 egress has a byte spike', fwC2.some((e) => Number(e.bytes_out) > 150000));
check('C2 egress dest_country is RO/MD', fwC2.every((e) => ['RO', 'MD'].includes(String(e.dest_country))));

// Cross-feed correlation for patient zero: install → file read → DNS → egress.
const pz = truth.patientZero;
const pzHost = env.patientZero.host;
const vcsInstall = feeds.vcs.find((e) => e.user === pz && e.package === env.malicious.name);
const edrRead = feeds.endpoint.find(
  (e) => e.user === pz && e.action === 'read' && truth.sensitiveFiles.includes(String(e.file_path)) && String(e.parent_process).includes('postinstall'),
);
const earliest = (evts: typeof feeds.dns) =>
  evts.reduce<(typeof evts)[number] | undefined>(
    (min, e) => (min === undefined || Number(e._time) < Number(min._time) ? e : min),
    undefined,
  );
const dnsC2pz = earliest(feeds.dns.filter((e) => e.host === pzHost && c2.has(String(e.domain))));
const fwC2pz = earliest(feeds.firewall.filter((e) => e.host === pzHost && c2ips.has(String(e.dest_ip))));
const idTok = feeds.identity.find((e) => e.user === pz && e.event_type === 'system.api_token.create');
check('patient zero installs malicious package (vcs)', Boolean(vcsInstall));
check('patient zero credential read by postinstall (endpoint)', Boolean(edrRead));
check('patient zero host resolves C2 (dns)', Boolean(dnsC2pz));
check('patient zero host egresses to C2 (firewall)', Boolean(fwC2pz));
check('patient zero token created from foreign IP (identity)', Boolean(idTok));
if (vcsInstall && edrRead && dnsC2pz && fwC2pz) {
  const ordered =
    Number(vcsInstall._time) <= Number(edrRead._time) + 5 &&
    Number(edrRead._time) <= Number(dnsC2pz._time) + 5 &&
    Number(dnsC2pz._time) <= Number(fwC2pz._time) + 30;
  check('chain timestamps are causally ordered', ordered,
    `install=${Number(vcsInstall._time)} read=${Number(edrRead._time)} dns=${Number(dnsC2pz._time)} egress=${Number(fwC2pz._time)}`);
}

// Verdict counts match the ground truth.
const usersTouchingSensitive = new Set(
  feeds.endpoint
    .filter((e) => e.action === 'read' && truth.sensitiveFiles.includes(String(e.file_path)))
    .map((e) => String(e.user)),
);
const compromisedHosts = new Set(
  feeds.firewall.filter((e) => c2ips.has(String(e.dest_ip))).map((e) => String(e.host)),
);
check('~11 users touched sensitive files', usersTouchingSensitive.size === truth.verdict.usersWithSensitiveFileAccess,
  `${usersTouchingSensitive.size} (expected ${truth.verdict.usersWithSensitiveFileAccess})`);
check('4 machines compromised', compromisedHosts.size === truth.verdict.compromisedMachines,
  `${compromisedHosts.size} (expected ${truth.verdict.compromisedMachines})`);

// Realism: business-hours weighting on identity logins.
const logins = feeds.identity.filter((e) => e.event_type === 'user.session.start');
const business = logins.filter((e) => {
  const h = Math.floor((Number(e._time) / HOUR) % 24);
  return h >= 8 && h <= 19;
}).length;
check('identity logins skew to business hours', business / logins.length > 0.6,
  `${((business / logins.length) * 100).toFixed(0)}% in 08–19h`);

console.log(`\nVerdict (ground truth, never in data): ${truth.verdict.usersWithSensitiveFileAccess} users, ${truth.verdict.compromisedMachines} machines, worst = ${truth.verdict.mostAffectedUser}`);
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
