import React, { useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { processCSV, ConversationAnalysis } from '../utils/csvProcessor';
import { supabase } from '../lib/supabase';

interface CSVUploaderProps {
    onDataLoaded: (data: ConversationAnalysis[]) => void;
    uploaderId?: string;
}

export const CSVUploader: React.FC<CSVUploaderProps> = ({ onDataLoaded, uploaderId }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const handleFile = async (file: File) => {
        if (!file.name.endsWith('.csv')) {
            alert('Por favor, envie um arquivo CSV.');
            return;
        }

        setLoading(true);
        setStatus('idle');
        try {
            const results = await processCSV(file);

            // 1. Create the upload log entry first to get an ID
            let uploadId = null;
            if (uploaderId) {
                const { data: logData, error: logError } = await supabase
                    .from('upload_logs')
                    .insert({
                        filename: file.name,
                        uploaded_by: uploaderId,
                        record_count: results.length
                    })
                    .select('id')
                    .single();

                if (logError) throw logError;
                uploadId = logData.id;
            }

            // 2. Save messages to Supabase with the upload_id reference
            const { error: dbError } = await supabase
                .from('messages_logs')
                .upsert(
                    results.map(r => ({
                        protocol: r.protocol,
                        agent_name: r.agent,
                        contact: r.contact,
                        message_content: JSON.stringify(r.transcript),
                        final_score: r.finalScore,
                        empathy_score: r.empathyScore,
                        clarity_score: r.clarityScore,
                        depth_score: r.depthScore,
                        commercial_score: r.commercialScore,
                        agility_score: r.agilityScore,
                        closing_attempt: r.closingAttempt,
                        message_count: r.messageCount,
                        timestamp: r.date,
                        upload_id: uploadId // NEW: link to the log
                    })),
                    { onConflict: 'protocol' }
                );

            if (dbError) throw dbError;

            onDataLoaded(results);
            setStatus('success');
        } catch (error) {
            console.error('Error saving CSV data:', error);
            setStatus('error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className={`p-10 border-2 border-dashed rounded-2xl transition-all flex flex-col items-center justify-center text-center ${isDragging ? 'border-primary bg-primary/5 scale-[0.99]' : 'border-[var(--border)]'
                }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
            }}
        >
            <div className={`p-4 rounded-full mb-4 ${status === 'success' ? 'bg-success/20 text-success-text' :
                status === 'error' ? 'bg-danger/20 text-danger' : 'bg-primary/20 text-primary'
                }`}>
                {loading ? (
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                ) : status === 'success' ? (
                    <CheckCircle2 size={32} />
                ) : status === 'error' ? (
                    <AlertCircle size={32} />
                ) : (
                    <Upload size={32} />
                )}
            </div>

            <h3 className="text-xl font-bold mb-2 text-[var(--text-main)]">
                {status === 'success' ? 'Dados Processados!' : 'Upload de Conversas'}
            </h3>
            <p className="text-[var(--text-muted)] text-xs mb-6 max-w-xs leading-relaxed">
                Arraste o arquivo CSV exportado do Widechat ou clique para selecionar.
            </p>

            <input
                type="file"
                id="csv-upload"
                className="hidden"
                accept=".csv"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <label
                htmlFor="csv-upload"
                className="btn-primary cursor-pointer flex items-center gap-2 px-6 py-2.5"
            >
                <FileText size={16} />
                Selecionar Arquivo
            </label>

            {status === 'success' && (
                <p className="mt-4 text-success text-sm font-medium animate-fade-in">
                    Sincronização concluída com sucesso.
                </p>
            )}
        </div>
    );
};
