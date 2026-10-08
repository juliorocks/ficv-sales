import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App'
import { AgentReportPage } from './components/AgentReport'
import { AlunoPortalPage } from './components/tickets/AlunoPortalPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// code-split: formulário público embedado via iframe em sites externos não deve
// carregar o bundle do CRM (App.tsx/Kanban/Dashboard)
const PublicMarketingFormPage = React.lazy(() =>
    import('./components/marketing/PublicMarketingFormPage').then((m) => ({ default: m.PublicMarketingFormPage })))

// portal.ficv.edu.br = só o Portal do Aluno (mesmo deploy da Vercel do CRM): qualquer
// caminho nesse domínio abre o portal — EXCETO /connect, que é o CRM nesse mesmo domínio
// (pedido do usuário 02/10: "portal.ficv.edu.br/connect" em vez do link genérico da Vercel).
// /relatorio também escapa: é o link PÚBLICO de relatório de agente (AgentAdmin.tsx monta com
// window.location.origin) — se gerado a partir de .../connect, precisa abrir em qualquer
// domínio onde esse mesmo link for aberto, não só em /connect.
// /f também escapa: é o formulário público do Marketing (EmbedCodeModal.tsx monta o snippet com
// window.location.origin) — colado numa LP, precisa funcionar não importa de qual domínio do CRM
// o admin gerou o código (achado ao vivo 08/10: snippet gerado em portal.ficv.edu.br/connect caía
// no catch-all do portal, que não tem a rota /f e renderizava o login do aluno no lugar do form).
const isPortalHost = /^portal\./i.test(window.location.hostname)
const isCrmPath = /^\/(connect|relatorio|f)(\/|$)/.test(window.location.pathname)

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <BrowserRouter>
                {isPortalHost && !isCrmPath ? (
                <Routes>
                    <Route path="/*" element={<AlunoPortalPage />} />
                </Routes>
                ) : (
                <Routes>
                    <Route path="/relatorio/:token" element={<AgentReportPage />} />
                    <Route path="/aluno" element={<AlunoPortalPage />} />
                    <Route path="/atendimento" element={<Navigate to="/aluno" replace />} />
                    <Route path="/f/:slug" element={<Suspense fallback={null}><PublicMarketingFormPage /></Suspense>} />
                    <Route path="/*" element={<App />} />
                </Routes>
                )}
            </BrowserRouter>
        </ErrorBoundary>
    </React.StrictMode>,
)
