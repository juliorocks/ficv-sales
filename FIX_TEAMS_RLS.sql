-- Execute this SQL to fix RLS policies for teams table
-- Go to: Supabase → SQL Editor → Run this query

-- Delete existing incorrect policy if it exists
DROP POLICY IF EXISTS "Teams are viewable by authenticated users" ON teams;

-- Create proper RLS policies for teams

-- Policy for SELECT (view teams - everyone authenticated)
CREATE POLICY "Teams are viewable by authenticated users" ON teams
    FOR SELECT USING (auth.role() = 'authenticated_user');

-- Policy for INSERT (create teams - admin only)
CREATE POLICY "Admins can create teams" ON teams
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy for UPDATE (edit teams - admin only)
CREATE POLICY "Admins can update teams" ON teams
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy for DELETE (delete teams - admin only)
CREATE POLICY "Admins can delete teams" ON teams
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );
