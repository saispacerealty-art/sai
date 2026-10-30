import { useQuery } from '@tanstack/react-query'
import { Loading } from '../../components/ui'
import { rpc } from '../../lib/data'
import { MailForm, type MailAccount } from './MailTab'

export function MyMailboxPage() {
  const box = useQuery({ queryKey: ['my-mailbox'], queryFn: () => rpc<MailAccount | null>('get_my_mailbox') })
  if (box.isLoading) return <Loading />
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-ink">My mailbox</h1>
      <MailForm key={box.data?.updated_at ?? 'none'} initial={box.data ?? null} mine />
    </div>
  )
}
