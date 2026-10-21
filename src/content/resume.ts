/**
 * The owner's CV, hosted on Reactive Resume. The page sends `X-Frame-Options: DENY`,
 * so it cannot be embedded: every entry point (the CV pill, the card's OPEN CV button,
 * the BBS menu, the HTML layer) opens it in a new tab.
 */
export const RESUME = {
  label: 'CV',
  url: 'https://rxresu.me/jeandv/cv-jean-rondon',
  host: 'rxresu.me',
} as const
