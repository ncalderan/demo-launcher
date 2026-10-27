/**
 * Bundled Linux infrastructure syslog sample set (SE Demo Launcher).
 *
 * These are real-shaped RFC3164 syslog lines (sshd, sudo, cron, systemd, kernel,
 * etc.) that the Cribl Syslog Input pack parses and that Cribl Search classifies
 * with the built-in `syslog` datatype (priority, timestamp, hostname, appname,
 * procid, message). We ship our own data — rather than relying on a Cribl
 * built-in datagen template that may not exist — so the Linux demo is
 * deterministic: an internal generator acts only as a clock, and a replay
 * pipeline injects one of these lines as `_raw` on each tick.
 *
 * The mix is intentionally weighted toward high-volume, low-value chatter (cron,
 * systemd session churn) so an SE can add a Drop/reduce step and visibly cut
 * volume.
 *
 * Each entry is a single-line string (no embedded newlines) so it survives the
 * tcpjson loop and drops cleanly into `_raw`.
 */

const HOST = "app-node-11";

/** Build an RFC3164 syslog line: `<PRI>Mmm DD HH:MM:SS host tag[pid]: msg`. */
function evt(
  priority: number,
  tag: string,
  pid: number | undefined,
  message: string,
  host = HOST,
): string {
  const time = "Jul 07 14:22:31";
  const proc = pid === undefined ? tag : `${tag}[${pid}]`;
  return `<${priority}>${time} ${host} ${proc}: ${message}`;
}

/**
 * The replay set. Ordering is irrelevant (the pipeline picks at random); the mix
 * leans on noisy, low-value events so the reduction story is compelling.
 */
export const linuxSyslogEvents: string[] = [
  // sshd — successful and failed authentication (security-relevant, keep)
  evt(38, "sshd", 4821, "Accepted publickey for svc-deploy from 10.9.1.34 port 52344 ssh2: RSA SHA256:9xB1k2..."),
  evt(38, "sshd", 4822, "Accepted password for a.smith from 10.9.2.17 port 51992 ssh2"),
  evt(38, "sshd", 4830, "Failed password for invalid user admin from 203.0.113.42 port 40122 ssh2"),
  evt(38, "sshd", 4831, "Failed password for root from 198.51.100.7 port 33188 ssh2"),
  evt(38, "sshd", 4833, "Disconnected from authenticating user root 198.51.100.7 port 33188 [preauth]"),
  evt(85, "sshd", 4840, "pam_unix(sshd:session): session opened for user svc-deploy by (uid=0)"),

  // sudo — privilege escalation (security-relevant, keep)
  evt(85, "sudo", undefined, "  a.smith : TTY=pts/0 ; PWD=/home/a.smith ; USER=root ; COMMAND=/usr/bin/systemctl restart nginx"),
  evt(85, "sudo", undefined, "pam_unix(sudo:session): session opened for user root by a.smith(uid=1001)"),

  // cron — high-volume, low-value chatter (drop candidate)
  evt(78, "CRON", 5001, "(root) CMD (   cd / && run-parts --report /etc/cron.hourly)"),
  evt(78, "CRON", 5012, "(root) CMD (command -v debian-sa1 > /dev/null && debian-sa1 1 1)"),
  evt(78, "CRON", 5044, "pam_unix(cron:session): session opened for user root by (uid=0)"),
  evt(78, "CRON", 5044, "pam_unix(cron:session): session closed for user root"),

  // systemd — service/session churn (mostly drop candidates)
  evt(30, "systemd", 1, "Started Session 8842 of user svc-deploy."),
  evt(30, "systemd", 1, "Starting Cleanup of Temporary Directories..."),
  evt(30, "systemd", 1, "Finished Cleanup of Temporary Directories."),
  evt(30, "systemd-logind", 742, "New session 8842 of user svc-deploy."),
  evt(30, "systemd", 1, "nginx.service: Succeeded."),

  // kernel — networking + audit (mixed value)
  evt(4, "kernel", undefined, "[UFW BLOCK] IN=eth0 OUT= MAC=00:16:3e:2a:1c:44 SRC=203.0.113.42 DST=10.9.1.11 PROTO=TCP SPT=40122 DPT=22 WINDOW=1024"),
  evt(4, "kernel", undefined, "audit: type=1400 audit(1783443751.518:44): apparmor=\"DENIED\" operation=\"open\" profile=\"/usr/sbin/nginx\" name=\"/etc/shadow\""),

  // application services (operational)
  evt(30, "nginx", 2210, "10.9.2.17 - - [07/Jul/2026:14:22:31 +0000] \"GET /healthz HTTP/1.1\" 200 2 \"-\" \"kube-probe/1.29\""),
  evt(27, "dhclient", 903, "DHCPACK of 10.9.1.11 from 10.9.1.1"),
];

/**
 * Metadata set on each replayed event so downstream tools and Cribl Search treat
 * it as genuine Linux syslog telemetry.
 */
export const linuxSyslogSampleMeta = {
  sourcetype: "syslog",
  source: "/var/log/syslog",
  index: "linux",
};
