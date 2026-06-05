-- Execute this to fix teams RLS policies - VERSION 2 (Simpler approach)
-- Go to: Supabase → SQL Editor → Copy and paste all this

-- First, drop all existing policies on teams
DROP POLICY IF EXISTS "Teams are viewable by authenticated users" ON teams;
DROP POLICY IF EXISTS "Admins can create teams" ON teams;
DROP POLICY IF EXISTS "Admins can update teams" ON teams;
DROP POLICY IF EXISTS "Admins can delete teams" ON teams;

-- Disable RLS temporarily to clear everything
ALTER TABLE teams DISABLE ROW LEVEL SECURITY;

-- Re-enable RLS
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- Create simple policies that work with Supabase auth

-- 1. Everyone can READ teams
CREATE POLICY "Anyone can read teams" ON teams
    FOR SELECT
    USING (true);

-- 2. Everyone authenticated can INSERT (we'll check admin role in the app)
CREATE POLICY "Authenticated users can insert teams" ON teams
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated_user');

-- 3. Everyone authenticated can UPDATE
CREATE POLICY "Authenticated users can update teams" ON teams
    FOR UPDATE
    USING (auth.role() = 'authenticated_user');

-- 4. Everyone authenticated can DELETE
CREATE POLICY "Authenticated users can delete teams" ON teams
    FOR DELETE
    USING (auth.role() = 'authenticated_user');
