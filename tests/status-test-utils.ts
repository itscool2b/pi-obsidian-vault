export type CapabilityState = "available" | "degraded" | "unavailable";

export function parseCapabilities(message: string): Record<string, CapabilityState> {
  const capabilities: Record<string, CapabilityState> = {};
  for (const line of message.split(/\r?\n/)) {
    const match = /^-\s*(retrieve|write|edit|manage|plan):\s*(available|degraded|unavailable)\b/i.exec(line.trim());
    if (match) capabilities[match[1]!.toLowerCase()] = match[2]!.toLowerCase() as CapabilityState;
  }
  return capabilities;
}

export function requireCapabilities(message: string): Record<string, CapabilityState> {
  const capabilities = parseCapabilities(message);
  for (const name of ["retrieve", "write", "edit", "manage", "plan"]) {
    if (!capabilities[name]) throw new Error(`Missing ${name} capability in status output:\n${message}`);
  }
  return capabilities;
}

export function expectNoAbsolutePathFragments(message: string, sensitiveValues: string[]): void {
  for (const value of sensitiveValues.filter(Boolean)) {
    if (message.includes(value)) throw new Error(`Status output leaked ${value}:\n${message}`);
  }
  if (/CLI:\s*(?:\/|[A-Za-z]:\\|\\\\)/.test(message)) throw new Error(`Status output leaked absolute CLI path:\n${message}`);
}
