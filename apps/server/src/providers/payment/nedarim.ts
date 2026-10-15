/**
 * נדרים פלוס (Nedarim Plus) card payments.
 *
 * The parent or staff member types the card into Nedarim's own iframe
 * (https://www.matara.pro/nedarimplus/iframe); our page only sends the transaction details with the
 * "FinishTransaction2" postMessage, and Nedarim reports the result to our server on the CallBack URL.
 * The card number and CVV never reach this server, so Nedarim's server API that takes a card number
 * (DebitCard.aspx) is deliberately not used.
 *
 * Built from public integrations of Nedarim's iframe protocol (their documentation site was not
 * reachable from the build machine). The callback field names are read tolerantly, and anything
 * not clearly a success is treated as a failure; the first ₪1 test payment confirms them
 * (docs/stages/STAGE-9.md).
 */
export const NEDARIM_IFRAME_URL = 'https://www.matara.pro/nedarimplus/iframe?language=he';
export const NEDARIM_ORIGINS = ['https://www.matara.pro', 'https://matara.pro'];

export interface NedarimConfig {
  /** מספר מוסד */
  mosad: string;
  /** ApiValid from the Nedarim back office ("מפתחות API"). */
  apiValid: string;
}

/** The fields of FinishTransaction2, all of them present (Nedarim requires the full set). */
export function transactionFields(
  cfg: NedarimConfig,
  o: {
    intentId: string;
    amountAgorot: number;
    payerName: string;
    phone: string;
    email: string;
    comment: string;
    callbackUrl: string;
  },
) {
  return {
    Mosad: cfg.mosad,
    ApiValid: cfg.apiValid,
    Zeout: '',
    PaymentType: 'Ragil',
    Amount: (o.amountAgorot / 100).toFixed(2).replace(/\.00$/, ''),
    Tashlumim: '1',
    Currency: '1',
    // Nedarim's sample puts the whole name in FirstName and leaves LastName empty.
    FirstName: o.payerName,
    LastName: '',
    Street: '',
    City: '',
    Phone: o.phone,
    Mail: o.email,
    Groupe: '',
    Comment: o.comment.slice(0, 100),
    Param1: o.intentId,
    Param2: '',
    CallBack: o.callbackUrl,
    CallBackMailError: '',
  };
}

export interface NedarimCallback {
  intentId: string | null;
  ok: boolean;
  amountAgorot: number | null;
  transactionId: string | null;
  confirmation: string | null;
  last4: string | null;
  message: string | null;
}

/** Reads the callback whatever the letter case of its keys; unknown statuses count as failure. */
export function parseCallback(payload: Record<string, unknown>): NedarimCallback {
  const lower = new Map(Object.entries(payload).map(([k, v]) => [k.toLowerCase(), v]));
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = lower.get(k.toLowerCase());
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };
  const status = (get('Status') ?? '').toLowerCase();
  const amount = get('Amount', 'Sum');
  const parsedAmount = amount && /^\d+(\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : null;
  const last = get('LastNum', 'LastNumbers', 'LastDigits', 'CardLast4');
  return {
    intentId: get('Param1'),
    ok: ['ok', 'success', 'approved', '1', 'true'].includes(status),
    amountAgorot: parsedAmount,
    transactionId: get('TransactionId', 'TransactionID', 'Id', 'TransId'),
    confirmation: get('Confirmation', 'AuthorisationNumber', 'ApprovalNumber'),
    last4: last ? last.replace(/\D/g, '').slice(-4) || null : null,
    message: get('Message', 'ErrorMessage'),
  };
}
