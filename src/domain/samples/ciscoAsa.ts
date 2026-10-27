/**
 * Bundled Cisco ASA firewall sample set (SE Demo Launcher).
 *
 * Representative `%ASA-#-######:` syslog messages (connection build/teardown,
 * access-list denies, NAT translations) in the shape the `cribl-cisco-asa-cleanup`
 * pack expects. We ship our own data — rather than relying on a Cribl built-in
 * datagen template that may not exist — so an internal generator acts only as a
 * clock, and a replay pipeline injects one of these lines as `_raw` on each tick.
 *
 * Each entry is a single-line string (no embedded newlines) so it survives the
 * syslog loop and drops cleanly into `_raw`.
 */

const HOST = "asa-edge-01";

/** Build a Cisco ASA syslog line: `<PRI>Mmm DD HH:MM:SS host %ASA-L-ID: msg`. */
function evt(priority: number, level: number, id: string, message: string, host = HOST): string {
  const time = "Jul 07 14:22:31";
  return `<${priority}>${time} ${host} %ASA-${level}-${id}: ${message}`;
}

/** The replay set. Ordering is irrelevant — the pipeline picks at random. */
export const ciscoAsaEvents: string[] = [
  evt(166, 6, "302013", "Built inbound TCP connection 884201 for outside:203.0.113.42/51322 (203.0.113.42/51322) to inside:10.14.2.87/443 (10.14.2.87/443)"),
  evt(166, 6, "302014", "Teardown TCP connection 884201 for outside:203.0.113.42/51322 to inside:10.14.2.87/443 duration 0:02:14 bytes 18442 TCP FINs"),
  evt(163, 4, "106023", "Deny tcp src outside:198.51.100.7/40122 dst inside:10.14.2.11/22 by access-group \"OUTSIDE_IN\" [0x0, 0x0]"),
  evt(166, 6, "305011", "Built dynamic TCP translation from inside:10.14.2.87/51000 to outside:198.51.100.100/22105"),
  evt(166, 6, "302015", "Built outbound UDP connection 884202 for outside:8.8.8.8/53 (8.8.8.8/53) to inside:10.14.2.33/52110 (10.14.2.33/52110)"),
  evt(166, 6, "313001", "Denied ICMP type=8, code=0 from 203.0.113.99 on interface outside"),
  evt(179, 7, "609001", "Built local-host inside:10.14.2.87"),
  evt(179, 7, "609002", "Teardown local-host inside:10.14.2.87 duration 0:05:40"),
  evt(163, 4, "106100", "access-list OUTSIDE_IN denied tcp outside/203.0.113.42(51322) -> inside/10.14.2.11(3389) hit-cnt 1 first hit"),
  evt(166, 6, "722051", "Group <RA-VPN-POOL> User <a.smith> IP <10.14.2.200> Address assigned to session"),
];

/**
 * Metadata set on each replayed event so downstream tools and Cribl Search treat
 * it as genuine Cisco ASA telemetry.
 */
export const ciscoAsaSampleMeta = {
  sourcetype: "cisco:asa",
  source: "asa-edge-01",
  index: "network",
};
