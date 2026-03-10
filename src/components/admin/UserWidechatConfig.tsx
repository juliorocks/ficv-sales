import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/use-auth';
import { MessageSquare, Save, Loader2, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { showError, showSuccess } from '@/utils/toast';

export const UserWidechatConfig: React.FC = () => {
    const { user } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (user) {
            fetchIntegration();
        }
    }, [user]);

    const fetchIntegration = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('user_integrations')
                .select('*')
                .eq('user_id', user!.id)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            if (data) {
                setEmail(data.widechat_email || '');
                setPassword(data.widechat_password || '');
            }
        } catch (error: any) {
            console.error('Erro ao buscar integração:', error);
            showError('Erro ao carregar configurações do Widechat.');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);

        try {
            // First check if it exists
            const { data: existing } = await supabase
                .from('user_integrations')
                .select('id')
                .eq('user_id', user!.id)
                .single();

            if (existing) {
                const { error } = await supabase
                    .from('user_integrations')
                    .update({
                        widechat_email: email,
                        widechat_password: password,
                        widechat_session_token: null, // Force re-login on next API call
                        updated_at: new Date().toISOString()
                    })
                    .eq('user_id', user!.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('user_integrations')
                    .insert({
                        user_id: user!.id,
                        widechat_email: email,
                        widechat_password: password
                    });
                if (error) throw error;
            }

            showSuccess('Credenciais do Widechat salvas com sucesso!');
        } catch (error: any) {
            console.error('Erro ao salvar integração:', error);
            showError('Erro ao salvar credenciais.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary opacity-50" />
            </div>
        );
    }

    return (
        <div className="glass-card p-6 md:p-8 space-y-6 max-w-2xl">
            <div className="flex items-center gap-4 border-b border-[var(--border)] pb-6">
                <div className="p-3 bg-primary/10 rounded-2xl text-primary">
                    <MessageSquare size={24} />
                </div>
                <div>
                    <h3 className="text-xl font-bold flex items-center gap-2">
                        Integração Widechat (Seu Usuário)
                    </h3>
                    <p className="text-sm text-[var(--text-muted)] mt-1">
                        Configure suas credenciais pessoais para permitir envio de WhatsApp direto pelo Kanban.
                    </p>
                </div>
            </div>

            <form onSubmit={handleSave} className="space-y-6">
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="widechat_email">E-mail do Widechat</Label>
                        <Input
                            id="widechat_email"
                            type="email"
                            placeholder="seu.email@igrejabatista.com.br"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="widechat_password">Senha do Widechat</Label>
                        <div className="relative">
                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="widechat_password"
                                type="password"
                                className="pl-9"
                                placeholder="Sua senha..."
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Sua senha ficará armazenada de forma vinculada apenas ao seu usuário no Supabase.
                        </p>
                    </div>
                </div>

                <div className="pt-4 border-t border-[var(--border)] flex justify-end">
                    <Button type="submit" disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Salvar Credenciais
                    </Button>
                </div>
            </form>
        </div>
    );
};
