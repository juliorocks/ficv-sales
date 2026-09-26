import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, ArrowDown, ArrowUp, Code2, Plus, Trash2 } from "lucide-react"
import { showError, showSuccess } from "@/utils/toast"
import { Course, MarketingForm, MarketingFormDesign, MarketingFormField, MarketingFormFieldType, MarketingFormPostSubmit } from "@/types/database"
import { FormRenderer } from "./FormRenderer"
import { EmbedCodeModal } from "./EmbedCodeModal"
import { fillPlaceholdersPreview } from "@/utils/marketingForms"

const FIELD_PALETTE: { type: MarketingFormFieldType; label: string }[] = [
    { type: "text", label: "Campo de texto" },
    { type: "phone", label: "Telefone / WhatsApp" },
    { type: "email", label: "Email" },
    { type: "select", label: "Lista suspensa" },
    { type: "checkbox", label: "Caixa de seleção" },
    { type: "radio", label: "Botões de opção" },
    { type: "static_text", label: "Texto" },
    { type: "spacer", label: "Espaçador" },
]

const PREVIEW_VARS = { nome: "João da Silva", telefone: "5511988887777", email: "joao@example.com", curso: "Curso Exemplo" }

interface MarketingFormBuilderProps {
    id: number
    onBack: () => void
}

