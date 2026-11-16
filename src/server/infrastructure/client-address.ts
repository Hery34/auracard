import { isIP } from "node:net";

const FORWARDED_FOR_HEADER = "x-forwarded-for";
const IPV6_GROUPS = 8;
const IPV6_PREFIX_GROUPS = 4;
const IPV4_MAPPED_PREFIX = [0, 0, 0, 0, 0, 0xffff];

export type ClientAddressOptions = { trustedProxyHops: number; production: boolean };

/**
 * Address of the visitor as set by the nearest trusted proxy: the `trustedProxyHops`-th element of
 * `x-forwarded-for` counted from the end (the first elements are under the client's control).
 * IPv6 addresses are aggregated to their /64 prefix, IPv4-mapped ones reduced to the IPv4 address.
 * Absent or invalid: a fixed bucket in production, the loopback address elsewhere.
 */
export function clientAddressFrom(headers: Headers, options: ClientAddressOptions): string {
  const fallback = options.production ? "unknown" : "127.0.0.1";
  const elements = (headers.get(FORWARDED_FOR_HEADER) ?? "").split(",").map((element) => element.trim());
  const candidate = elements[elements.length - options.trustedProxyHops];
  return candidate === undefined ? fallback : (normalize(candidate) ?? fallback);
}

function normalize(address: string): string | undefined {
  const withoutZone = address.split("%")[0] ?? "";
  switch (isIP(withoutZone)) {
    case 4:
      return withoutZone;
    case 6:
      return normalizeIPv6(withoutZone);
    default:
      return undefined;
  }
}

function normalizeIPv6(address: string): string {
  const groups = ipv6Groups(address);
  if (IPV4_MAPPED_PREFIX.every((value, index) => groups[index] === value)) {
    const [high = 0, low = 0] = groups.slice(IPV4_MAPPED_PREFIX.length);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  const prefix = groups.slice(0, IPV6_PREFIX_GROUPS);
  while (prefix.length > 0 && prefix[prefix.length - 1] === 0) {
    prefix.pop();
  }
  return `${prefix.map((group) => group.toString(16)).join(":")}::`;
}

/** The eight 16-bit groups of a valid IPv6 address (`::` expanded, embedded IPv4 converted). */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest = ""] = text.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const restGroups = rest === "" ? [] : rest.split(":");
  const missing = IPV6_GROUPS - headGroups.length - restGroups.length;
  return [...headGroups, ...Array<string>(missing).fill("0"), ...restGroups].map((group) => parseInt(group, 16));
}
