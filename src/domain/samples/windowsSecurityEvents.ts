/**
 * Bundled Windows Security-channel event sample set (SE Demo Launcher).
 *
 * These are real-shaped Windows Security events in the standard XML
 * (`XmlWinEventLog`) format that the maintained Cribl Windows XML pack
 * (`cribl-splunk-forwarder-windows-xml-events-to-json`) is built to parse and
 * shrink. We ship our own data (rather than relying on a Cribl built-in datagen
 * template) so the Windows demo is deterministic and pack-compatible: an
 * internal generator acts only as a clock, and a replay pipeline injects one of
 * these events as `_raw` on each tick.
 *
 * The set intentionally spans a range of Event IDs — including high-volume,
 * low-value ones (e.g. 4634 logoff, 4688 process creation, 5156 WFP) — so an SE
 * can add a Drop step for specific Event IDs and visibly reduce volume.
 *
 * Each entry is a single-line XML document (no embedded newlines) so it survives
 * the tcpjson loop and drops cleanly into `_raw`.
 */

const NS = "http://schemas.microsoft.com/win/2004/08/events/event";
const AUDIT = "Microsoft-Windows-Security-Auditing";
const AUDIT_GUID = "{54849625-5478-4994-A5BA-3E3B0328C30D}";
const COMPUTER = "DC01.agency.local";

/** Compact helper to build a Security-channel event with EventData name/value pairs. */
function evt(
  eventId: number,
  task: number,
  data: Record<string, string>,
  opts: { provider?: string; providerGuid?: string; channel?: string } = {},
): string {
  const provider = opts.provider ?? AUDIT;
  const guid = opts.providerGuid ?? AUDIT_GUID;
  const channel = opts.channel ?? "Security";
  const time = "2026-07-07T14:22:31.518274000Z";
  const dataXml = Object.entries(data)
    .map(([k, v]) => `<Data Name='${k}'>${v}</Data>`)
    .join("");
  return (
    `<Event xmlns='${NS}'>` +
    `<System>` +
    `<Provider Name='${provider}' Guid='${guid}'/>` +
    `<EventID>${eventId}</EventID>` +
    `<Version>0</Version><Level>0</Level><Task>${task}</Task><Opcode>0</Opcode>` +
    `<Keywords>0x8020000000000000</Keywords>` +
    `<TimeCreated SystemTime='${time}'/>` +
    `<EventRecordID>${1000000 + eventId}</EventRecordID>` +
    `<Correlation/>` +
    `<Execution ProcessID='4' ThreadID='88'/>` +
    `<Channel>${channel}</Channel>` +
    `<Computer>${COMPUTER}</Computer>` +
    `<Security/>` +
    `</System>` +
    `<EventData>${dataXml}</EventData>` +
    `</Event>`
  );
}

/**
 * The replay set. Ordering is irrelevant (the pipeline picks at random), but the
 * mix is weighted toward noisy events so the drop story is compelling.
 */
