import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App'
import { AgentReportPage } from './components/AgentReport'
import { AlunoPortalPage } from './components/tickets/AlunoPortalPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// portal.ficv.edu.br = só o Portal do Aluno (mesmo deploy da Vercel do CRM): qualquer
// caminho nesse domínio abre o portal; o CRM continua no domínio da Vercel.
const isPortalHost = /^portal\./i.test(window.location.hostname)

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <BrowserRouter>
                {isPortalHost ? (
                <Routes>
                    <Route path="/*" element={<AlunoPortalPage />} />
                </Routes>
                ) : (
                <Routes>
                    <Route path="/relatorio/:token" element={<AgentReportPage />} />
                    <Route path="/aluno" element={<AlunoPortalPage />} />
                    <Route path="/atendimento" element={<Navigate to="/aluno" replace />} />
                    <Route path="/*" element={<App />} />
                </Routes>
                )}
            </BrowserRouter>
        </ErrorBoundary>
    </React.StrictMode>,
)
