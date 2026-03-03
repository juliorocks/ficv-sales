# SalesPulse Implementation Plan

> **Project:** SalesPulse - Intelligent Sales Support Management System
> **Goal:** Transform WhatsApp (Widechat) exports into actionable commercial intelligence with a premium glassmorphic UI.

## 📋 Overview
A data-driven web application for educational institutions to monitor sales performance, agent evolution, and conversation quality from Widechat CSV exports and Google Sheets data.

## 🏗️ Project Type: WEB
- **Stack:** Vite + React (Frontend) + Supabase (Backend/Auth/DB) + PostgreSQL.
- **Visual Style:** Stripe/Linear/Apple Fitness (Dark mode, glassmorphism, smooth animations).

## 🎯 Success Criteria
- [ ] Automatic CSV processing for empathy and closing attempt detection.
- [ ] Real-time (refreshable) dashboards with Score, Ranking, and Goals.
- [ ] Agent-specific performance pages with gamified badges.
- [ ] TV Mode for centralized monitoring.
- [ ] Secure Supabase Auth with Admin/Agent roles.

## 🗄️ Database Schema (Supabase)

### Tables
1. **profiles**
   - id: uuid (references auth.users)
   - full_name: text
   - role: text (admin | agent)
   - avatar_url: text
   - score: float
2. **messages_logs** (Processed CSV data)
   - id: uuid
   - protocol: text
   - contact: text
   - agent_id: uuid (references profiles)
   - message_content: text
   - timestamp: timestamptz
   - empathy_detected: boolean
   - closing_attempt_detected: boolean
   - quality_score: float
3. **conversions** (Imported from Google Sheets)
   - id: uuid
   - agent_id: uuid
   - date: date
   - status: text (enrolled | in_progress)
4. **goals**
   - type: text (monthly | semester | annual)
   - target_value: int
   - period: text
5. **badges**
   - id: uuid
   - agent_id: uuid
   - badge_type: text
   - awarded_at: timestamptz

## 📂 File Structure
```plaintext
src/
├── components/
│   ├── ui/             # Premium buttons, cards, gauges
│   ├── dashboard/      # KPI Cards, Analytics Charts
│   ├── agent/          # Profile details, Specific charts
│   ├── tv/             # TV Mode components
│   └── common/         # Layouts, Sidebar, Auth Guards
├── hooks/              # CSV Processing, Supabase hooks
├── services/           # Supabase client, Google Sheets fetcher
├── styles/             # Global CSS variables, Dark Mode tokens
├── utils/              # NLP simple detectors, Score calculators
└── App.tsx
```

## 📝 Task Breakdown

### Phase 1: Infrastructure & Auth (P0)
- **Task 1.1**: Initialize Vite React project.
  - **Agent:** @frontend-specialist
  - **Verify:** `npm run dev` starts successfully.
- **Task 1.2**: Set up Supabase Project & Tables.
  - **Agent:** @database-architect
  - **Verify:** Tables exist in Supabase dashboard.
- **Task 1.3**: Implement Auth (Login Page) & Role-based routing.
  - **Agent:** @security-auditor
  - **Verify:** Admin sees all, Agent sees self.

### Phase 2: Intelligence & Processing (P1)
- **Task 2.1**: Implement CSV Upload & Parser (PapaParse).
  - **Agent:** @backend-specialist
  - **Verify:** CSV columns mapped correctly to state.
- **Task 2.2**: Develop "Sentiment & Sales" Logic.
  - **Detectors:** Empathy (phrases like "bom dia", "ajudar"), Closing attempts ("matrícula", "inscrição").
  - **Agent:** @backend-specialist
  - **Verify:** Logic identifies "deseja se inscrever" as closing attempt.
- **Task 2.3**: Quality Score Algorithm (Empatia 20%, Clareza 20%, etc.).
  - **Agent:** @backend-specialist
  - **Verify:** Score 0-10 calculated per protocol.

### Phase 3: The "WOW" Interface (P2)
- **Task 3.1**: Create Main Dashboard (Glassmorphism + Dark Mode).
  - **Agent:** @frontend-specialist
  - **Verify:** UI matches background #0B0F19 and primary #7C5CFF.
- **Task 3.2**: Implement Animated Gauges & Leaderboard.
  - **Agent:** @frontend-specialist
  - **Verify:** Smooth animations on score change.
- **Task 3.3**: Confetti Animation for Goals.
  - **Agent:** @frontend-specialist
  - **Verify:** Confetti trigger on 100% goal achievement.

### Phase 4: Integrations & Polishing (P3)
- **Task 4.1**: Google Sheets Integration (via URL).
  - **Agent:** @backend-specialist
  - **Verify:** Matrículas data imported correctly.
- **Task 4.2**: Agent Individual Pages & Gamification (Badges).
  - **Agent:** @frontend-specialist
  - **Verify:** Badge "Comunicação de Ouro" displays on profile.
- **Task 4.3**: TV Mode (Fullscreen, 30s Auto-refresh).
  - **Agent:** @frontend-specialist
  - **Verify:** Page enters full screen and cycles data.

## ✅ PHASE X: VERIFICATION
- [ ] Run `python .agent/scripts/checklist.py .`
- [ ] Run `python .agent/scripts/verify_all.py .`
- [ ] Verify Mobile Responsive (even if desktop focused)
- [ ] Performance check (50k messages handled)
