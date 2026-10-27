/**
 * Bundled CrowdStrike Falcon sample set (SE Demo Launcher).
 *
 * Representative Falcon detection/event JSON records in the shape the
 * `cribl_crowdstrike` pack expects. We ship our own data — rather than relying
 * on a Cribl built-in datagen template that may not exist — so an internal
 * generator acts only as a clock, and a replay pipeline injects one of these
 * records (serialized to a single line) as `_raw` on each tick.
 */

/** Build a single-line JSON string for a Falcon-style detection/event record. */
function evt(fields: Record<string, unknown>): string {
  return JSON.stringify({
    cid: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    aid: "9f8e7d6c5b4a3210fedcba9876543210",
    ...fields,
  });
}

/** The replay set. Ordering is irrelevant — the pipeline picks at random. */
export const crowdstrikeEvents: string[] = [
  evt({
    metadata: { eventType: "DetectionSummaryEvent", eventCreationTime: 1783443751518 },
    event: {
      DetectName: "Suspicious Process", DetectDescription: "Credential file read by install hook",
      Severity: 70, SeverityName: "High", ComputerName: "wks-brown-mbp", UserName: "m.brown",
      FileName: "node", CommandLine: "node postinstall.js", FilePath: "/usr/local/bin/node",
      LocalIP: "10.9.1.34", MACAddress: "00-16-3e-2a-1c-44",
    },
  }),
  evt({
    metadata: { eventType: "AuthActivityAuditEvent", eventCreationTime: 1783443812000 },
    event: {
      UserId: "a.smith@agency.local", UserIp: "10.9.2.17", OperationName: "userAuthenticate",
      Success: true, ComputerName: "dc01.agency.local",
    },
  }),
  evt({
    metadata: { eventType: "DetectionSummaryEvent", eventCreationTime: 1783443900000 },
    event: {
      DetectName: "Malicious DNS Request", DetectDescription: "C2 beacon pattern detected",
      Severity: 90, SeverityName: "Critical", ComputerName: "wks-brown-mbp", UserName: "m.brown",
      DomainName: "telemetry-sync-eu.mcp-labs.ro", LocalIP: "10.9.1.34",
    },
  }),
  evt({
    metadata: { eventType: "ProcessRollupEvent", eventCreationTime: 1783443950000 },
    event: {
      FileName: "powershell.exe", CommandLine: "powershell.exe -enc JABzAD0A...",
      ComputerName: "app-node-11", UserName: "svc-deploy", ParentBaseFileName: "cmd.exe",
    },
  }),
  evt({
    metadata: { eventType: "DetectionSummaryEvent", eventCreationTime: 1783444010000 },
    event: {
      DetectName: "Ransomware Behavior", DetectDescription: "Mass file rename/encrypt pattern",
      Severity: 95, SeverityName: "Critical", ComputerName: "fin-ws-04", UserName: "r.lopez",
      FileName: "svchost.exe", LocalIP: "10.9.3.12",
    },
  }),
];

/**
 * Metadata set on each replayed event so downstream tools and Cribl Search treat
 * it as genuine CrowdStrike Falcon telemetry.
 */
export const crowdstrikeSampleMeta = {
  sourcetype: "crowdstrike:falcon",
  source: "falcon_data_replicator",
  index: "endpoint",
};
