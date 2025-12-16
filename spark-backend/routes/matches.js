import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.js';
import { calculateCompatibility } from '../services/gemini.js';

const router = express.Router();

// Helper function to add user to queue
async function addToQueue(userId) {
    const { data: existingEntry } = await supabase
        .from('match_queue')
        .select('id')
        .eq('user_id', userId)
        .single();

    if (existingEntry) {
        await supabase
            .from('match_queue')
            .update({ 
                is_active: true, 
                entered_queue_at: new Date().toISOString() 
            })
            .eq('user_id', userId);
    } else {
        await supabase
            .from('match_queue')
            .insert({ 
                user_id: userId, 
                is_active: true,
                entered_queue_at: new Date().toISOString(),
                priority_score: 0
            });
    }
}

// Helper function to remove user from queue
async function removeFromQueue(userId) {
    await supabase
        .from('match_queue')
        .update({ is_active: false })
        .eq('user_id', userId);
}

// Debug endpoint
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
    
    const { data: queuedUsers } = await supabase
        .from('match_queue')
        .select('*')
        .eq('is_active', true);
    
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
        candidates: results,
        activeQueue: queuedUsers
    });
});

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

        // Get current user data
        const { data: user } = await supabase
            .from('users')
            .select('*, user_preferences(*), personality_profiles(*)')
            .eq('id', userId)
            .single();

        const preferences = user.user_preferences?.[0] || user.user_preferences;
        const genderMap = { man: 'men', woman: 'women' };

        // STEP 1: Check queue first for waiting compatible users
        const { data: queuedUsers } = await supabase
            .from('match_queue')
            .select(`
                user_id,
                entered_queue_at,
                priority_score,
                users!inner(
                    id, display_name, age, gender, seeking,
                    is_active, is_banned,
                    personality_profiles(*),
                    interest_mappings(*)
                )
            `)
            .eq('is_active', true)
            .neq('user_id', userId)
            .order('priority_score', { ascending: false })
            .order('entered_queue_at', { ascending: true });

        // Filter queued users for compatibility
        const compatibleQueuedUsers = queuedUsers?.filter(q => {
            const candidate = q.users;
            if (!candidate.is_active || candidate.is_banned) return false;
            if (candidate.age < (preferences?.age_min || 18)) return false;
            if (candidate.age > (preferences?.age_max || 99)) return false;
            
            const userSeeksCandidate = user.seeking === 'everyone' || user.seeking === genderMap[candidate.gender];
            const candidateSeeksUser = candidate.seeking === 'everyone' || candidate.seeking === genderMap[user.gender];
            return userSeeksCandidate && candidateSeeksUser;
        }) || [];

        let selectedCandidate = null;
        let matchedFromQueue = false;

        if (compatibleQueuedUsers.length > 0) {
            // Match with longest-waiting compatible user from queue
            selectedCandidate = compatibleQueuedUsers[0].users;
            matchedFromQueue = true;
            
            console.log('=== QUEUE MATCH ===');
            console.log(`Matched ${user.display_name} with queued user ${selectedCandidate.display_name}`);
            console.log(`Queue wait time: ${Date.now() - new Date(compatibleQueuedUsers[0].entered_queue_at).getTime()}ms`);
        } else {
            // STEP 2: Fall back to searching all users
            const { data: candidates } = await supabase
                .from('users')
                .select('*, personality_profiles(*), interest_mappings(*)')
                .neq('id', userId)
                .eq('is_active', true)
                .eq('is_banned', false)
                .gte('age', preferences?.age_min || 18)
                .lte('age', preferences?.age_max || 99);

            if (!candidates || candidates.length === 0) {
                await addToQueue(userId);
                return res.json({ match: null, queued: true });
            }

            // Filter out users already in active matches
            const { data: activeMatchUserIds } = await supabase
                .from('matches')
                .select('user_a_id, user_b_id')
                .eq('status', 'active');

            const matchedUserIds = new Set();
            activeMatchUserIds?.forEach(m => {
                matchedUserIds.add(m.user_a_id);
                matchedUserIds.add(m.user_b_id);
            });

            const availableCandidates = candidates.filter(c => !matchedUserIds.has(c.id));

            // Filter out users already in queue (they're waiting, not immediately available)
            const { data: queuedUserIds } = await supabase
                .from('match_queue')
                .select('user_id')
                .eq('is_active', true);

            const queuedIds = new Set(queuedUserIds?.map(q => q.user_id) || []);
            const nonQueuedCandidates = availableCandidates.filter(c => !queuedIds.has(c.id));

            const validCandidates = nonQueuedCandidates.filter(c => {
                const userSeeksCandidate = user.seeking === 'everyone' || user.seeking === genderMap[c.gender];
                const candidateSeeksUser = c.seeking === 'everyone' || c.seeking === genderMap[user.gender];
                return userSeeksCandidate && candidateSeeksUser;
            });

            console.log('=== MATCHING DEBUG ===');
            console.log('Current user:', { id: userId, gender: user.gender, seeking: user.seeking });
            console.log('Queued compatible users:', compatibleQueuedUsers.length);
            console.log('Total candidates from DB:', candidates?.length);
            console.log('Available after active match filter:', availableCandidates?.length);
            console.log('Available after queue filter:', nonQueuedCandidates?.length);
            console.log('Valid after seeking filter:', validCandidates?.length);
            console.log('=== END DEBUG ===');

            if (validCandidates.length === 0) {
                await addToQueue(userId);
                return res.json({ match: null, queued: true });
            }

            selectedCandidate = validCandidates[0];
            
            console.log('=== DIRECT MATCH ===');
            console.log(`Matched ${user.display_name} with ${selectedCandidate.display_name}`);
        }

        // Calculate compatibility
        const compatibility = await calculateCompatibility(
            user.personality_profiles,
            selectedCandidate.personality_profiles,
            [],
            selectedCandidate.interest_mappings || []
        );

        // Create match
        const revealHours = compatibility?.recommended_reveal_hours || Math.floor(Math.random() * 108) + 12;
        const revealAvailableAt = new Date(Date.now() + revealHours * 60 * 60 * 1000);

        const { data: match, error } = await supabase
            .from('matches')
            .insert({
                user_a_id: userId,
                user_b_id: selectedCandidate.id,
                compatibility_score: compatibility?.compatibility_score || 0.5,
                recommended_reveal_hours: revealHours,
                reveal_available_at: revealAvailableAt.toISOString()
            })
            .select()
            .single();

        if (error) throw error;

        // STEP 3: Clean up queue for both users
        await removeFromQueue(userId);
        await removeFromQueue(selectedCandidate.id);

        console.log(`Queue cleanup: Removed ${userId} and ${selectedCandidate.id} from queue`);

        // Create conversation analytics entry
        await supabase
            .from('conversation_analytics')
            .insert({ match_id: match.id });

        res.json({
            match: {
                id: match.id,
                partner: {
                    id: selectedCandidate.id,
                    display_name: selectedCandidate.display_name,
                    age: selectedCandidate.age
                },
                reveal_available_at: match.reveal_available_at,
                matched_from_queue: matchedFromQueue
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

// Get queue status
router.get('/queue/status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: queueEntry } = await supabase
            .from('match_queue')
            .select('*')
            .eq('user_id', userId)
            .eq('is_active', true)
            .single();

        if (!queueEntry) {
            return res.json({ inQueue: false });
        }

        const waitTime = Date.now() - new Date(queueEntry.entered_queue_at).getTime();

        res.json({
            inQueue: true,
            enteredAt: queueEntry.entered_queue_at,
            waitTimeMs: waitTime,
            priorityScore: queueEntry.priority_score
        });
    } catch (error) {
        console.error('Queue status error:', error);
        res.status(500).json({ error: 'Failed to get queue status' });
    }
});

// Leave queue manually
router.post('/queue/leave', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        await removeFromQueue(userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Leave queue error:', error);
        res.status(500).json({ error: 'Failed to leave queue' });
    }
});

export default router;
