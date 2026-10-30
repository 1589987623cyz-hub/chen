import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/features/ConfigContext'
import { PageTitle, TextField } from '@/features/shared'
import { useI18n } from '@/i18n'
import { cloudEnabled, createInvite, listCollaborators, revokeCollaborator, type Collaborator } from '@/services/repo'

export default function Collaborators() {
  const { t } = useI18n()
  const { config, role } = useConfig()
  const [items, setItems] = useState<Collaborator[]>([])
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(() => {
    if (cloudEnabled && role === 'owner') listCollaborators(config.id).then(setItems).catch(() => setItems([]))
  }, [config.id, role])

  useEffect(refresh, [refresh])

  const content = () => {
    if (role !== 'owner') return <p>{t('collab.ownerOnly')}</p>
    if (!cloudEnabled) return <p className="rounded-md border border-line bg-soft p-3">{t('collab.needCloud')}</p>
    return (
      <>
        <Button
          onClick={async () => {
            setLink(await createInvite(config.id))
            setCopied(false)
            refresh()
          }}
        >
          {t('collab.invite')}
        </Button>
        {link && (
          <div className="mt-4 grid gap-2">
            <TextField label={t('collab.link')} readOnly value={link} onFocus={(e) => e.target.select()} />
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(link)
                setCopied(true)
              }}
            >
              {t('collab.copy')}
            </Button>
            <p role="status">{copied && t('collab.copied')}</p>
          </div>
        )}
        <ul className="mt-6 grid gap-2">
          {items.length === 0 && <li>{t('collab.empty')}</li>}
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3">
              <span>{item.email ?? t('collab.pending')} · {t(`collab.${item.status}`)}</span>
              <Button variant="danger" onClick={() => revokeCollaborator(item.id).then(refresh)}>{t('collab.revoke')}</Button>
            </li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <div className="max-w-2xl">
      <PageTitle>{t('collab.title')}</PageTitle>
      <p className="mt-1 mb-4">
        <Link to=".." relative="path" className="underline">{t('common.back')}</Link>
      </p>
      <p className="mb-4 text-muted">{t('collab.lead')}</p>
      {content()}
    </div>
  )
}
