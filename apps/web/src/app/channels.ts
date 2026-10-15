import type { ChannelKey } from '@tuition/shared';
import { useAuth } from './auth';

/**
 * Channels staff may choose (stage 9): email always; a voice call (ימות המשיח) once it is connected
 * in production mode; SMS and WhatsApp only if switched on in settings.
 */
export function useChannels(): ChannelKey[] {
  const { me } = useAuth();
  const out: ChannelKey[] = me?.school.textMessaging ? ['sms', 'whatsapp'] : [];
  if (me?.school.voice) out.push('voice');
  return [...out, 'email'];
}
