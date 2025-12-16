import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://tqfplimunahyajxpzrnc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZnBsaW11bmFoeWFqeHB6cm5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4MzE0ODMsImV4cCI6MjA4MTQwNzQ4M30.PtopCyuu7G0nxCCbpJwLe00kXw7ysqz96K7ZmoxirCY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function setToken(token) {
    localStorage.setItem('sparkToken', token);
}

function removeToken() {
    localStorage.removeItem('sparkToken');
}

const auth = {
    async signup(userData) {
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email: userData.email,
            password: userData.password
        });

        if (authError) throw authError;

        const { data: user, error: userError } = await supabase
            .from('users')
            .insert({
                id: authData.user.id,
                email: userData.email,
                display_name: userData.display_name,
                age: userData.age,
                gender: userData.gender,
                seeking: userData.seeking,
                bio: userData.bio || null
            })
            .select()
            .single();

        if (userError) throw userError;

        setToken(authData.session.access_token);
        localStorage.setItem('sparkUser', JSON.stringify(user));

        return { user, token: authData.session.access_token };
    },

    async login(email, password) {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (authError) throw authError;

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', authData.user.id)
            .single();

        if (userError) throw userError;

        setToken(authData.session.access_token);
        localStorage.setItem('sparkUser', JSON.stringify(user));

        return { user, token: authData.session.access_token };
    },

    async logout() {
        await supabase.auth.signOut();
        removeToken();
        localStorage.removeItem('sparkUser');
        localStorage.removeItem('sparkUserData');
        localStorage.removeItem('sparkCurrentMatch');
        window.location.href = 'index.html';
    },

    isLoggedIn() {
        return !!localStorage.getItem('sparkToken');
    },

    getCurrentUser() {
        const user = localStorage.getItem('sparkUser');
        return user ? JSON.parse(user) : null;
    }
};

