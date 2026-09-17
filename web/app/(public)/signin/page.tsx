import { SignInScreen } from '@/components/auth'

export const metadata = { title: 'Sign in · Ottopus' }

/**
 * The same flow as the landing dialog, as a page. This is where a shell route
 * sends someone with no session, and where a bookmarked link lands.
 */
export default function SignIn() {
  return <SignInScreen />
}
