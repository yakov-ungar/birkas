/** Placeholders from the demo: {הורה} {משפחה} {תלמיד} {יתרה} {קישור} {תאריך} {סכום} {סיבה}. */
export const TEMPLATE_VARS = ['הורה', 'משפחה', 'תלמיד', 'יתרה', 'קישור', 'תאריך', 'סכום', 'סיבה'] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARS)[number], string>>;

/** Fills known placeholders; unknown or missing ones are left as written (demo behavior). */
export function fillTemplate(t: string, vars: TemplateVars): string {
  return t.replace(/\{([^{}]+)\}/g, (m, k: string) => {
    const v = (vars as Record<string, string | undefined>)[k];
    return v === undefined ? m : v;
  });
}