const users = {
    async getProfile() {
        const user = auth.getCurrentUser();
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

        if (error) throw error;
        return data;
    },

    async updateProfile(updates) {
        const user = auth.getCurrentUser();
        const { data, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', user.id)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async updatePreferences(preferences) {
        const user = auth.getCurrentUser();
        const { data, error } = await supabase
            .from('user_preferences')
            .upsert({
                user_id: user.id,
                ...preferences
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async addPhoto(photoUrl, isPrimary = false) {
        const user = auth.getCurrentUser();
        const { data, error } = await supabase
            .from('user_photos')
            .insert({
                user_id: user.id,
                photo_url: photoUrl,
                is_primary: isPrimary
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    }
};

const matches = {
    async getCurrent() {
        const user = auth.getCurrentUser();
        
        const { data: match, error } = await supabase
            .from('matches')
            .select(`
                *,
                user_a:users!matches_user_a_id_fkey(id, display_name, age),
                user_b:users!matches_user_b_id_fkey(id, display_name, age)
            `)
            .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
            .eq('status', 'active')
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        if (!match) return { match: null };

        const partner = match.user_a_id === user.id ? match.user_b : match.user_a;

        return {
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
        };
    },

    async findNew() {
        const user = auth.getCurrentUser();
        const userId = user.id;

        const { data: existingMatch } = await supabase
            .from('matches')
            .select('id')
            .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
            .eq('status', 'active')
            .maybeSingle();

        if (existingMatch) {
            throw new Error('Already have an active match');
        }

        const { data: userData } = await supabase
            .from('users')
            .select('*, user_preferences(*)')
            .eq('id', userId)
            .single();

        const preferences = userData.user_preferences?.[0] || userData.user_preferences;
        const genderMap = { man: 'men', woman: 'women' };

        const { data: queuedUsers } = await supabase
            .from('match_queue')
            .select(`
                user_id,
                entered_queue_at,
                priority_score,
                users!inner(id, display_name, age, gender, seeking, is_active, is_banned)
            `)
            .eq('is_active', true)
            .neq('user_id', userId)
            .order('priority_score', { ascending: false })
            .order('entered_queue_at', { ascending: true });

        const compatibleQueuedUsers = queuedUsers?.filter(q => {
            const candidate = q.users;
            if (!candidate.is_active || candidate.is_banned) return false;
            if (candidate.age < (preferences?.age_min || 18)) return false;
            if (candidate.age > (preferences?.age_max || 99)) return false;
            
            const userSeeksCandidate = userData.seeking === 'everyone' || userData.seeking === genderMap[candidate.gender];
            const candidateSeeksUser = candidate.seeking === 'everyone' || candidate.seeking === genderMap[userData.gender];
            return userSeeksCandidate && candidateSeeksUser;
        }) || [];

        let selectedCandidate = null;

        if (compatibleQueuedUsers.length > 0) {
            selectedCandidate = compatibleQueuedUsers[0].users;
        } else {
            const { data: candidates } = await supabase
                .from('users')
                .select('*')
                .neq('id', userId)
                .eq('is_active', true)
                .eq('is_banned', false)
                .gte('age', preferences?.age_min || 18)
                .lte('age', preferences?.age_max || 99);

            if (!candidates || candidates.length === 0) {
                await supabase
                    .from('match_queue')
                    .upsert({ 
                        user_id: userId, 
                        is_active: true,
                        entered_queue_at: new Date().toISOString(),
                        priority_score: 0
                    });

                return { match: null, queued: true };
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

            const availableCandidates = candidates.filter(c => !matchedUserIds.has(c.id));

            const { data: queuedUserIds } = await supabase
                .from('match_queue')
                .select('user_id')
                .eq('is_active', true);

            const queuedIds = new Set(queuedUserIds?.map(q => q.user_id) || []);
            const nonQueuedCandidates = availableCandidates.filter(c => !queuedIds.has(c.id));

            const validCandidates = nonQueuedCandidates.filter(c => {
                const userSeeksCandidate = userData.seeking === 'everyone' || userData.seeking === genderMap[c.gender];
                const candidateSeeksUser = c.seeking === 'everyone' || c.seeking === genderMap[userData.gender];
                return userSeeksCandidate && candidateSeeksUser;
            });

            if (validCandidates.length === 0) {
                await supabase
                    .from('match_queue')
                    .upsert({ 
                        user_id: userId, 
                        is_active: true,
                        entered_queue_at: new Date().toISOString(),
                        priority_score: 0
                    });

                return { match: null, queued: true };
            }

            selectedCandidate = validCandidates[0];
        }

        const revealHours = Math.floor(Math.random() * 108) + 12;
        const revealAvailableAt = new Date(Date.now() + revealHours * 60 * 60 * 1000);

        const { data: match, error } = await supabase
            .from('matches')
            .insert({
                user_a_id: userId,
                user_b_id: selectedCandidate.id,
                compatibility_score: 0.5,
                recommended_reveal_hours: revealHours,
                reveal_available_at: revealAvailableAt.toISOString()
            })
            .select()
            .single();

        if (error) throw error;

        await supabase
            .from('match_queue')
            .update({ is_active: false })
            .eq('user_id', userId);

        await supabase
            .from('match_queue')
            .update({ is_active: false })
            .eq('user_id', selectedCandidate.id);

        await supabase
            .from('conversation_analytics')
            .insert({ match_id: match.id });

        return {
            match: {
                id: match.id,
                partner: {
                    id: selectedCandidate.id,
                    display_name: selectedCandidate.display_name,
                    age: selectedCandidate.age
                },
                reveal_available_at: match.reveal_available_at
            }
        };
    },

    async requestReveal(matchId) {
        const user = auth.getCurrentUser();
        const userId = user.id;

        const { data: match } = await supabase
            .from('matches')
            .select('*')
            .eq('id', matchId)
            .single();

        if (!match || (match.user_a_id !== userId && match.user_b_id !== userId)) {
            throw new Error('Not authorized');
        }

        if (match.reveal_requested_by && match.reveal_requested_by !== userId) {
            await supabase
                .from('matches')
                .update({
                    status: 'revealed',
                    revealed_at: new Date().toISOString()
                })
                .eq('id', matchId);

            return { revealed: true };
        }

        await supabase
            .from('matches')
            .update({
                reveal_requested_by: userId,
                reveal_requested_at: new Date().toISOString()
            })
            .eq('id', matchId);

        return { requested: true, waiting_for_partner: true };
    },

    async exit(matchId) {
        const user = auth.getCurrentUser();
        const userId = user.id;

        const { data: match } = await supabase
            .from('matches')
            .select('*')
            .eq('id', matchId)
            .single();

        if (!match || (match.user_a_id !== userId && match.user_b_id !== userId)) {
            throw new Error('Not authorized');
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

        const { data: userData } = await supabase
            .from('users')
            .select('subscription_tier, exits_remaining')
            .eq('id', userId)
            .single();

        if (userData.subscription_tier === 'free' && userData.exits_remaining > 0) {
            await supabase
                .from('users')
                .update({ exits_remaining: userData.exits_remaining - 1 })
                .eq('id', userId);
        }

        return { exited: true };
    }
};

const messages = {
    async getAll(matchId) {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('match_id', matchId)
            .order('created_at', { ascending: true });

        if (error) throw error;
        return { messages: data };
    },

    async send(matchId, content) {
        const user = auth.getCurrentUser();

        const { data, error } = await supabase
            .from('messages')
            .insert({
                match_id: matchId,
                sender_id: user.id,
                content: content
            })
            .select()
            .single();

        if (error) throw error;
        return { message: data };
    },

    subscribeToMessages(matchId, callback) {
        return supabase
            .channel(`messages:${matchId}`)
            .on('postgres_changes', 
                { 
                    event: 'INSERT', 
                    schema: 'public', 
                    table: 'messages',
                    filter: `match_id=eq.${matchId}`
                }, 
                callback
            )
            .subscribe();
    }
};

const SparkAPI = {
    auth,
    users,
    matches,
    messages,
    supabase
};
