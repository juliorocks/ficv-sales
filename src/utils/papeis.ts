// Papel principal (`role`) mais os extras (`papeis_extra`): a secretaria que também atende o Comercial
// tem role 'secretaria' e extra 'agent'. O banco já trata isso em is_staff().
export const temPapel = (
    u: { role?: string | null; papeis_extra?: string[] | null } | null | undefined,
    ...papeis: string[]
): boolean => !!u && [u.role, ...(u.papeis_extra ?? [])].some((p) => !!p && papeis.includes(p))
