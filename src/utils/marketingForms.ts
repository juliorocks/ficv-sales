export function slugify(s: string): string {
    return String(s ?? "")
        .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "form"
}

export function fillPlaceholdersPreview(template: string, vars: Record<string, string>): string {
    return String(template ?? "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

export function buildEmbedSnippet(slug: string): { script: string; html: string } {
    const origin = window.location.origin
    const script = `<script src="${origin}/marketing-form-loader.js" data-slug="${slug}" async></script>`
    const html = `<div id="ficv-form-${slug}"></div>\n${script}`
    return { script, html }
}
