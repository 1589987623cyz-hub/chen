import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { feedbackFields, parseConfig, type Config } from '@/domain/params'
import { readStored, writeStored } from '@/i18n'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
export const cloudEnabled = supabase !== null

export type Role = 'owner' | 'helper'

export interface ConfigSummary {
  id: string
  name: string
  updatedAt: string
  role: Role
}

export interface Collaborator {
  id: string
  status: 'pending' | 'active'
  email: string | null
}

const STORE_KEY = 'exsense.configs'

function readLocal(): Record<string, Config> {
  try {
    return JSON.parse(readStored(STORE_KEY) ?? '{}') as Record<string, Config>
  } catch {
    return {}
  }
}

const writeLocal = (all: Record<string, Config>) => writeStored(STORE_KEY, JSON.stringify(all))

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function listConfigs(): Promise<ConfigSummary[]> {
  if (!supabase) {
    return Object.values(readLocal())
      .map((c) => ({ id: c.id, name: c.name, updatedAt: c.updatedAt, role: 'owner' as const }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  const session = await getSession()
  const { data, error } = await supabase
    .from('configurations')
    .select('id, name, updated_at, owner_id')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    role: row.owner_id === session?.user.id ? 'owner' : 'helper',
  }))
}

export async function loadConfig(id: string): Promise<{ config: Config; role: Role } | null> {
  if (!supabase) {
    const config = readLocal()[id]
    return config ? { config: parseConfig(JSON.stringify(config)), role: 'owner' } : null
  }
  const session = await getSession()
  const { data, error } = await supabase
    .from('configurations')
    .select('owner_id, configuration_versions(data, version)')
    .eq('id', id)
    .order('version', { referencedTable: 'configuration_versions', ascending: false })
    .limit(1, { referencedTable: 'configuration_versions' })
    .maybeSingle()
  if (error) throw error
  const latest = data?.configuration_versions?.[0]
  if (!latest) return null
  return {
    config: parseConfig(JSON.stringify(latest.data)),
    role: data.owner_id === session?.user.id ? 'owner' : 'helper',
  }
}

/** Saves a new immutable version. The database rejects helper edits to feedback fields too. */
export async function saveConfig(config: Config, role: Role = 'owner', previous?: Config) {
  const next = { ...config, updatedAt: new Date().toISOString() }
  if (!supabase) {
    writeLocal({ ...readLocal(), [next.id]: next })
    return next
  }
  if (role === 'helper' && previous) {
    const guarded = JSON.stringify(feedbackFields(previous)) !== JSON.stringify(feedbackFields(next))
    if (guarded) throw new Error('feedback fields are owner-only')
  }
  const { error } = await supabase.rpc('save_configuration', {
    p_id: next.id,
    p_name: next.name,
    p_data: next,
  })
  if (error) throw error
  return next
}

export async function deleteConfig(id: string) {
  if (!supabase) {
    const all = readLocal()
    delete all[id]
    writeLocal(all)
    return
  }
  const { error } = await supabase.from('configurations').delete().eq('id', id)
  if (error) throw error
}

export async function deleteAllData() {
  if (!supabase) {
    writeLocal({})
    return
  }
  const { error } = await supabase.rpc('delete_my_data')
  if (error) throw error
  await supabase.auth.signOut()
}

export async function exportAllData() {
  const summaries = await listConfigs()
  const loaded = await Promise.all(
    summaries.filter((s) => s.role === 'owner').map((s) => loadConfig(s.id)),
  )
  return loaded.flatMap((item) => (item ? [item.config] : []))
}

export async function listCollaborators(configId: string): Promise<Collaborator[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('collaborators')
    .select('id, status, helper_email')
    .eq('configuration_id', configId)
    .neq('status', 'revoked')
  if (error) throw error
  return data.map((row) => ({ id: row.id, status: row.status, email: row.helper_email }))
}

export async function createInvite(configId: string) {
  if (!supabase) throw new Error('cloud required')
  const { data, error } = await supabase.rpc('create_invite', { p_configuration_id: configId })
  if (error) throw error
  return `${location.origin}/invite/${data as string}`
}

export async function revokeCollaborator(id: string) {
  if (!supabase) return
  const { error } = await supabase.from('collaborators').update({ status: 'revoked' }).eq('id', id)
  if (error) throw error
}

export async function acceptInvite(token: string) {
  if (!supabase) throw new Error('cloud required')
  const { data, error } = await supabase.rpc('accept_invite', { p_token: token })
  if (error) throw error
  return data as string
}
