/** Webviews of social apps (`docs/architecture.md` §5.3): they often cannot open a downloaded vCard. */
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|BytedanceWebview|musical_ly|Snapchat|Pinterest|\bLine\//i;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER.test(userAgent);
}
