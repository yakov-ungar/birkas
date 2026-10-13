import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALL_PERMISSIONS,
  CUSTOM_ROLE,
  PERMISSIONS,
  ROLES,
  ROLE_NAMES,
  type Permission,
  type UserRow,
} from '@tuition/shared';
import { HttpError, get, patch, post } from '../../api/client';
import { useAuth } from '../../app/auth';
import { Field, FormError, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { rowButton } from '../../components/format';
import { AuditLogCard } from './AuditLogCard';

const STATUS: Record<UserRow['status'], [string, string]> = {
  active: ['פעיל', 'g'],
  disabled: ['מושבת', 'r'],
  invited: ['ממתין להזמנה', 'o'],
  locked: ['נעול זמנית', 'r'],
};

export function UsersPage() {
  const { me } = useAuth();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<{ users: UserRow[] }>('/api/users') });

  return (
    <>
      <h2>משתמשים והרשאות</h2>
      <div className="row">
        <button className="b" type="button" onClick={() => setCreating(true)}>
          משתמש חדש
        </button>
      </div>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>משתמש</th>
              <th>אימייל</th>
              <th>תפקיד</th>
              <th>הרשאות</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.users.map((u) => (
              <tr key={u.id} {...rowButton(() => setEditing(u))} aria-label={`עריכת ${u.name}`}>
                <td>
                  {u.name}
                  {u.id === me?.user.id ? ' (אתה)' : ''}
                </td>
                <td className="ltr">{u.email}</td>
                <td>{u.role}</td>
                <td>
                  {u.permissions.length} מתוך {ALL_PERMISSIONS.length}
                </td>
                <td>
                  <span className={`pill ${STATUS[u.status][1]}`}>{STATUS[u.status][0]}</span>
                </td>
              </tr>
            ))}
            {users.isLoading && (
              <tr>
                <td colSpan={5}>טוען...</td>
              </tr>
            )}
          </tbody>
        </table>
        {users.error && <FormError message={(users.error as Error).message} />}
        <p className="mu">לחיצה על משתמש פותחת עריכת הרשאות.</p>
      </div>
      <RoleMatrix />
      <AuditLogCard />
      {creating && <CreateUserModal onClose={() => setCreating(false)} />}
      {editing && (
        <EditUserModal user={editing} onClose={() => setEditing(null)} isMe={editing.id === me?.user.id} />
      )}
    </>
  );
}

function RoleMatrix() {
  return (
    <div className="card tw">
      <b>הרשאות ברירת מחדל לפי תפקיד</b>
      <table>
        <thead>
          <tr>
            <th>הרשאה</th>
            {ROLE_NAMES.map((r) => (
              <th key={r}>{r}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_PERMISSIONS.map((p) => (
            <tr key={p}>
              <td>{PERMISSIONS[p]}</td>
              {ROLE_NAMES.map((r) => (
                <td key={r}>
                  {ROLES[r]!.includes(p) ? (
                    <span aria-label="כן">✓</span>
                  ) : (
                    <span className="sr-only">לא</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(ROLE_NAMES[0]!);
  const m = useMutation({
    mutationFn: () => post<{ user: UserRow }>('/api/users', { name, email, role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
      toast(`נשלחה הזמנה ל-${email}. ההרשאות נטענו לפי התפקיד`);
      onClose();
    },
  });
  const fe = m.error instanceof HttpError ? m.error.fields : undefined;
  return (
    <Modal
      title="משתמש חדש"
      onClose={onClose}
      footer={
        <>
          <button className="b" type="submit" form="new-user" disabled={m.isPending}>
            יצירה ושליחת הזמנה
          </button>
          <button className="b s" type="button" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <form
        id="new-user"
        className="cc"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="שם" value={name} onChange={(e) => setName(e.target.value)} required error={fe?.name} />
        <Field
          label="אימייל"
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          error={fe?.email}
        />
        <SelectField label="תפקיד" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLE_NAMES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </SelectField>
      </form>
      <p className="mu">המשתמש יקבל במייל קישור חד-פעמי להגדרת סיסמה ואימות דו-שלבי.</p>
      <FormError message={m.error?.message} />
    </Modal>
  );
}

function EditUserModal({ user, onClose, isMe }: { user: UserRow; onClose: () => void; isMe: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [role, setRole] = useState(ROLES[user.role] ? user.role : CUSTOM_ROLE);
  const [perms, setPerms] = useState<Set<Permission>>(new Set(user.permissions));
  const [active, setActive] = useState(user.active);

  const save = useMutation({
    mutationFn: () =>
      patch<{ user: UserRow }>(`/api/users/${user.id}`, { role, permissions: [...perms], active }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
      toast('ההרשאות נשמרו');
      onClose();
    },
  });
  const resend = useMutation({
    mutationFn: () => post(`/api/users/${user.id}/invite`),
    onSuccess: () => toast('ההזמנה נשלחה מחדש'),
  });

  const onRole = (r: string) => {
    setRole(r);
    const p = ROLES[r];
    if (p) setPerms(new Set(p));
  };
  const toggle = (p: Permission) => {
    const n = new Set(perms);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    setPerms(n);
    setRole(CUSTOM_ROLE);
  };

  return (
    <Modal
      title={user.name}
      onClose={onClose}
      footer={
        <>
          <button className="b" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            שמירה
          </button>
          {user.status === 'invited' && (
            <button className="b s" type="button" onClick={() => resend.mutate()} disabled={resend.isPending}>
              שליחת הזמנה מחדש
            </button>
          )}
          <button className="b s" type="button" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <p className="mu ltr">{user.email}</p>
      <SelectField
        label="תפקיד (טוען הרשאות ברירת מחדל)"
        value={role}
        onChange={(e) => onRole(e.target.value)}
      >
        {ROLE_NAMES.map((r) => (
          <option key={r}>{r}</option>
        ))}
        <option>{CUSTOM_ROLE}</option>
      </SelectField>
      <fieldset style={{ margin: '10px 0', border: 0, padding: 0 }}>
        <legend className="sr-only">הרשאות</legend>
        {ALL_PERMISSIONS.map((p) => (
          <label key={p} className="chk">
            <input type="checkbox" checked={perms.has(p)} onChange={() => toggle(p)} /> {PERMISSIONS[p]}
          </label>
        ))}
      </fieldset>
      <label className="chk">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> משתמש פעיל
      </label>
      {isMe && <p className="mu">אי אפשר להסיר מעצמך ניהול משתמשים או להשבית את עצמך.</p>}
      <FormError message={save.error?.message ?? resend.error?.message} />
    </Modal>
  );
}
