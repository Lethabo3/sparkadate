import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.js';
import { analyzeMessage, analyzeConversation, updatePersonalityProfile } from '../services/gemini.js';

const router = express.Router();

// Send message
router.post('/:matchId', authenticateToken, async (req, res) => {
    try {
        const { matchId } = req.params;
        const { content } = req.body;
        const senderId = req.user.id;

        // Verify user is part of this match
        const { data: match } = await supabase
            .from('matches')
            .select('*')
            .eq('id', matchId)
            .single();

        if (!match || (match.user_a_id !== senderId && match.user_b_id !== senderId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Get recent messages for context
        const { data: recentMessages } = await supabase
            .from('messages')
            .select('content, sender_id')
            .eq('match_id', matchId)
            .order('sent_at', { ascending: false })
            .limit(5);

        // Analyze message with Gemini
        const analysis = await analyzeMessage(content, recentMessages || []);

        // Save message
        const { data: message, error } = await supabase
            .from('messages')
            .insert({
                match_id: matchId,
                sender_id: senderId,
                content,
                sentiment_score: analysis?.sentiment_score,
                extracted_topics: analysis?.extracted_topics,
                emotional_tone: analysis?.emotional_tone,
                depth_level: analysis?.depth_level
            })
            .select()
            .single();

        if (error) throw error;

        // Update match message count
        await supabase
            .from('matches')
            .update({ total_messages: match.total_messages + 1 })
            .eq('id', matchId);

        res.status(201).json({ message, analysis });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Get messages for a match
router.get('/:matchId', authenticateToken, async (req, res) => {
    try {
        const { matchId } = req.params;
        const userId = req.user.id;

        // Verify user is part of this match
        const { data: match } = await supabase
            .from('matches')
            .select('*')
            .eq('id', matchId)
            .single();

        if (!match || (match.user_a_id !== userId && match.user_b_id !== userId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .eq('match_id', matchId)
            .order('sent_at', { ascending: true });

        if (error) throw error;

        res.json({ messages });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// Analyze full conversation (called periodically or on demand)
router.post('/:matchId/analyze', authenticateToken, async (req, res) => {
    try {
        const { matchId } = req.params;

        const { data: messages } = await supabase
            .from('messages')
            .select('*')
            .eq('match_id', matchId)
            .order('sent_at', { ascending: true });

        if (!messages || messages.length < 5) {
            return res.status(400).json({ error: 'Not enough messages to analyze' });
        }

        const analysis = await analyzeConversation(messages);

        if (analysis) {
            // Update conversation analytics
            await supabase
                .from('conversation_analytics')
                .upsert({
                    match_id: matchId,
                    total_messages: messages.length,
                    ...analysis,
                    updated_at: new Date().toISOString()
                });
        }

        res.json({ analysis });
    } catch (error) {
        console.error('Analyze conversation error:', error);
        res.status(500).json({ error: 'Failed to analyze conversation' });
    }
});

export default router;