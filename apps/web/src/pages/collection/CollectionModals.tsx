import { useState } from 'react';
import {
  CHANNELS,
  NOTE_TYPES,
  TEMPLATE_PLACEHOLDERS,
  formatMoney,
  type ChannelKey,
  type NoteType,
  type PromiseInfo,
  type RuleRow,
} from '@tuition/shared';
import { get, post, patch } from '../../api/client';
import { useInvalidateMoney } from '../../api/hooks';
import { useGrades } from '../../api/grades';
import { Field, FormError, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { MoneyField } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { FormModal } from '../families/StudentActions';
import { FamilyModal } from '../families/FamilyModal';

const fmt = (d: string) => d.split('-').reverse().join('/');

export function PromiseText({ p }: { p: PromiseInfo }) {
  return (
    <>
      {p.status === 'broken' && <span className="pill r">עברה</span>} {formatMoney(p.amountAgorot)} ל-
      {fmt(p.date)}
    </>
  );
}

export function NoteModal({
  familyId,
  familyName,
  backToFamily,
}: {
  familyId: string;
  familyName: string;
  backToFamily?: boolean;
}) {
  const { close, open } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const [type, setType] = useState<NoteType>('call');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const done = () => (backToFamily ? open(<FamilyModal id={familyId} />) : close());
  return (
    <FormModal
      title={`הערת גבייה - ${familyName}`}
      submitLabel="שמירה"
      onCancel={done}
      onSubmit={async () => {
        await post(`/api/families/${familyId}/notes`, {
          type,
          note,
          ...(type === 'promise'
            ? { promiseDate: date || undefined, promiseAgorot: amount ?? undefined }
            : {}),
        });
        await invalidate();
        toast('הרישום נשמר');
        done();
      }}
    >
      {(fe) => (
        <>
          <SelectField label="סוג" value={type} onChange={(e) => setType(e.target.value as NoteType)}>
            {(Object.keys(NOTE_TYPES) as NoteType[]).map((k) => (
              <option key={k} value={k}>
                {NOTE_TYPES[k]}
              </option>
            ))}
          </SelectField>
          <Field label="הערה" value={note} onChange={(e) => setNote(e.target.value)} error={fe.note} />
          {type === 'promise' && (
            <>
              <Field
                label="תאריך הבטחה"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                error={fe.promiseDate}
              />
              <MoneyField
                label="סכום מובטח (₪)"
                value={amount}
                onChange={setAmount}
                error={fe.promiseAgorot}
              />
            </>
          )}
        </>
      )}
    </FormModal>
  );
}

export function GroupSendModal({ rules }: { rules: RuleRow[] }) {
  const { close, open } = useDialogs();
  const grades = useGrades();
  const invalidate = useInvalidateMoney();
  const [group, setGroup] = useState('all');
  const [channel, setChannel] = useState<ChannelKey>('sms');
  const [tpl, setTpl] = useState('');
  const [text, setText] = useState(
    'שלום {הורה}, נשארה יתרה לתשלום שכר לימוד בסך {יתרה}. לתשלום מהיר: {קישור}',
  );
  const template = tpl ? (rules.find((r) => r.key === tpl)?.template ?? text) : text;
  return (
    <FormModal
      title="שליחת הודעה לקבוצה"
      submitLabel="המשך"
      onCancel={close}
      onSubmit={async () => {
        const body = { group, channel, template };
        const pv = await post<{ count: number; example: string | null; channelLabel: string }>(
          '/api/messages/group/preview',
          body,
        );
        if (!pv.count) throw new Error('אין נמענים בקבוצה שנבחרה');
        open(
          <Modal
            title="אישור שליחה"
            onClose={close}
            footer={
              <>
                <button
                  className="b"
                  type="button"
                  onClick={async () => {
                    const r = await post<{ count: number; failed: number }>('/api/messages/group', {
                      ...body,
                      expectedCount: pv.count,
                    });
                    await invalidate();
                    open(
                      <Modal
                        title="ההודעות נשלחו"
                        onClose={close}
                        footer={
                          <button className="b s" type="button" onClick={close}>
                            סגור
                          </button>
                        }
                      >
                        <p>
                          {r.count - r.failed} הודעות נמסרו.
                          {r.failed > 0 &&
                            ` ${r.failed} לא נשלחו (חסר טלפון או מייל). הפרטים בהיסטוריית ההודעות.`}
                        </p>
                      </Modal>,
                    );
                  }}
                >
                  שליחה
                </button>
                <button className="b s" type="button" onClick={close}>
                  ביטול
                </button>
              </>
            }
          >
            <p>
              לשלוח {pv.count} הודעות ב{pv.channelLabel}?
            </p>
            {pv.example && (
              <>
                <p className="mu">דוגמה:</p>
                <p>{pv.example}</p>
              </>
            )}
          </Modal>,
        );
      }}
    >
      {(fe) => (
        <>
          <SelectField label="נמענים" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">כל המשפחות החייבות</option>
            <option value="big">חוב מעל 3,000 ₪</option>
            <option value="aged">חוב מעל 30 יום</option>
            <option value="fail">משפחות עם חיוב שנכשל</option>
            {grades.map((g) => (
              <option key={g} value={`grade:${g}`}>
                חייבים בכיתה {g}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="ערוץ"
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChannelKey)}
          >
            {(Object.keys(CHANNELS) as ChannelKey[]).map((c) => (
              <option key={c} value={c}>
                {CHANNELS[c]}
              </option>
            ))}
          </SelectField>
          <SelectField label="תבנית" value={tpl} onChange={(e) => setTpl(e.target.value)}>
            <option value="">טקסט חופשי</option>
            {rules.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <div className="field" style={{ gridColumn: '1/-1' }}>
            <label htmlFor="grp-text">תוכן ההודעה</label>
            <textarea
              id="grp-text"
              rows={3}
              value={template}
              disabled={!!tpl}
              onChange={(e) => setText(e.target.value)}
            />
            {fe.template && <span className="field-err">{fe.template}</span>}
            <span className="mu">משתנים: {TEMPLATE_PLACEHOLDERS.join(' ')}</span>
          </div>
        </>
      )}
    </FormModal>
  );
}

export function RuleEditModal({ rule }: { rule: RuleRow }) {
  const { close } = useDialogs();
  const invalidate = useInvalidateMoney();
  const [channel, setChannel] = useState<ChannelKey>(rule.channel);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [template, setTemplate] = useState(rule.template);
  return (
    <FormModal
      title={`עריכת תזכורת - ${rule.name}`}
      submitLabel="שמירה"
      onCancel={close}
      onSubmit={async () => {
        await patch(`/api/messages/rules/${rule.key}`, { channel, enabled, template });
        await invalidate();
        close();
      }}
    >
      {(fe) => (
        <>
          <SelectField
            label="ערוץ"
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChannelKey)}
          >
            {(Object.keys(CHANNELS) as ChannelKey[]).map((c) => (
              <option key={c} value={c}>
                {CHANNELS[c]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="סטטוס"
            value={enabled ? '1' : '0'}
            onChange={(e) => setEnabled(e.target.value === '1')}
          >
            <option value="1">פעילה</option>
            <option value="0">כבויה</option>
          </SelectField>
          <div className="field" style={{ gridColumn: '1/-1' }}>
            <label htmlFor="rule-text">תבנית ההודעה</label>
            <textarea
              id="rule-text"
              rows={3}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            />
            {fe.template && <span className="field-err">{fe.template}</span>}
            <span className="mu">משתנים: {TEMPLATE_PLACEHOLDERS.join(' ')}</span>
          </div>
        </>
      )}
    </FormModal>
  );
}

export function RuleTestModal({ rule }: { rule: RuleRow }) {
  const { close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const [data, setData] = useState<{ count: number; example: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!data && !err) {
    void get<{ count: number; example: string | null }>(`/api/messages/rules/${rule.key}/preview`).then(
      setData,
      (e: Error) => setErr(e.message),
    );
  }
  return (
    <Modal
      title={`בדיקת כלל: ${rule.name}`}
      onClose={close}
      footer={
        <>
          <button
            className="b"
            type="button"
            disabled={!data?.count}
            onClick={async () => {
              const r = await post<{ queued: number }>(`/api/messages/rules/${rule.key}/run`);
              await invalidate();
              close();
              toast(r.queued ? `${r.queued} הודעות יצאו לשליחה` : 'אין הודעות חדשות לשליחה (כבר נשלחו)');
            }}
          >
            שלח עכשיו
          </button>
          <button className="b s" type="button" onClick={close}>
            סגור
          </button>
        </>
      }
    >
      {data && (
        <>
          <p>
            הכלל היה שולח כעת <b>{data.count}</b> הודעות ב{CHANNELS[rule.channel]}.
          </p>
          {data.example && (
            <>
              <p className="mu">דוגמה:</p>
              <p>{data.example}</p>
            </>
          )}
          <p className="mu">הודעות SMS ווואטסאפ אוטומטיות יוצאות רק בין 08:00 ל-21:00, ולא בשבת ובחג.</p>
        </>
      )}
      <FormError message={err} />
    </Modal>
  );
}
