import { Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '../components/ui'

export function NotAllowed() {
  return (
    <Card className="mx-auto mt-10 max-w-md py-12 text-center">
      <Lock className="mx-auto size-10 text-gold" />
      <p className="mt-3 font-semibold text-navy">Access restricted</p>
      <p className="px-6 text-sm text-ink-dim">This section hasn’t been granted to your account. Ask your Admin if you need it.</p>
      <Link to="/" className="mt-4 inline-block text-sm font-semibold text-gold-dark">
        Back to dashboard
      </Link>
    </Card>
  )
}
