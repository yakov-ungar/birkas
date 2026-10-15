import type { ChannelKey } from '@tuition/shared';
import { useAuth } from './auth';

/** Stage 9: the school sends email only unless text messaging is switched on in settings. */
export function useChannels(): ChannelKey[] {
  const { me } = useAuth();
  return me?.school.textMessaging ? ['sms', 'whatsapp', 'email'] : ['email'];
}
