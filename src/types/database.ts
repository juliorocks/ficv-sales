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
    status_wide?: 'ok_wide' | 'erro' | null;
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

// ============================================================
// MÓDULO DE TICKETS
// ============================================================

export type TicketCategoria =
  | 'financeiro'
  | 'academico'
  | 'secretaria'
  | 'suporte_tecnico'
  | 'certificado'
  | 'cancelamento'
  | 'outros'

export type TicketStatus =
  | 'aberto'
  | 'em_atendimento'
  | 'aguardando_aluno'
  | 'resolvido'
  | 'fechado'

export type TicketPrioridade = 'baixa' | 'media' | 'alta' | 'urgente'

export interface Ticket {
  id: number
  protocolo: string
  titulo: string
  categoria: TicketCategoria
  prioridade: TicketPrioridade
  status: TicketStatus
  aluno_id: string
  aluno_nome: string
  aluno_email: string
  atendente_id: string | null
  curso_id: number | null
  created_at: string
  updated_at: string
  first_response_at: string | null
  resolved_at: string | null
  avaliado: boolean
  // joins
  atendente?: { full_name: string } | null
  curso?: { name: string; type: string } | null
}

export interface TicketMessage {
  id: number
  ticket_id: number
  autor_id: string
  autor_nome: string
  autor_role: 'aluno' | 'atendente' | 'admin'
  conteudo: string
  interno: boolean
  created_at: string
}

export interface TicketEvaluation {
  id: number
  ticket_id: number
  aluno_id: string
  csat_nota: number      // 1-5
  ces_nota: number       // 1-7
  fcr_resolvido: boolean
  nps_nota: number | null // 0-10
  comentario: string | null
  created_at: string
}

// ============================================================
// MÓDULO DE EQUIPES
// ============================================================

export interface Team {
  id: string
  name: string
  description?: string | null
  color: string
  icon: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface AgentProfile {
  id: string
  name: string
  photo_url?: string | null
  score_target: number
  email?: string | null
  phone?: string | null
  notes?: string | null
  team_id?: string | null
  active: boolean
  team?: Team | null
}
