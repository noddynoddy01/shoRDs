/**
 * Public site details, read from build-time environment variables so nothing is invented or hard-coded. A link or address that is not configured
 * is simply not shown (the footer says plainly that the legal pages are not published yet). Values are public by nature: never put a secret here.
 */
const clean = (v: string | undefined): string | null => {
  const t = (v || "").trim();
  return t.length > 0 ? t : null;
};
const https = (v: string | undefined): string | null => {
  const t = clean(v);
  return t && /^https:\/\/[^\s]+$/.test(t) ? t : null;
};

export const site = {
  contactEmail: ((): string | null => { const t = clean(process.env.EXPO_PUBLIC_CONTACT_EMAIL); return t && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? t : null; })(),
  privacyUrl: https(process.env.EXPO_PUBLIC_PRIVACY_URL),
  termsUrl: https(process.env.EXPO_PUBLIC_TERMS_URL),
  socials: [
    { label: "GitHub", icon: "logo-github" as const, url: https(process.env.EXPO_PUBLIC_SOCIAL_GITHUB) },
    { label: "LinkedIn", icon: "logo-linkedin" as const, url: https(process.env.EXPO_PUBLIC_SOCIAL_LINKEDIN) },
    { label: "X", icon: "logo-twitter" as const, url: https(process.env.EXPO_PUBLIC_SOCIAL_X) }
  ].filter((s): s is { label: string; icon: "logo-github" | "logo-linkedin" | "logo-twitter"; url: string } => s.url !== null)
};
