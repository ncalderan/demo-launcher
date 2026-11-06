/**
 * Bundled Fortinet FortiGate sample set (SE Demo Launcher).
 *
 * Representative FortiOS key=value traffic-log lines (forward traffic,
 * UTM/virus, and IPS events) in the shape the `cribl-fortinet-fortigate-firewall`
 * pack expects. We ship our own data — rather than relying on a Cribl built-in
 * datagen template that may not exist — so an internal generator acts only as
 * a clock, and a replay pipeline injects one of these lines as `_raw` on each
 * tick.
 *
 * Each entry is a single-line string (no embedded newlines) so it survives the
 * syslog loop and drops cleanly into `_raw`.
 */

const HOST = "fgt-edge-01";

/** Build a FortiGate syslog line: `<PRI>Mmm DD HH:MM:SS host date=... time=... k=v ...`. */
function evt(priority: number, fields: Record<string, string>, host = HOST): string {
  const time = "Jul 07 14:22:31";
  const kv = Object.entries(fields)
    .map(([k, v]) => `${k}=${/^[-\d.]+$/.test(v) ? v : `"${v}"`}`)
    .join(" ");
  return `<${priority}>${time} ${host} date=2026-07-07 time=14:22:31 ${kv}`;
}

/** The replay set. Ordering is irrelevant — the pipeline picks at random. */
export const fortinetEvents: string[] = [
  evt(166, {
    devname: "FGT-EDGE-01", devid: "FGT60F0000000001", logid: "0000000013",
    type: "traffic", subtype: "forward", level: "notice", vd: "root",
    srcip: "10.14.2.87", srcport: "51322", srcintf: "internal",
    dstip: "52.10.44.9", dstport: "443", dstintf: "wan1",
    policyid: "4", action: "accept", proto: "6", service: "HTTPS",
    sentbyte: "4821", rcvdbyte: "19204",
  }),
  evt(163, {
    devname: "FGT-EDGE-01", devid: "FGT60F0000000001", logid: "0000000013",
    type: "traffic", subtype: "forward", level: "warning", vd: "root",
    srcip: "203.0.113.42", srcport: "40122", srcintf: "wan1",
    dstip: "10.14.2.11", dstport: "3389", dstintf: "internal",
    policyid: "7", action: "deny", proto: "6", service: "RDP",
    sentbyte: "0", rcvdbyte: "0",
  }),
  evt(166, {
    devname: "FGT-EDGE-01", devid: "FGT60F0000000001", logid: "0000000013",
    type: "traffic", subtype: "forward", level: "notice", vd: "root",
    srcip: "10.14.2.33", srcport: "53122", srcintf: "internal",
    dstip: "8.8.8.8", dstport: "53", dstintf: "wan1",
    policyid: "4", action: "accept", proto: "17", service: "DNS",
    sentbyte: "68", rcvdbyte: "132",
  }),
  evt(166, {
    devname: "FGT-EDGE-01", devid: "FGT60F0000000001", logid: "0211008192",
    type: "utm", subtype: "virus", level: "warning", vd: "root",
    srcip: "10.14.2.19", dstip: "198.51.100.7", service: "HTTP",
    virus: "EICAR_TEST_FILE", action: "blocked", filename: "test.exe",
  }),
  evt(163, {
    devname: "FGT-EDGE-01", devid: "FGT60F0000000001", logid: "0419016384",
    type: "utm", subtype: "ips", level: "alert", vd: "root",
    srcip: "203.0.113.99", dstip: "10.14.2.87", service: "HTTPS",
    attack: "MS.SMB.Server.SMBv1.Trans2.Response.Buffer.Overflow",
    action: "dropped", severity: "critical",
  }),
  evt(166, {
    devname: "FGT-EDGE-01", devid: "FGT60F0000000001", logid: "0000000013",
    type: "traffic", subtype: "forward", level: "notice", vd: "root",
    srcip: "10.14.2.44", srcport: "60210", srcintf: "internal",
    dstip: "140.82.112.3", dstport: "443", dstintf: "wan1",
    policyid: "4", action: "accept", proto: "6", service: "HTTPS",
    sentbyte: "2290", rcvdbyte: "88412",
  }),
  evt(166, {
    devname: "FGT-EDGE-01", devid: "FGT60F0000000001", logid: "0100032001",
    type: "event", subtype: "vpn", level: "notice", vd: "root",
    action: "tunnel-up", remip: "198.51.100.21", tunneltype: "ipsec",
    user: "r.patel",
  }),
];

/**
 * Metadata set on each replayed event so downstream tools and Cribl Search treat
 * it as genuine Fortinet FortiGate telemetry.
 */
export const fortinetSampleMeta = {
  sourcetype: "fortinet:fortigate:traffic",
  source: "fgt-edge-01",
  index: "network",
};