export function MarketingFormBuilder({ id, onBack }: MarketingFormBuilderProps) {
    const queryClient = useQueryClient()
    const [tab, setTab] = useState("campos")
    const [form, setForm] = useState<MarketingForm | null>(null)
    const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [embedOpen, setEmbedOpen] = useState(false)
    const [previewValues, setPreviewValues] = useState<Record<string, string | boolean>>({})

    const { data: loaded, isLoading } = useQuery<MarketingForm>({
        queryKey: ["marketing_form", id],
        queryFn: async () => {
            const { data, error } = await supabase.from("marketing_forms").select("*").eq("id", id).single()
            if (error) throw error
            return data as MarketingForm
        },
    })

    const { data: courses } = useQuery<Course[]>({
        queryKey: ["courses"],
        queryFn: async () => {
            const { data, error } = await supabase.from("courses").select("*").order("name")
            if (error) throw error
            return data ?? []
        },
    })

    useEffect(() => { if (loaded) setForm(loaded) }, [loaded])

    const saveMutation = useMutation({
        mutationFn: async () => {
            if (!form) return
            const { error } = await supabase.from("marketing_forms").update({
                name: form.name, course_id: form.course_id, source_id: form.source_id,
                fields: form.fields, design: form.design, post_submit: form.post_submit,
                allowed_domains: form.allowed_domains, lgpd_enabled: form.lgpd_enabled, lgpd_text: form.lgpd_text,
            }).eq("id", id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["marketing_form", id] })
            queryClient.invalidateQueries({ queryKey: ["marketing_forms"] })
            showSuccess("Formulário salvo!")
        },
        onError: (error: any) => showError(error.message),
        onSettled: () => setSaving(false),
    })

    const selectedField = useMemo(() => form?.fields.find((f) => f.id === selectedFieldId) ?? null, [form, selectedFieldId])

    if (isLoading || !form) return <div className="p-8 text-center text-muted-foreground animate-pulse">Carregando formulário...</div>

    const updateField = (fieldId: string, patch: Partial<MarketingFormField>) => {
        setForm((f) => f && { ...f, fields: f.fields.map((fl) => fl.id === fieldId ? { ...fl, ...patch } : fl) })
    }
    const addField = (type: MarketingFormFieldType) => {
        const newField: MarketingFormField = { id: crypto.randomUUID(), type, label: FIELD_PALETTE.find((p) => p.type === type)?.label, required: false }
        if (type === "select" || type === "radio") newField.options = ["Opção 1", "Opção 2"]
        if (type === "spacer") newField.height = 16
        if (type === "static_text") newField.content = "Texto informativo"
        setForm((f) => f && { ...f, fields: [...f.fields, newField] })
        setSelectedFieldId(newField.id)
    }
    const removeField = (fieldId: string) => {
        setForm((f) => f && { ...f, fields: f.fields.filter((fl) => fl.id !== fieldId) })
        if (selectedFieldId === fieldId) setSelectedFieldId(null)
    }
    const moveField = (index: number, dir: -1 | 1) => {
        setForm((f) => {
            if (!f) return f
            const arr = [...f.fields]
            const target = index + dir
            if (target < 0 || target >= arr.length) return f
            ;[arr[index], arr[target]] = [arr[target], arr[index]]
            return { ...f, fields: arr }
        })
    }
    const updateDesign = (patch: Partial<MarketingFormDesign>) => setForm((f) => f && { ...f, design: { ...f.design, ...patch } })
    const updatePostSubmit = (patch: Partial<MarketingFormPostSubmit>) =>
        setForm((f) => f && { ...f, post_submit: { ...f.post_submit, ...patch } as MarketingFormPostSubmit })

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{form.name}</h1>
                        <p className="text-sm text-muted-foreground">/f/{form.slug}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setEmbedOpen(true)}>
                        <Code2 className="mr-2 h-4 w-4" /> Obter código
                    </Button>
                    <Button onClick={() => { setSaving(true); saveMutation.mutate() }} disabled={saving}>
                        {saving ? "Salvando..." : "Salvar"}
                    </Button>
                </div>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                    <TabsTrigger value="campos">Campos</TabsTrigger>
                    <TabsTrigger value="dados">Dados</TabsTrigger>
                    <TabsTrigger value="acao">Ação após envio</TabsTrigger>
                    <TabsTrigger value="design">Design</TabsTrigger>
                </TabsList>

                <TabsContent value="campos" className="mt-4">
                    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_360px] gap-4">
                        <div className="border rounded-xl bg-card/40 p-3 space-y-1 h-fit">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Adicionar campo</p>
                            {FIELD_PALETTE.map((p) => (
                                <button key={p.type} onClick={() => addField(p.type)}
                                    className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-white/5 flex items-center gap-2">
                                    <Plus className="h-3.5 w-3.5" /> {p.label}
                                </button>
                            ))}
                        </div>

                        <div className="border rounded-xl bg-card/40 p-3 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Campos do formulário</p>
                            {form.fields.map((f, i) => (
                                <div key={f.id}
                                    onClick={() => setSelectedFieldId(f.id)}
                                    className={`border rounded-lg p-3 cursor-pointer transition-colors ${selectedFieldId === f.id ? "border-primary bg-primary/5" : "border-border hover:bg-white/5"}`}>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium">{f.label || "(sem rótulo)"}</p>
                                            <p className="text-[11px] text-muted-foreground">{f.type}{f.role ? ` · ${f.role}` : ""}{f.required ? " · obrigatório" : ""}</p>
                                        </div>
                                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveField(i, -1)} disabled={i === 0}>
                                                <ArrowUp className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveField(i, 1)} disabled={i === form.fields.length - 1}>
                                                <ArrowDown className="h-3.5 w-3.5" />
                                            </Button>
                                            {!f.role && (
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeField(f.id)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {selectedField && (
                                <div className="border-t pt-3 mt-3 space-y-3">
                                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Editar campo</p>
                                    <div className="space-y-2">
                                        <Label>Rótulo</Label>
                                        <Input value={selectedField.label ?? ""} onChange={(e) => updateField(selectedField.id, { label: e.target.value })} />
                                    </div>
                                    {selectedField.type === "static_text" ? (
                                        <div className="space-y-2">
                                            <Label>Conteúdo</Label>
                                            <Textarea value={selectedField.content ?? ""} onChange={(e) => updateField(selectedField.id, { content: e.target.value })} />
                                        </div>
                                    ) : selectedField.type === "spacer" ? (
                                        <div className="space-y-2">
                                            <Label>Altura (px)</Label>
                                            <Input type="number" value={selectedField.height ?? 16} onChange={(e) => updateField(selectedField.id, { height: Number(e.target.value) })} />
                                        </div>
                                    ) : (
                                        <>
                                            <div className="space-y-2">
                                                <Label>Placeholder</Label>
                                                <Input value={selectedField.placeholder ?? ""} onChange={(e) => updateField(selectedField.id, { placeholder: e.target.value })} />
                                            </div>
                                            <label className="flex items-center gap-2 text-sm">
                                                <input type="checkbox" checked={!!selectedField.required}
                                                    onChange={(e) => updateField(selectedField.id, { required: e.target.checked })} />
                                                Obrigatório
                                            </label>
                                            {(selectedField.type === "select" || selectedField.type === "radio") && (
                                                <div className="space-y-2">
                                                    <Label>Opções (uma por linha)</Label>
                                                    <Textarea
                                                        value={(selectedField.options ?? []).join("\n")}
                                                        onChange={(e) => updateField(selectedField.id, { options: e.target.value.split("\n").filter(Boolean) })}
                                                    />
                                                </div>
                                            )}
                                        </>
                                    )}
                                    {selectedField.role && (
                                        <p className="text-[11px] text-muted-foreground">Este campo alimenta o campo "{selectedField.role}" do lead — rótulo e obrigatoriedade podem ser ajustados, mas ele não pode ser removido.</p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="border rounded-xl bg-card/40 p-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Pré-visualização</p>
                            <FormRenderer
                                fields={form.fields}
                                design={form.design}
                                values={previewValues}
                                onChange={(fid, v) => setPreviewValues((s) => ({ ...s, [fid]: v }))}
                                lgpdEnabled={form.lgpd_enabled}
                                lgpdText={form.lgpd_text}
                                submitLabel="Enviar"
                                onSubmit={(e) => e.preventDefault()}
                            />
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="dados" className="mt-4 max-w-xl space-y-4">
                    <div className="space-y-2">
                        <Label>Nome do formulário</Label>
                        <Input value={form.name} onChange={(e) => setForm((f) => f && { ...f, name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label>Curso vinculado</Label>
                        <Select value={form.course_id?.toString() ?? "none"} onValueChange={(v) => setForm((f) => f && { ...f, course_id: v === "none" ? null : Number(v) })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Sem curso vinculado</SelectItem>
                                {courses?.map((c) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Sites permitidos para incorporar (um por linha, vazio = qualquer site)</Label>
                        <Textarea
                            value={(form.allowed_domains ?? []).join("\n")}
                            onChange={(e) => setForm((f) => f && { ...f, allowed_domains: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                            placeholder={"cursos.ficv.edu.br\nficv.edu.br"}
                        />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.lgpd_enabled} onChange={(e) => setForm((f) => f && { ...f, lgpd_enabled: e.target.checked })} />
                        Ativar campo de consentimento LGPD
                    </label>
                    {form.lgpd_enabled && (
                        <div className="space-y-2">
                            <Label>Texto do consentimento</Label>
                            <Textarea value={form.lgpd_text ?? ""} onChange={(e) => setForm((f) => f && { ...f, lgpd_text: e.target.value })} />
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="acao" className="mt-4 max-w-xl space-y-4">
                    <div className="space-y-2">
                        <Label>Ação após o envio</Label>
                        <Select value={form.post_submit.type} onValueChange={(v) => {
                            if (v === "message") updatePostSubmit({ type: "message", message: "Recebemos seus dados! Em breve entraremos em contato." } as any)
                            else if (v === "redirect") updatePostSubmit({ type: "redirect", url: "" } as any)
                            else updatePostSubmit({ type: "whatsapp", whatsapp_number: "", message_template: "Oi, {{nome}}! Já preenchi meus dados." } as any)
                        }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="message">Mostrar mensagem</SelectItem>
                                <SelectItem value="redirect">Redirecionar para URL</SelectItem>
                                <SelectItem value="whatsapp">Redirecionar para o WhatsApp</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {form.post_submit.type === "message" && (
                        <div className="space-y-2">
                            <Label>Mensagem</Label>
                            <Textarea value={form.post_submit.message} onChange={(e) => updatePostSubmit({ message: e.target.value } as any)} />
                        </div>
                    )}
                    {form.post_submit.type === "redirect" && (
                        <div className="space-y-2">
                            <Label>URL de destino</Label>
                            <Input value={form.post_submit.url} onChange={(e) => updatePostSubmit({ url: e.target.value } as any)} placeholder="https://..." />
                        </div>
                    )}
                    {form.post_submit.type === "whatsapp" && (
                        <>
                            <div className="space-y-2">
                                <Label>Número do WhatsApp (com DDI, só dígitos)</Label>
                                <Input value={form.post_submit.whatsapp_number} onChange={(e) => updatePostSubmit({ whatsapp_number: e.target.value } as any)} placeholder="5583988887777" />
                            </div>
                            <div className="space-y-2">
                                <Label>Mensagem (use {"{{nome}}"}, {"{{telefone}}"}, {"{{email}}"}, {"{{curso}}"})</Label>
                                <Textarea value={form.post_submit.message_template} onChange={(e) => updatePostSubmit({ message_template: e.target.value } as any)} />
                                <p className="text-xs text-muted-foreground">Pré-visualização: {fillPlaceholdersPreview(form.post_submit.message_template, PREVIEW_VARS)}</p>
                            </div>
                        </>
                    )}
                </TabsContent>

                <TabsContent value="design" className="mt-4 max-w-xl space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Cor de fundo</Label>
                            <input type="color" value={form.design.background_color || "#ffffff"} onChange={(e) => updateDesign({ background_color: e.target.value })} className="w-full h-10 rounded" />
                        </div>
                        <div className="space-y-2">
                            <Label>Cor da borda</Label>
                            <input type="color" value={form.design.border_color || "#dddddd"} onChange={(e) => updateDesign({ border_color: e.target.value })} className="w-full h-10 rounded" />
                        </div>
                        <div className="space-y-2">
                            <Label>Cor de fundo dos campos</Label>
                            <input type="color" value={form.design.field_background_color || "#ffffff"} onChange={(e) => updateDesign({ field_background_color: e.target.value })} className="w-full h-10 rounded" />
                        </div>
                        <div className="space-y-2">
                            <Label>Cor do botão</Label>
                            <input type="color" value={form.design.button_color || "#C9A84C"} onChange={(e) => updateDesign({ button_color: e.target.value })} className="w-full h-10 rounded" />
                        </div>
                        <div className="space-y-2">
                            <Label>Cor do texto do botão</Label>
                            <input type="color" value={form.design.button_text_color || "#111111"} onChange={(e) => updateDesign({ button_text_color: e.target.value })} className="w-full h-10 rounded" />
                        </div>
                        <div className="space-y-2">
                            <Label>Cantos arredondados (px)</Label>
                            <Input type="number" value={form.design.border_radius ?? 8} onChange={(e) => updateDesign({ border_radius: Number(e.target.value) })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Tamanho dos campos</Label>
                            <Select value={form.design.field_size ?? "md"} onValueChange={(v) => updateDesign({ field_size: v as any })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="sm">Pequeno</SelectItem>
                                    <SelectItem value="md">Médio</SelectItem>
                                    <SelectItem value="lg">Grande</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>

            <EmbedCodeModal open={embedOpen} onOpenChange={setEmbedOpen} slug={form.slug} />
        </div>
    )
}
