import { DEFAULT_GRADES } from '@tuition/shared';
import { useAuth } from '../app/auth';

/** Grade list comes with /api/auth/me so every screen can use it without the settings permission. */
export function useGrades(): string[] {
  return useAuth().me?.school.grades ?? DEFAULT_GRADES;
}
