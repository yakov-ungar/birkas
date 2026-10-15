import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { NedarimStart, NedarimStatus, PaymentResult } from '@tuition/shared';

export interface NedarimFrameHandle {
  /** Opens the payment on our server, has Nedarim charge the card, and waits for the server's record. */
  pay: () => Promise<PaymentResult>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * נדרים פלוס's own card form in an iframe. The card is typed there and goes straight to Nedarim;
 * this page sends only the transaction details (FinishTransaction2). Nedarim's answer in the
 * browser is only a hint: the payment counts once Nedarim's server has called ours.
 */
export const NedarimFrame = forwardRef<
  NedarimFrameHandle,
  {
    iframeUrl: string;
    start: () => Promise<NedarimStart>;
    status: (intentId: string) => Promise<NedarimStatus>;
  }
>(function NedarimFrame({ iframeUrl, start, status }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const [loaded, setLoaded] = useState(false);
  const origin = new URL(iframeUrl).origin;
  const waiting = useRef<((v: { ok: boolean; message: string }) => void) | null>(null);
  const origins = useRef<string[]>([origin, origin.replace('://www.', '://')]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!origins.current.includes(e.origin) || e.source !== frame.current?.contentWindow) return;
      const d = e.data as { Name?: string; Value?: unknown };
      if (d?.Name === 'Height' && Number(d.Value) > 0) setHeight(Math.min(900, Number(d.Value) + 10));
      if (d?.Name === 'TransactionResponse' && waiting.current) {
        const v = (d.Value ?? {}) as { Status?: string; Message?: string };
        waiting.current({ ok: v.Status !== 'Error', message: v.Message ?? '' });
        waiting.current = null;
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const send = (msg: unknown) => frame.current?.contentWindow?.postMessage(msg, origin);

  useImperativeHandle(ref, () => ({
    pay: async () => {
      if (!loaded) throw new Error('טופס התשלום של נדרים פלוס עוד נטען');
      const s = await start();
      origins.current = s.origins;
      const answer = new Promise<{ ok: boolean; message: string }>((resolve) => {
        waiting.current = resolve;
      });
      send({ Name: 'FinishTransaction2', Value: s.transaction });
      const r = await Promise.race([answer, sleep(120_000).then(() => null)]);
      waiting.current = null;
      if (r && !r.ok) throw new Error(r.message || 'החיוב נכשל');
      // Wait for Nedarim's server callback, which records the payment and the receipt.
      for (let i = 0; i < 40; i++) {
        const st = await status(s.intentId);
        if (st.status === 'paid' && st.result) return st.result;
        if (st.status === 'failed') throw new Error(st.message || 'החיוב נכשל');
        await sleep(1500);
      }
      throw new Error(
        'נדרים פלוס עוד לא אישרו את התשלום מול המערכת. אין לחייב שוב: בדקו בעוד כמה דקות ברשימת התשלומים',
      );
    },
  }));

  return (
    <div>
      <iframe
        ref={frame}
        src={iframeUrl}
        title="טופס תשלום מאובטח של נדרים פלוס"
        onLoad={() => {
          setLoaded(true);
          send({ Name: 'GetHeight' });
        }}
        style={{ width: '100%', height, border: '1px solid var(--line)', borderRadius: 8 }}
      />
      {!loaded && <p className="mu">טוען את טופס התשלום של נדרים פלוס...</p>}
      <p className="mu">פרטי הכרטיס מוקלדים אצל נדרים פלוס ואינם עוברים במערכת.</p>
    </div>
  );
});
