export interface User {
    id: string
    email?: string
    full_name: string
    role: 'admin' | 'agent'
    avatar_url?: string | null
}

export type UserRole = 'admin' | 'atendente' | 'visualizador'

export interface Lead {
    id: number
    nome_completo: string
    email: string | null
    telefone: string
    curso_interesse: number | null
    valor_oportunidade: number
    stage_id: number
    data_entrada: string
    stage_entry_date?: string | null;
    observacoes?: string
    attachments?: string[]
    source_id?: number | null
    temperatura?: 'frio' | 'morno' | 'quente' | null;
    assigned_to_id?: string | null;
    motivo_perda_id?: number | null;
    contact_count: number;
    widechat_contact_id?: string | null;
    widechat_session_id?: string | null;
    widechat_attendance_id?: string | null;
    fonte_lead?: string | null;
    partner_id?: string | null;
}

export type PartnerType = 'influencer' | 'polo' | 'other';

export interface Partner {
    id: string;
    name: string;
    slug: string;
    type: PartnerType;
    target_url?: string | null;
    social_media_url?: string | null; // Added
    coupon?: string | null; // Added
    active: boolean;
    created_at: string;
    updated_at: string;
    // Agregados para view
    clicks_count?: number;
    leads_count?: number;
}

export interface ReferralClick {
    id: string;
    partner_id: string;
    ip_address?: string | null;
    user_agent?: string | null;
    referrer?: string | null;
    created_at: string;
    metadata?: any;
}

export interface LeadHistory {
    id: number
    lead_id: number
    from_stage_id?: number
    to_stage_id: number
    changed_at: string
    changed_by: string
    motivo_perda_id?: number | null
    motivos_perda?: { motivo: string } | null
    users?: { name: string } | null
    from_stage?: { name: string } | null
    to_stage?: { name: string } | null
}

export interface Stage {
    id: number;
    name: string;
    order: number;
    title_color?: string | null;
    bg_color?: string | null;
}

export interface Course {
    id: number;
    name: string;
    type: string;
    default_value?: number | null;
}

export interface LeadSource {
    id: number;
    name: string;
    icon: string;
    color: string;
}

export interface LossReason {
    id: number;
    motivo: string;
}

export interface LeadForm {
    id: string
    name: string
    course_id: number
    source_id: number | null
    courses: { name: string } | null
    lead_sources: { name: string, icon: string, color: string } | null
    title?: string | null
    description?: string | null
    button_text?: string | null
    background_color?: string | null
    text_color?: string | null
    button_color?: string | null
    button_text_color?: string | null
    input_bg_color?: string | null
    input_border_color?: string | null
    input_text_color?: string | null
    success_message_title?: string | null
    success_message_description?: string | null
}

export interface LeadNote {
    id: number;
    lead_id: number;
    note: string;
    created_at: string;
    created_by: string;
    users?: { name: string } | null;
}

export interface AuditLog {
    id: number;
    created_at: string;
    user_id: string | null;
    action: string;
    details: {
        lead_id?: number;
        lead_name?: string;
        updated_by?: string;
        changes?: { field: string; from: any; to: any }[];
    };
    users?: { name: string } | null;
}
