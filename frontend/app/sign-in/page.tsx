import { auth } from '@/lib/auth'
import AuthForm from '@/components/auth-form'
import { headers, redirect } from 'next/headers'

export default async function SignInPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect('/')

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <AuthForm mode="sign-in" />
      </div>
    </div>
  )
}
