import { redirect } from 'next/navigation';
import { getRequestContext } from '@/server/context';
import { HOME_PATH, LOGIN_PATH } from '@/lib/routes';

export default async function RootPage(): Promise<never> {
  const { session } = await getRequestContext();
  redirect(session ? HOME_PATH : LOGIN_PATH);
}
