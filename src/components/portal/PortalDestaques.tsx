// Destaques do topo do Início do Portal do Aluno: a Avaliação da CPA (quando há) e os banners que o admin
// sobe em Gestão > Banners do Portal. Cada banner tem arte para celular e/ou desktop (<picture>).
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { withTimeout } from "@/utils/withTimeout"
import { CpaPortalCard } from "../cpa/CpaPortalAvaliacao"

type Banner = { id: string; titulo: string; imagem_mobile: string | null; imagem_desktop: string | null; link_url: string | null }

export const urlArteBanner = (path: string) => supabase.storage.from("portal-banners").getPublicUrl(path).data.publicUrl

export function PortalDestaques() {
    return (
        <>
            <CpaPortalCard />
            <BannersCarrossel />
        </>
    )
}

function BannersCarrossel() {
    const { data } = useQuery({
        queryKey: ["portal-banners"],
        staleTime: 5 * 60_000,
        retry: false,
        // o banco já filtra pelos ativos dentro da janela de exibição (RLS)
        queryFn: async () => {
            const { data, error } = await withTimeout(
                supabase.from("portal_banners").select("id, titulo, imagem_mobile, imagem_desktop, link_url").order("ordem").order("created_at", { ascending: false }),
                10000, "Os banners",
            )
            if (error) throw error
            return (data ?? []) as Banner[]
        },
    })
    const [i, setI] = useState(0)
    const n = data?.length ?? 0

    useEffect(() => {
        if (n < 2) return
        const t = setInterval(() => setI((x) => (x + 1) % n), 6500)
        return () => clearInterval(t)
    }, [n])

    if (!n) return null
    const b = data![Math.min(i, n - 1)]
    const mobile = b.imagem_mobile ?? b.imagem_desktop!
    const desktop = b.imagem_desktop ?? b.imagem_mobile!
    const arte = (
        <picture>
            <source media="(min-width: 768px)" srcSet={urlArteBanner(desktop)} />
            <img src={urlArteBanner(mobile)} alt={b.titulo} className="h-full w-full object-cover" loading="lazy" />
        </picture>
    )
    const externo = !!b.link_url && b.link_url.startsWith("https://")

    return (
        <section aria-label="Destaques" className="relative overflow-hidden rounded-2xl shadow-lg shadow-black/10">
            <div className="aspect-[2/1] w-full md:aspect-[4/1]">
                {b.link_url
                    ? <a href={b.link_url} {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="block h-full w-full">{arte}</a>
                    : arte}
            </div>
            {n > 1 && (
                <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
                    {data!.map((x, k) => (
                        <button key={x.id} type="button" aria-label={`Banner ${k + 1}`} onClick={() => setI(k)}
                            className={`h-1.5 rounded-full transition-all ${k === Math.min(i, n - 1) ? "w-5 bg-white" : "w-1.5 bg-white/50"}`} />
                    ))}
                </div>
            )}
        </section>
    )
}
