import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.js';
import { calculateCompatibility } from '../services/gemini.js';

const router = express.Router();

// Get current match
router.get('/current', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: match } = await supabase
            .from('matches')
            .select(`
                *,
                user_a:users!matches_user_a_id_fkey(id, display_name, age),
                user_b:users!matches_user_b_id_fkey(id, display_name, age)
            `)
            .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
            .eq('status', 'active')
            .single();

        if (!match) {
            return res.json({ match: null });
        }

        // Return partner info (not the requesting user)
        const partner = match.user_a_id === userId ? match.user_b : match.user_a;

        res.json({
            match: {
                id: match.id,
                partner: {
                    id: partner.id,
                    display_name: partner.display_name,
                    age: partner.age
                },
                matched_at: match.matched_at,
                reveal_available_at: match.reveal_available_at,
                status: match.status
            }
        });
    } catch (error) {
        console.error('Get current match error:', error);
        res.status(500).json({ error: 'Failed to get match' });
    }
});

// Find new match
router.post('/find', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Check if user already has active match
        const { data: existingMatch } = await supabase
            .from('matches')
            .select('id')
            .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
            .eq('status', 'active')
            .single();

        if (existingMatch) {
            return res.status(400).json({ error: 'Already have an active match' });
        }

        // Get user data and preferences
        const { data: user } = await supabase
            .from('users')
            .select('*, user_preferences(*), personality_profiles(*)')
            .eq('id', userId)
            .single();

        const preferences = user.user_preferences;

        // Find potential matches
        const { data: candidates } = await supabase
            .from('users')
            .select('*, personality_profiles(*), interest_mappings(*)')
            .neq('id', userId)
            .eq('is_active', true)
            .eq('is_banned', false)
            .gte('age', preferences?.age_min || 18)
            .lte('age', preferences?.age_max || 99);

        if (!candidates || candidates.length === 0) {
            // Add to queue
            await supabase
                .from('match_queue')
                .upsert({ user_id: userId, is_active: true });

            return res.json({ match: null, queued: true });
        }

        // Filter by seeking preferences
        const validCandidates = candidates.filter(c => {
            const userSeeks = user.seeking === 'everyone' || user.seeking === c.gender + 's';
            const candidateSeeks = c.seeking === 'everyone' || c.seeking === user.gender + 's';
            return userSeeks && candidateSeeks;
        });

        if (validCandidates.length === 0) {
            await supabase
                .from('match_queue')
                .upsert({ user_id: userId, is_active: true });

            return res.json({ match: null, queued: true });
        }

        // Calculate compatibility with top candidate
        const candidate = validCandidates[0];
        const compatibility = await calculateCompatibility(
            user.personality_profiles,
            candidate.personality_profiles,
            [],
            candidate.interest_mappings || []
        );

        // Create match
        const revealHours = compatibility?.recommended_reveal_hours || Math.floor(Math.random() * 108) + 12;
        const revealAvailableAt = new Date(Date.now() + revealHours * 60 * 60 * 1000);

        const { data: match, error } = await supabase
            .from('matches')
            .insert({
                user_a_id: userId,
                user_b_id: candidate.id,
                compatibility_score: compatibility?.compatibility_score || 0.5,
                recommended_reveal_hours: revealHours,
                reveal_available_at: revealAvailableAt.toISOString()
            })
            .select()
            .single();

        if (error) throw error;

        // Create conversation analytics entry
        await supabase
            .from('conversation_analytics')
            .insert({ match_id: match.id });

        res.json({
            match: {
                id: match.id,
                partner: {
                    id: candidate.id,
                    display_name: candidate.display_name,
                    age: candidate.age
                },
                reveal_available_at: match.reveal_available_at
            }
        });
    } catch (error) {
        console.error('Find match error:', error);
        res.status(500).json({ error: 'Failed to find match' });
    }
});

// Request reveal
router.post('/:matchId/reveal', authenticateToken, async (req, res) => {
    try {
        const { matchId } = req.params;
        const userId = req.user.id;

        const { data: match } = await supabase
            .from('matches')
            .select('*')
            .eq('id', matchId)
            .single();

        if (!match || (match.user_a_id !== userId && match.user_b_id !== userId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Check if reveal already requested by other user
        if (match.reveal_requested_by && match.reveal_requested_by !== userId) {
            // Both users agreed - reveal!
            await supabase
                .from('matches')
                .update({
                    status: 'revealed',
                    revealed_at: new Date().toISOString()
                })
                .eq('id', matchId);

            return res.json({ revealed: true });
        }

        // First request
        await supabase
            .from('matches')
            .update({
                reveal_requested_by: userId,
                reveal_requested_at: new Date().toISOString()
            })
            .eq('id', matchId);

        res.json({ requested: true, waiting_for_partner: true });
    } catch (error) {
        console.error('Reveal request error:', error);
        res.status(500).json({ error: 'Failed to request reveal' });
    }
});

// Exit match
router.post('/:matchId/exit', authenticateToken, async (req, res) => {
    try {
        const { matchId } = req.params;
        const userId = req.user.id;

        const { data: match } = await supabase
            .from('matches')
            .select('*')
            .eq('id', matchId)
            .single();

        if (!match || (match.user_a_id !== userId && match.user_b_id !== userId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const exitStage = match.revealed_at ? 'post_reveal' : 'pre_reveal';

        await supabase
            .from('matches')
            .update({
                status: match.user_a_id === userId ? 'exited_a' : 'exited_b',
                exited_by: userId,
                exited_at: new Date().toISOString(),
                exit_stage: exitStage
            })
            .eq('id', matchId);

        // Decrement exits for free users
        const { data: user } = await supabase
            .from('users')
            .select('subscription_tier, exits_remaining')
            .eq('id', userId)
            .single();

        if (user.subscription_tier === 'free' && user.exits_remaining > 0) {
            await supabase
                .from('users')
                .update({ exits_remaining: user.exits_remaining - 1 })
                .eq('id', userId);
        }

        res.json({ exited: true });
    } catch (error) {
        console.error('Exit match error:', error);
        res.status(500).json({ error: 'Failed to exit match' });
    }
});

export default router;