/**
 * Bundled Check Point firewall sample set (SE Demo Launcher).
 *
 * Representative Check Point LEA-style key=value syslog lines (accept/drop
 * actions, VPN, NAT) in the shape the `cribl-checkpoint` pack expects. We ship
 * our own data — rather than relying on a Cribl built-in datagen template that
 * may not exist — so an internal generator acts only as a clock, and a replay
 * pipeline injects one of these lines as `_raw` on each tick.
 *
 * Each entry is a single-line string (no embedded newlines) so it survives the
 * syslog loop and drops cleanly into `_raw`.
 */

const HOST = "cp-gw-01";

/** Build a Check Point syslog line: `<PRI>Mmm DD HH:MM:SS host CheckPoint: k=v k=v ...`. */
function evt(priority: number, fields: Record<string, string>, host = HOST): string {
  const time = "Jul 07 14:22:31";
  const kv = Object.entries(fields)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return `<${priority}>${time} ${host} CheckPoint: ${kv}`;
}

/** The replay set. Ordering is irrelevant — the pipeline picks at random. */
export const checkpointEvents: string[] = [
  evt(166, {
    action: "accept", orig: "10.14.2.1", i_f_dir: "inbound", i_f_name: "eth0",
    src: "10.14.2.87", dst: "52.10.44.9", proto: "tcp", service: "443",
    product: "VPN-1 & FireWall-1", policy_name: "Standard",
  }),
  evt(163, {
    action: "drop", orig: "10.14.2.1", i_f_dir: "inbound", i_f_name: "eth1",
    src: "203.0.113.42", dst: "10.14.2.11", proto: "tcp", service: "3389",
    product: "VPN-1 & FireWall-1", policy_name: "Standard", rule: "14",
  }),
  evt(166, {
    action: "accept", orig: "10.14.2.1", i_f_dir: "outbound", i_f_name: "eth0",
    src: "10.14.2.33", dst: "8.8.8.8", proto: "udp", service: "53",
    product: "VPN-1 & FireWall-1", policy_name: "Standard",
  }),
  evt(166, {
    action: "accept", orig: "10.14.2.1", i_f_dir: "inbound", i_f_name: "eth2",
    src: "10.14.2.200", dst: "10.14.2.1", proto: "udp", service: "500",
    product: "VPN-1 & FireWall-1", vpn_feature_name: "IKE",
    user: "a.smith", peer_gateway: "203.0.113.10",
  }),
  evt(163, {
    action: "drop", orig: "10.14.2.1", i_f_dir: "inbound", i_f_name: "eth1",
    src: "198.51.100.7", dst: "10.14.2.87", proto: "tcp", service: "22",
    product: "VPN-1 & FireWall-1", policy_name: "Standard", rule: "9",
    reject_category: "Anti-Spoofing",
  }),
  evt(166, {
    action: "accept", orig: "10.14.2.1", i_f_dir: "outbound", i_f_name: "eth0",
    src: "10.14.2.50", dst: "151.101.1.69", proto: "tcp", service: "443",
    product: "VPN-1 & FireWall-1", app_name: "SaaS App", app_risk: "2",
  }),
];

/**
 * Metadata set on each replayed event so downstream tools and Cribl Search treat
 * it as genuine Check Point telemetry.
 */
export const checkpointSampleMeta = {
  sourcetype: "checkpoint:firewall",
  source: "cp-gw-01",
  index: "network",
};
