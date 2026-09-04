import * as Icons from 'lucide-react';
import React from 'react';

// Função para converter nomes de ícones (ex: "hand-shake" ou "handshake") para o formato PascalCase ("Handshake")
const toPascalCase = (str: string): string => {
    if (!str) return '';
    return str
        .toLowerCase()
        .replace(/-/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
};

interface IconPreviewProps {
    name: string;
    className?: string;
    style?: React.CSSProperties;
}

// Lucide não tem ícones de marca (WhatsApp, Instagram como logo, etc). Pra esses
// casos usamos um SVG próprio em vez de cair no fallback "?".
function WhatsAppIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
    return (
        <svg viewBox="0 0 24 24" className={className} style={style} fill="currentColor" aria-label="WhatsApp">
            <title>WhatsApp</title>
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm5.83 14.06c-.24.68-1.4 1.3-1.93 1.35-.5.05-1.05.24-3.52-.73-2.97-1.15-4.87-4.18-5.02-4.37-.15-.2-1.2-1.6-1.2-3.05s.76-2.17 1.03-2.47c.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.42-.07.65.5.24.58.82 2 .89 2.15.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.3.77 1.27 1.65 2.06 1.14 1.02 2.1 1.33 2.4 1.48.3.15.47.13.65-.08.18-.2.76-.88.96-1.19.2-.3.4-.25.66-.15.27.1 1.7.8 1.99.95.3.15.49.22.56.35.08.13.08.72-.16 1.4Z" />
        </svg>
    );
}

export function IconPreview({ name, className, style }: IconPreviewProps) {
    if (name?.toLowerCase().trim() === 'whatsapp') {
        return <WhatsAppIcon className={className} style={style} />;
    }
    // Converte o nome do banco de dados para o formato esperado pelo componente
    const iconName = toPascalCase(name) as keyof typeof Icons;
    const LucideIcon = Icons[iconName];

    const isComponent = (val: any): val is React.ElementType => {
        return typeof val === 'function' || (typeof val === 'object' && val !== null && '$$typeof' in val);
    }

    if (!isComponent(LucideIcon)) {
        // Ícone de fallback caso o ícone solicitado não seja encontrado
        return (
            <Icons.HelpCircle className={className} style={style}>
                <title>{`Ícone não encontrado: ${name}`}</title>
            </Icons.HelpCircle>
        );
    }

    // @ts-ignore
    return React.createElement(LucideIcon, { className, style });
}
