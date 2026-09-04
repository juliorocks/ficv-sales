import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import { AgentReportPage } from './components/AgentReport'
import { AlunoPortalPage } from './components/tickets/AlunoPortalPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <BrowserRouter>
                <Routes>
                    <Route path="/relatorio/:token" element={<AgentReportPage />} />
                    <Route path="/atendimento" element={<AlunoPortalPage />} />
                    <Route path="/*" element={<App />} />
                </Routes>
            </BrowserRouter>
        </ErrorBoundary>
    </React.StrictMode>,
)
