// Extrai texto de arquivos da base de conhecimento NO NAVEGADOR (PDF, DOCX,
// planilhas, TXT/MD/CSV). O texto vai pra knowledge_base.content e a edge
// function kb-ingest só faz chunk + embedding — parse pesado numa edge function
// estouraria o limite de CPU. Libs carregadas sob demanda (import dinâmico) pra
// não pesar o bundle de quem nunca sobe arquivo.

export type SourceType = 'text' | 'pdf' | 'sheet' | 'doc';

export const ACCEPTED_EXTENSIONS = '.pdf,.docx,.xlsx,.xls,.csv,.txt,.md';

export function sourceTypeOf(file: File): SourceType | null {
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'docx') return 'doc';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet';
    if (['txt', 'md'].includes(ext)) return 'text';
    return null;
}

async function pdfToText(file: File): Promise<string> {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        // hasEOL marca quebra de linha real do PDF; sem isso vira um linguição só
        let line = '';
        const lines: string[] = [];
        for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
            line += item.str ?? '';
            if (item.hasEOL) { lines.push(line.trim()); line = ''; }
        }
        if (line.trim()) lines.push(line.trim());
        pages.push(lines.join('\n'));
    }
    return pages.join('\n\n');
}

async function docxToText(file: File): Promise<string> {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value;
}

/**
 * Planilha → texto "linha a linha com cabeçalho" (ex: "Curso: Teologia | Mensalidade: R$ 399").
 * Cada linha vira um parágrafo: a IA entende muito melhor que uma tabela CSV crua
 * e o chunking não separa o valor do nome da coluna.
 */
async function sheetToText(file: File): Promise<string> {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '' });
        if (!rows.length) continue;
        if (wb.SheetNames.length > 1) parts.push(`# ${name}`);
        for (const row of rows) {
            const cells = Object.entries(row)
                .filter(([, v]) => String(v).trim() !== '')
                .map(([k, v]) => (k.startsWith('__EMPTY') ? String(v) : `${k}: ${v}`));
            if (cells.length) parts.push(cells.join(' | '));
        }
    }
    return parts.join('\n\n');
}

export async function extractText(file: File): Promise<{ text: string; sourceType: SourceType }> {
    const sourceType = sourceTypeOf(file);
    if (!sourceType) throw new Error(`Formato não suportado: ${file.name}. Use PDF, DOCX, XLSX, CSV, TXT ou MD.`);
    let text: string;
    if (sourceType === 'pdf') text = await pdfToText(file);
    else if (sourceType === 'doc') text = await docxToText(file);
    else if (sourceType === 'sheet') text = await sheetToText(file);
    else text = await file.text();
    text = text.replace(/\u0000/g, '').trim();
    if (!text) {
        throw new Error(
            sourceType === 'pdf'
                ? `Não encontrei texto em ${file.name}. Parece um PDF escaneado (imagem) — exporte com texto ou cole o conteúdo manualmente.`
                : `${file.name} está vazio.`,
        );
    }
    return { text, sourceType };
}
