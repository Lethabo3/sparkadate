import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get user profile
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select(`
                *,
                user_photos(*),
                user_preferences(*),
                personality_profiles(*)
            `)
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        // Remove sensitive data
        delete user.password_hash;

        res.json({ user });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// Update user profile
router.patch('/me', authenticateToken, async (req, res) => {
    try {
        const allowedFields = ['display_name', 'location'];
        const updates = {};

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        updates.updated_at = new Date().toISOString();

        const { data: user, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', req.user.id)
            .select()
            .single();

        if (error) throw error;

        delete user.password_hash;

        res.json({ user });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Update preferences
router.patch('/me/preferences', authenticateToken, async (req, res) => {
    try {
        const { age_min, age_max, max_distance_km, relationship_intent, dealbreakers } = req.body;

        const { data: preferences, error } = await supabase
            .from('user_preferences')
            .update({
                age_min,
                age_max,
                max_distance_km,
                relationship_intent,
                dealbreakers,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', req.user.id)
            .select()
            .single();

        if (error) throw error;

        res.json({ preferences });
    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

// Add photo
router.post('/me/photos', authenticateToken, async (req, res) => {
    try {
        const { photo_url, is_primary } = req.body;

        // If setting as primary, unset other primaries
        if (is_primary) {
            await supabase
                .from('user_photos')
                .update({ is_primary: false })
                .eq('user_id', req.user.id);
        }

        const { data: photo, error } = await supabase
            .from('user_photos')
            .insert({
                user_id: req.user.id,
                photo_url,
                is_primary: is_primary || false
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ photo });
    } catch (error) {
        console.error('Add photo error:', error);
        res.status(500).json({ error: 'Failed to add photo' });
    }
});

export default router;