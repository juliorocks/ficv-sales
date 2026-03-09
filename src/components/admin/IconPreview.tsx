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

export function IconPreview({ name, className, style }: IconPreviewProps) {
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
