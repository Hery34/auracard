/** Content of the QR: stable, depends on the code only (never on the slug). `siteUrl` has no trailing slash. */
export function qrCodeUrl(siteUrl: string, code: string): string {
  return `${siteUrl}/q/${code}`;
}
