import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.js';
import { calculateCompatibility } from '../services/gemini.js';

const router = express.Router();

router.get('/debug', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

    const { data: candidates } = await supabase
        .from('users')
        .select('*')
        .neq('id', userId);

    const genderMap = { man: 'men', woman: 'women' };

    const results = candidates.map(c => ({
        name: c.display_name,
        gender: c.gender,
        seeking: c.seeking,
        userSeeks: user.seeking === 'everyone' || user.seeking === genderMap[c.gender],
        candidateSeeks: c.seeking === 'everyone' || c.seeking === genderMap[user.gender],
        wouldMatch: (user.seeking === 'everyone' || user.seeking === genderMap[c.gender]) &&
            (c.seeking === 'everyone' || c.seeking === genderMap[user.gender])
    }));

    res.json({
        currentUser: { gender: user.gender, seeking: user.seeking },
        candidates: results
    });
});

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
                reveal_requested_by: match.reveal_requested_by,
                reveal_requested_at: match.reveal_requested_at,
                status: match.status
            }
        });
    } catch (error) {
        console.error('Get current match error:', error);
        res.status(500).json({ error: 'Failed to get match' });
    }
});

router.post('/find', authenticateToken, async (req, res) => {
    console.log('=== NEW CODE VERSION 2 ===');
    try {
        const userId = req.user.id;

        const { data: existingMatch } = await supabase
            .from('matches')
            .select('id')
            .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
            .eq('status', 'active')
            .single();

        if (existingMatch) {
            return res.status(400).json({ error: 'Already have an active match' });
        }

        const { data: user } = await supabase
            .from('users')
            .select('*, user_preferences(*), personality_profiles(*)')
            .eq('id', userId)
            .single();

        const preferences = user.user_preferences?.[0] || user.user_preferences;

        const { data: candidates } = await supabase
            .from('users')
            .select('*, personality_profiles(*), interest_mappings(*)')
            .neq('id', userId)
            .eq('is_active', true)
            .eq('is_banned', false)
            .gte('age', preferences?.age_min || 18)
            .lte('age', preferences?.age_max || 99);

        if (!candidates || candidates.length === 0) {
            await supabase
                .from('match_queue')
                .upsert({ user_id: userId, is_active: true });
            return res.json({ match: null, queued: true });
        }

        const { data: activeMatchUserIds } = await supabase
            .from('matches')
            .select('user_a_id, user_b_id')
            .eq('status', 'active');

        const matchedUserIds = new Set();
        activeMatchUserIds?.forEach(m => {
            matchedUserIds.add(m.user_a_id);
            matchedUserIds.add(m.user_b_id);
        });

        const { data: previousMatches } = await supabase
            .from('matches')
            .select('user_a_id, user_b_id')
            .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);

        const previousMatchUserIds = new Set();
        previousMatches?.forEach(m => {
            if (m.user_a_id === userId) {
                previousMatchUserIds.add(m.user_b_id);
            } else {
                previousMatchUserIds.add(m.user_a_id);
            }
        });

        console.log('=== MATCHING DEBUG ===');
        console.log('Current user:', {
            id: userId,
            gender: user.gender,
            seeking: user.seeking
        });
        console.log('Total candidates from DB:', candidates?.length);
        console.log('Users in active matches:', [...matchedUserIds]);
        console.log('Previous match user IDs:', [...previousMatchUserIds]);

        const availableCandidates = candidates.filter(c =>
            !matchedUserIds.has(c.id) && !previousMatchUserIds.has(c.id)
        );

        console.log('Available after filters:', availableCandidates?.length);
        console.log('Available candidate names:', availableCandidates.map(c => c.display_name));

        const validCandidates = availableCandidates.filter(c => {
            const genderMap = { man: 'men', woman: 'women' };
            const userSeeks = user.seeking === 'everyone' || user.seeking === genderMap[c.gender];
            const candidateSeeks = c.seeking === 'everyone' || c.seeking === genderMap[user.gender];
            return userSeeks && candidateSeeks;
        });

        console.log('Valid candidates after seeking filter:', validCandidates?.length);
        console.log('Valid candidate names:', validCandidates.map(c => c.display_name));
        console.log('=== END DEBUG ===');

        if (validCandidates.length === 0) {
            await supabase
                .from('match_queue')
                .upsert({ user_id: userId, is_active: true });
            return res.json({ match: null, queued: true });
        }

        const candidate = validCandidates[0];
        console.log('Selected candidate:', candidate.display_name, candidate.id);

        let compatibility = null;
        try {
            compatibility = await calculateCompatibility(
                user.personality_profiles,
                candidate.personality_profiles,
                [],
                candidate.interest_mappings || []
            );
        } catch (geminiError) {
            console.error('Gemini error (continuing with defaults):', geminiError.message);
        }

        const revealHours = compatibility?.recommended_reveal_hours || Math.floor(Math.random() * 108) + 12;
        const revealAvailableAt = new Date(Date.now() + revealHours * 60 * 60 * 1000);

        console.log('Creating match between', userId, 'and', candidate.id);

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

        if (error) {
            console.error('Match insert error:', error);
            throw error;
        }

        console.log('Match created successfully:', match.id);

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

        if (match.reveal_requested_by && match.reveal_requested_by !== userId) {
            await supabase
                .from('matches')
                .update({
                    status: 'revealed',
                    revealed_at: new Date().toISOString()
                })
                .eq('id', matchId);

            return res.json({ revealed: true });
        }

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

// Get match partner's photos
router.get('/:matchId/photos', authenticateToken, async (req, res) => {
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

        const partnerId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;

        const { data: photos, error } = await supabase
            .from('user_photos')
            .select('*')
            .eq('user_id', partnerId)
            .order('upload_order', { ascending: true });

        if (error) throw error;

        res.json({ photos: photos || [] });
    } catch (error) {
        console.error('Get match photos error:', error);
        res.status(500).json({ error: 'Failed to get photos' });
    }
});

export default router;
