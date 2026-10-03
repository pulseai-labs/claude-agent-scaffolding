import type { Register } from 'claude-code'
import { ROLES } from './rules'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const role = await $.env.get('SEAT_MODS_ROLE')
    if (role !== undefined && (ROLES as readonly string[]).includes(role)) $.ui.status(`seat: ${role}`)
    return next(e)
  })
}
