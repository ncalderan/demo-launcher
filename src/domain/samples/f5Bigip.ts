/**
 * Bundled F5 BIG-IP sample set (SE Demo Launcher).
 *
 * Representative LTM/ASM syslog lines (pool member health, connection logs,
 * WAF blocks) in the shape the `cribl-f5-bigip` pack expects. We ship our own
 * data — rather than relying on a Cribl built-in datagen template that may not
 * exist — so an internal generator acts only as a clock, and a replay pipeline
 * injects one of these lines as `_raw` on each tick.
 *
 * Each entry is a single-line string (no embedded newlines) so it survives the
 * syslog loop and drops cleanly into `_raw`.
 */

const HOST = "bigip-01";

/** Build an F5 syslog line: `<PRI>Mmm DD HH:MM:SS host module[pid]: id:level msg`. */
function evt(priority: number, module: string, pid: number, id: string, message: string, host = HOST): string {
  const time = "Jul 07 14:22:31";
  return `<${priority}>${time} ${host} ${module}[${pid}]: ${id}: ${message}`;
}

/** The replay set. Ordering is irrelevant — the pipeline picks at random. */
export const f5BigipEvents: string[] = [
  evt(166, "tmm", 12345, "01260013", "Pool /Common/web_pool member /Common/10.14.2.87:443 monitor status up"),
  evt(131, "tmm", 12345, "01260014", "Pool /Common/web_pool member /Common/10.14.2.88:443 monitor status down"),
  evt(166, "tmm", 12345, "01071682", "SSL Handshake failed for TCP connection from /10.9.2.17:51322 to /10.14.2.87:443"),
  evt(166, "asm", 22100, "01310013", "ASM:\"blocking\",\"SQL Injection\",\"203.0.113.42\",\"/Common/app_policy\",\"/login.php\""),
  evt(166, "tmm", 12345, "01490500", "Virtual /Common/app_vs rejected connection from 198.51.100.7:40122 (exceeded connection limit)"),
  evt(166, "tmm", 12345, "01260015", "Pool /Common/web_pool now has 3 active members, 1 member(s) available"),
  evt(166, "asm", 22100, "01310013", "ASM:\"blocking\",\"Cross Site Scripting\",\"203.0.113.99\",\"/Common/app_policy\",\"/search\""),
  evt(166, "ltm", 11000, "01071004", "HTTP header insertion rule applied to flow from 10.9.1.34 to /Common/app_vs"),
];

/**
 * Metadata set on each replayed event so downstream tools and Cribl Search treat
 * it as genuine F5 BIG-IP telemetry.
 */
export const f5BigipSampleMeta = {
  sourcetype: "f5:bigip:ltm",
  source: "bigip-01",
  index: "network",
};
