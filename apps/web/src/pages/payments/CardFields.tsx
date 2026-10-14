import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface CardTokenResult {
  token: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  holderName: string;
}

export interface CardFieldsHandle {
  tokenize: () => Promise<CardTokenResult>;
}

/**
 * The payment provider's hosted fields in an iframe. Card number and CVV are typed there;
 * this page only ever receives the resulting token and card metadata.
 */
export const CardFields = forwardRef<CardFieldsHandle, { src: string }>(function CardFields({ src }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const pending = useRef(
    new Map<string, { resolve: (r: CardTokenResult) => void; reject: (e: Error) => void }>(),
  );

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data as { type?: string; id?: string; result?: CardTokenResult; message?: string };
      if (d.type === 'fields-ready') setReady(true);
      const p = d.id ? pending.current.get(d.id) : undefined;
      if (!p) return;
      pending.current.delete(d.id!);
      if (d.type === 'tokenized' && d.result) p.resolve(d.result);
      else p.reject(new Error(d.message ?? 'שגיאה בשדות הכרטיס'));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useImperativeHandle(ref, () => ({
    tokenize: () =>
      new Promise<CardTokenResult>((resolve, reject) => {
        const w = frame.current?.contentWindow;
        if (!w) return reject(new Error('שדות הכרטיס לא נטענו'));
        const id = crypto.randomUUID();
        pending.current.set(id, { resolve, reject });
        w.postMessage({ type: 'tokenize', id }, window.location.origin);
        setTimeout(() => {
          if (pending.current.delete(id)) reject(new Error('חברת הסליקה לא הגיבה. נסו שוב'));
        }, 15_000);
      }),
  }));

  return (
    <div>
      <iframe
        ref={frame}
        src={src}
        title="שדות כרטיס אשראי מאובטחים של חברת הסליקה"
        style={{ width: '100%', height: 330, border: '1px solid var(--line)', borderRadius: 8 }}
      />
      {!ready && <p className="mu">טוען שדות מאובטחים...</p>}
    </div>
  );
});
