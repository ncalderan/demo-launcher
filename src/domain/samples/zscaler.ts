/**
 * Bundled Zscaler Internet Access sample set (SE Demo Launcher).
 *
 * Representative Zscaler NSS web-log JSON records in the shape the
 * `cribl-zscaler` pack expects. We ship our own data — rather than relying on
 * a Cribl built-in datagen template that may not exist — so an internal
 * generator acts only as a clock, and a replay pipeline injects one of these
 * records (serialized to a single line) as `_raw` on each tick.
 */

/** Build a single-line JSON string for a Zscaler NSS web-log record. */
function evt(fields: Record<string, unknown>): string {
  return JSON.stringify({
    datetime: "2026-07-07 14:22:31",
    clientpublicip: "10.9.1.34",
    ...fields,
  });
}

/** The replay set. Ordering is irrelevant — the pipeline picks at random. */
export const zscalerEvents: string[] = [
  evt({
    user: "a.smith@agency.local", url: "https://outlook.office.com/mail/", action: "Allowed",
    urlcategory: "Business and Economy", urlclass: "Productivity Loss", appname: "Office365",
    reason: "Allowed - Category", serverip: "52.96.14.10", protocol: "HTTPS", respcode: "200",
  }),
  evt({
    user: "m.brown@agency.local", url: "https://telemetry-sync-eu.mcp-labs.ro/beacon", action: "Blocked",
    urlcategory: "Newly Registered Domain", urlclass: "Security Risk", threatname: "Suspicious_C2_Beacon",
    reason: "Blocked - Security", serverip: "185.220.101.50", protocol: "HTTPS", respcode: "0",
  }),
  evt({
    user: "r.lopez@agency.local", url: "https://github.com/some-org/some-repo", action: "Allowed",
    urlcategory: "Information Technology", urlclass: "General Browsing", appname: "GitHub",
    reason: "Allowed - Category", serverip: "140.82.112.3", protocol: "HTTPS", respcode: "200",
  }),
  evt({
    user: "a.smith@agency.local", url: "https://www.dropbox.com/upload", action: "Blocked",
    urlcategory: "Online Storage and Backup", urlclass: "Unsanctioned App", appname: "Dropbox",
    reason: "Blocked - DLP Policy", serverip: "162.125.4.1", protocol: "HTTPS", respcode: "0",
  }),
  evt({
    user: "svc-deploy@agency.local", url: "https://api.github.com/repos", action: "Allowed",
    urlcategory: "Information Technology", urlclass: "General Browsing", appname: "GitHub",
    reason: "Allowed - Category", serverip: "140.82.113.6", protocol: "HTTPS", respcode: "200",
  }),
];

/**
 * Metadata set on each replayed event so downstream tools and Cribl Search treat
 * it as genuine Zscaler Internet Access telemetry.
 */
export const zscalerSampleMeta = {
  sourcetype: "zscalernss-web",
  source: "zscaler_nss",
  index: "network",
};