export const windowsSecurityEvents: string[] = [
  // 4624 — Successful logon (interactive)
  evt(4624, 12544, {
    SubjectUserSid: "S-1-0-0",
    SubjectUserName: "-",
    SubjectDomainName: "-",
    SubjectLogonId: "0x0",
    TargetUserSid: "S-1-5-21-1004336348-1177238915-682003330-1114",
    TargetUserName: "a.smith",
    TargetDomainName: "AGENCY",
    TargetLogonId: "0x1f4a2",
    LogonType: "2",
    LogonProcessName: "User32",
    AuthenticationPackageName: "Negotiate",
    WorkstationName: "WKS-1042",
    IpAddress: "10.9.1.34",
    IpPort: "0",
  }),
  // 4624 — Successful logon (network, LogonType 3)
  evt(4624, 12544, {
    SubjectUserSid: "S-1-0-0",
    SubjectUserName: "-",
    SubjectDomainName: "-",
    SubjectLogonId: "0x0",
    TargetUserSid: "S-1-5-21-1004336348-1177238915-682003330-1150",
    TargetUserName: "svc_backup",
    TargetDomainName: "AGENCY",
    TargetLogonId: "0x2ab19",
    LogonType: "3",
    LogonProcessName: "Kerberos",
    AuthenticationPackageName: "Kerberos",
    WorkstationName: "FS-03",
    IpAddress: "10.9.4.51",
    IpPort: "50221",
  }),
  // 4625 — Failed logon
  evt(4625, 12544, {
    SubjectUserSid: "S-1-0-0",
    SubjectUserName: "-",
    SubjectDomainName: "-",
    SubjectLogonId: "0x0",
    TargetUserSid: "S-1-0-0",
    TargetUserName: "administrator",
    TargetDomainName: "AGENCY",
    Status: "0xc000006d",
    SubStatus: "0xc000006a",
    LogonType: "3",
    LogonProcessName: "NtLmSsp",
    AuthenticationPackageName: "NTLM",
    WorkstationName: "KALI-VM",
    IpAddress: "203.0.113.44",
    IpPort: "44921",
  }),
  // 4634 — Logoff (high volume, low value)
  evt(4634, 12545, {
    TargetUserSid: "S-1-5-21-1004336348-1177238915-682003330-1114",
    TargetUserName: "a.smith",
    TargetDomainName: "AGENCY",
    TargetLogonId: "0x1f4a2",
    LogonType: "2",
  }),
  // 4634 — Logoff (second, to weight volume)
  evt(4634, 12545, {
    TargetUserSid: "S-1-5-21-1004336348-1177238915-682003330-1150",
    TargetUserName: "svc_backup",
    TargetDomainName: "AGENCY",
    TargetLogonId: "0x2ab19",
    LogonType: "3",
  }),
  // 4648 — Logon using explicit credentials
  evt(4648, 12544, {
    SubjectUserSid: "S-1-5-21-1004336348-1177238915-682003330-1114",
    SubjectUserName: "a.smith",
    SubjectDomainName: "AGENCY",
    SubjectLogonId: "0x1f4a2",
    TargetUserName: "admin_a.smith",
    TargetDomainName: "AGENCY",
    TargetServerName: "SQL-01",
    ProcessName: "C:\\Windows\\System32\\mmc.exe",
    IpAddress: "10.9.1.34",
    IpPort: "0",
  }),
  // 4672 — Special privileges assigned to new logon
  evt(4672, 12548, {
    SubjectUserSid: "S-1-5-21-1004336348-1177238915-682003330-1150",
    SubjectUserName: "svc_backup",
    SubjectDomainName: "AGENCY",
    SubjectLogonId: "0x2ab19",
    PrivilegeList: "SeSecurityPrivilege SeBackupPrivilege SeRestorePrivilege",
  }),
  // 4688 — A new process has been created (very high volume)
  evt(4688, 13312, {
    SubjectUserSid: "S-1-5-18",
    SubjectUserName: "DC01$",
    SubjectDomainName: "AGENCY",
    SubjectLogonId: "0x3e7",
    NewProcessId: "0x1a2c",
    NewProcessName: "C:\\Windows\\System32\\svchost.exe",
    TokenElevationType: "%%1936",
    CommandLine: "C:\\Windows\\System32\\svchost.exe -k netsvcs -p",
    CreatorProcessName: "C:\\Windows\\System32\\services.exe",
  }),
  // 4688 — process creation (second, to weight volume)
  evt(4688, 13312, {
    SubjectUserSid: "S-1-5-21-1004336348-1177238915-682003330-1114",
    SubjectUserName: "a.smith",
    SubjectDomainName: "AGENCY",
    SubjectLogonId: "0x1f4a2",
    NewProcessId: "0x24f0",
    NewProcessName: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    TokenElevationType: "%%1937",
    CommandLine: "powershell.exe -NoProfile -ExecutionPolicy Bypass -File update.ps1",
    CreatorProcessName: "C:\\Windows\\explorer.exe",
  }),
  // 4689 — A process has exited (high volume)
  evt(4689, 13313, {
    SubjectUserSid: "S-1-5-18",
    SubjectUserName: "DC01$",
    SubjectDomainName: "AGENCY",
    SubjectLogonId: "0x3e7",
    ProcessId: "0x1a2c",
    ProcessName: "C:\\Windows\\System32\\svchost.exe",
    Status: "0x0",
  }),
  // 4720 — A user account was created
  evt(4720, 13824, {
    SubjectUserSid: "S-1-5-21-1004336348-1177238915-682003330-500",
    SubjectUserName: "Administrator",
    SubjectDomainName: "AGENCY",
    SubjectLogonId: "0x3e4f9",
    TargetUserName: "j.contractor",
    TargetDomainName: "AGENCY",
    TargetSid: "S-1-5-21-1004336348-1177238915-682003330-1203",
    SamAccountName: "j.contractor",
  }),
  // 4726 — A user account was deleted
  evt(4726, 13824, {
    SubjectUserSid: "S-1-5-21-1004336348-1177238915-682003330-500",
    SubjectUserName: "Administrator",
    SubjectDomainName: "AGENCY",
    SubjectLogonId: "0x3e4f9",
    TargetUserName: "temp_intern",
    TargetDomainName: "AGENCY",
    TargetSid: "S-1-5-21-1004336348-1177238915-682003330-1199",
  }),
  // 4740 — A user account was locked out
  evt(4740, 13824, {
    SubjectUserSid: "S-1-5-18",
    SubjectUserName: "DC01$",
    SubjectDomainName: "AGENCY",
    SubjectLogonId: "0x3e7",
    TargetUserName: "administrator",
    TargetDomainName: "AGENCY",
    TargetSid: "S-1-5-21-1004336348-1177238915-682003330-500",
    CallerComputerName: "KALI-VM",
  }),
  // 4768 — A Kerberos authentication ticket (TGT) was requested
  evt(4768, 14339, {
    TargetUserName: "a.smith",
    TargetDomainName: "AGENCY.LOCAL",
    TargetSid: "S-1-5-21-1004336348-1177238915-682003330-1114",
    ServiceName: "krbtgt",
    ServiceSid: "S-1-5-21-1004336348-1177238915-682003330-502",
    TicketOptions: "0x40810010",
    TicketEncryptionType: "0x12",
    IpAddress: "::ffff:10.9.1.34",
    IpPort: "0",
    Status: "0x0",
  }),
  // 4769 — A Kerberos service ticket was requested (high volume)
  evt(4769, 14337, {
    TargetUserName: "a.smith@AGENCY.LOCAL",
    TargetDomainName: "AGENCY.LOCAL",
    ServiceName: "FS-03$",
    ServiceSid: "S-1-5-21-1004336348-1177238915-682003330-1108",
    TicketOptions: "0x40810000",
    TicketEncryptionType: "0x12",
    IpAddress: "::ffff:10.9.1.34",
    IpPort: "52210",
    Status: "0x0",
  }),
  // 5140 — A network share object was accessed
  evt(5140, 12810, {
    SubjectUserSid: "S-1-5-21-1004336348-1177238915-682003330-1150",
    SubjectUserName: "svc_backup",
    SubjectDomainName: "AGENCY",
    SubjectLogonId: "0x2ab19",
    ObjectType: "File",
    IpAddress: "10.9.4.51",
    IpPort: "50221",
    ShareName: "\\\\*\\SYSVOL",
    AccessMask: "0x1",
  }),
  // 5156 — The Windows Filtering Platform permitted a connection (extremely noisy)
  evt(5156, 12810, {
    ProcessID: "4",
    Application: "System",
    Direction: "%%14593",
    SourceAddress: "10.9.4.51",
    SourcePort: "50221",
    DestAddress: "10.9.1.10",
    DestPort: "445",
    Protocol: "6",
    FilterRTID: "70016",
    LayerName: "%%14611",
    LayerRTID: "48",
  }),
  // 4104 — PowerShell script block logging (Operational channel)
  evt(
    4104,
    0,
    {
      MessageNumber: "1",
      MessageTotal: "1",
      ScriptBlockText:
        "Get-WmiObject -Class Win32_ComputerSystem | Select-Object Name, Domain",
      ScriptBlockId: "b6c1e7a2-3f9d-4b21-9c0e-6f7a2d1e4c88",
      Path: "C:\\scripts\\inventory.ps1",
    },
    {
      provider: "Microsoft-Windows-PowerShell",
      providerGuid: "{A0C1853B-5C40-4B15-8766-3CF1C58F985A}",
      channel: "Microsoft-Windows-PowerShell/Operational",
    },
  ),
];

/**
 * Splunk-style metadata set on each replayed event so the Windows XML pack's
 * route matches (`sourcetype == 'XmlWinEventLog'`) and downstream tools treat it
 * as genuine Windows telemetry.
 */
export const windowsSecuritySampleMeta = {
  sourcetype: "XmlWinEventLog",
  source: "XmlWinEventLog:Security",
  index: "windows",
};
