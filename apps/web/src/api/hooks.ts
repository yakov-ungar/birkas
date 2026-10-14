import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FamilyCard, FamilyListRow, StudentCard, StudentListRow } from '@tuition/shared';
import { get } from './client';

export const useStudents = (params = 'filter=all') =>
  useQuery({
    queryKey: ['students', params],
    queryFn: () => get<{ students: StudentListRow[] }>(`/api/students?${params}`),
  });

export const useFamilies = () =>
  useQuery({ queryKey: ['families'], queryFn: () => get<{ families: FamilyListRow[] }>('/api/families') });

export const useStudent = (id: string) =>
  useQuery({ queryKey: ['student', id], queryFn: () => get<StudentCard>(`/api/students/${id}`) });

export const useFamily = (id: string) =>
  useQuery({ queryKey: ['family', id], queryFn: () => get<FamilyCard>(`/api/families/${id}`) });

export interface Catalog {
  items: { id: string; name: string; defaultAgorot: number; type: string }[];
}
export const useCatalog = () =>
  useQuery({ queryKey: ['catalog'], queryFn: () => get<Catalog>('/api/catalog') });

export interface SettingsView {
  settings: { grades: string[]; activeYearName: string; schoolName: string };
}

/** Every query whose data can change after a money operation. */
const MONEY_KEYS = [
  'students',
  'families',
  'student',
  'family',
  'charges',
  'receipts',
  'receipt',
  'audit',
  'statement',
  'search',
  'plans',
  'plan',
  'plan-cards',
  'cards',
  'dashboard',
  'alerts',
  'due',
  'checks',
  'cash',
  'bank',
  'standing-orders',
  'masav',
];

/** After any money change: every list and card may show different balances. */
export function useInvalidateMoney() {
  const qc = useQueryClient();
  return () => Promise.all(MONEY_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
