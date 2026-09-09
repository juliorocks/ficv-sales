import { useEffect, useRef, useState } from "react"
import { Camera, Loader2, Check, Lock, User as UserIcon, Mail } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { AgentAvatar } from "./AgentAdmin"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { showError, showSuccess } from "@/utils/toast"

interface MyProfileProps {
    profile: { id: string; full_name: string; email: string; avatar_url?: string | null; role: string } | null
    onUpdated: () => void
}

export function MyProfile({ profile, onUpdated }: MyProfileProps) {
    const fileRef = useRef<HTMLInputElement>(null)
    const [name, setName] = useState(profile?.full_name ?? "")
    const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null)
    const [uploading, setUploading] = useState(false)
    const [savingInfo, setSavingInfo] = useState(false)

    const [email, setEmail] = useState(profile?.email ?? "")
    const [savingEmail, setSavingEmail] = useState(false)

    const [pw1, setPw1] = useState("")
    const [pw2, setPw2] = useState("")
    const [savingPw, setSavingPw] = useState(false)

    useEffect(() => {
        setName(profile?.full_name ?? "")
        setAvatarUrl(profile?.avatar_url ?? null)
        setEmail(profile?.email ?? "")
    }, [profile?.id])

    if (!profile) return null

    const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (!file.type.startsWith("image/")) { showError("Envie um arquivo de imagem."); return }
        if (file.size > 4 * 1024 * 1024) { showError("Imagem muito grande (máx. 4 MB)."); return }
        setUploading(true)
        try {
            const ext = (file.name.split(".").pop() || "jpg").toLowerCase()
            const path = `avatars/${profile.id}.${ext}`
            const { error: upErr } = await supabase.storage.from("agent-photos").upload(path, file, { upsert: true, cacheControl: "0" })
            if (upErr) throw upErr
            const { data } = supabase.storage.from("agent-photos").getPublicUrl(path)
            // cache-bust pra a nova foto aparecer na hora
            const url = `${data.publicUrl}?v=${Date.now()}`
            const { error: dbErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", profile.id)
            if (dbErr) throw dbErr
            setAvatarUrl(url)
            showSuccess("Foto atualizada.")
            onUpdated()
        } catch (err: any) {
            showError(`Não consegui salvar a foto: ${err?.message || err}`)
        } finally {
            setUploading(false)
            if (fileRef.current) fileRef.current.value = ""
        }
    }

    const saveInfo = async () => {
        if (name.trim().length < 2) { showError("O nome precisa ter pelo menos 2 letras."); return }
        setSavingInfo(true)
        try {
            const { error } = await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", profile.id)
            if (error) throw error
            showSuccess("Nome atualizado.")
            onUpdated()
        } catch (err: any) {
            showError(`Erro ao salvar: ${err?.message || err}`)
        } finally { setSavingInfo(false) }
    }

    const saveEmail = async () => {
        const e = email.trim().toLowerCase()
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { showError("E-mail inválido."); return }
        if (e === profile.email) { showError("Esse já é o seu e-mail."); return }
        setSavingEmail(true)
        try {
            const { error } = await supabase.auth.updateUser({ email: e })
            if (error) throw error
            showSuccess("Enviamos um link de confirmação para o novo e-mail. A troca só vale depois que você confirmar.")
        } catch (err: any) {
            showError(`Erro ao trocar o e-mail: ${err?.message || err}`)
        } finally { setSavingEmail(false) }
    }

    const savePw = async () => {
        if (pw1.length < 6) { showError("A senha precisa ter pelo menos 6 caracteres."); return }
        if (pw1 !== pw2) { showError("As senhas não conferem."); return }
        setSavingPw(true)
        try {
            const { error } = await supabase.auth.updateUser({ password: pw1 })
            if (error) throw error
            showSuccess("Senha alterada.")
            setPw1(""); setPw2("")
        } catch (err: any) {
            showError(`Erro ao trocar a senha: ${err?.message || err}`)
        } finally { setSavingPw(false) }
    }

    const Section = ({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) => (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <div className="flex items-center gap-2 mb-5">
                <div className="p-1.5 rounded-lg bg-primary/10"><Icon size={16} className="text-primary" /></div>
                <h3 className="text-sm font-bold text-[var(--text-main)]">{title}</h3>
            </div>
            {children}
        </div>
    )

    return (
        <div className="max-w-2xl mx-auto py-6 space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-[var(--text-main)]">Meu Perfil</h2>
                <p className="text-sm text-[var(--text-muted)]">Edite seus dados de acesso e sua foto.</p>
            </div>

            <Section icon={UserIcon} title="Foto e nome">
                <div className="flex items-center gap-5">
                    <div className="relative shrink-0">
                        <AgentAvatar name={name || profile.full_name} photoUrl={avatarUrl} size={72} />
                        <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            disabled={uploading}
                            className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary flex items-center justify-center border-2 border-[var(--bg-card)] hover:bg-primary/90 disabled:opacity-60"
                            title="Trocar foto"
                        >
                            {uploading ? <Loader2 size={12} className="animate-spin text-white" /> : <Camera size={12} className="text-white" />}
                        </button>
                        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                    </div>
                    <div className="flex-1 space-y-1.5">
                        <Label className="text-xs">Nome completo</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
                    </div>
                </div>
                <div className="flex justify-end mt-4">
                    <Button size="sm" onClick={saveInfo} disabled={savingInfo || name.trim() === profile.full_name}>
                        {savingInfo ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar nome
                    </Button>
                </div>
            </Section>

            <Section icon={Mail} title="E-mail de acesso">
                <div className="space-y-1.5">
                    <Label className="text-xs">E-mail</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    <p className="text-[11px] text-[var(--text-muted)]">Ao trocar, você recebe um link de confirmação no e-mail novo — a mudança só vale depois de confirmar.</p>
                </div>
                <div className="flex justify-end mt-4">
                    <Button size="sm" variant="outline" onClick={saveEmail} disabled={savingEmail || email.trim().toLowerCase() === profile.email}>
                        {savingEmail ? <Loader2 size={14} className="animate-spin" /> : null} Trocar e-mail
                    </Button>
                </div>
            </Section>

            <Section icon={Lock} title="Senha">
                <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Nova senha</Label>
                        <Input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="mín. 6 caracteres" autoComplete="new-password" />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Confirmar nova senha</Label>
                        <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
                    </div>
                </div>
                <div className="flex justify-end mt-4">
                    <Button size="sm" variant="destructive" onClick={savePw} disabled={savingPw || !pw1 || !pw2}>
                        {savingPw ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Alterar senha
                    </Button>
                </div>
            </Section>

            <p className="text-[11px] text-[var(--text-muted)] text-center">
                Perfil: <span className="font-semibold uppercase">{profile.role}</span> · alterações de equipe/permissão são feitas por um administrador.
            </p>
        </div>
    )
}
