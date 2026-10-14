export const AGING_LABELS = ['שוטף', '31-60 יום', '61-90 יום', '90+ יום'] as const;

export const PAY_STATUS: Record<string, [string, string]> = {
  paid: ['שולם', 'g'],
  partial: ['חלקי', 'o'],
  debt: ['חוב', 'r'],
};
