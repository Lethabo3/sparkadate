import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

export async function analyzeMessage(content, conversationContext = []) {
    const prompt = `
    Analyze this dating app message and return JSON only:
    
    Message: "${content}"
    
    Previous context: ${JSON.stringify(conversationContext.slice(-5))}
    
    Return this exact JSON structure:
    {
        "sentiment_score": <number -1 to 1>,
        "emotional_tone": "<happy|curious|flirty|neutral|sad|anxious|excited|vulnerable>",
        "depth_level": <number 1-5>,
        "extracted_topics": ["<topic1>", "<topic2>"],
        "humor_detected": <boolean>,
        "question_asked": <boolean>,
        "vulnerability_level": <number 0 to 1>,
        "engagement_signals": <number 0 to 1>
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        
        return null;
    } catch (error) {
        console.error('Gemini analysis error:', error);
        return null;
    }
}

export async function analyzeConversation(messages) {
    const prompt = `
    Analyze this dating conversation and return JSON only:
    
    Messages: ${JSON.stringify(messages)}
    
    Return this exact JSON structure:
    {
        "humor_alignment": <number 0 to 1>,
        "communication_rhythm_sync": <number 0 to 1>,
        "depth_progression": <number 0 to 1>,
        "emotional_reciprocity": <number 0 to 1>,
        "shared_topics": ["<topic1>", "<topic2>"],
        "topic_diversity_score": <number 0 to 1>,
        "engagement_trend": "<increasing|stable|declining|volatile>",
        "predicted_reveal_success": <number 0 to 1>,
        "predicted_post_reveal_continuation": <number 0 to 1>
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        
        return null;
    } catch (error) {
        console.error('Gemini conversation analysis error:', error);
        return null;
    }
}

export async function updatePersonalityProfile(userId, allMessages) {
    const userMessages = allMessages.filter(m => m.sender_id === userId);
    
    const prompt = `
    Analyze these messages from a dating app user and create a personality profile. Return JSON only:
    
    Messages: ${JSON.stringify(userMessages.map(m => m.content))}
    
    Return this exact JSON structure:
    {
        "avg_message_length": <number>,
        "formality_score": <number 0 to 1>,
        "humor_score": <number 0 to 1>,
        "emoji_frequency": <number 0 to 1>,
        "question_asking_rate": <number 0 to 1>,
        "depth_preference": <number 0 to 1>,
        "emotional_openness_speed": <number 0 to 1>,
        "positivity_score": <number 0 to 1>,
        "emotional_expressiveness": <number 0 to 1>,
        "empathy_signals": <number 0 to 1>,
        "conflict_handling_style": "<avoidant|confrontational|diplomatic|passive>"
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        
        return null;
    } catch (error) {
        console.error('Gemini personality analysis error:', error);
        return null;
    }
}

export async function calculateCompatibility(userAProfile, userBProfile, userAInterests, userBInterests) {
    const prompt = `
    Calculate compatibility between two dating app users. Return JSON only:
    
    User A Profile: ${JSON.stringify(userAProfile)}
    User A Interests: ${JSON.stringify(userAInterests)}
    
    User B Profile: ${JSON.stringify(userBProfile)}
    User B Interests: ${JSON.stringify(userBInterests)}
    
    Return this exact JSON structure:
    {
        "compatibility_score": <number 0 to 1>,
        "recommended_reveal_hours": <number 12 to 120>,
        "strength_areas": ["<area1>", "<area2>"],
        "potential_challenges": ["<challenge1>", "<challenge2>"],
        "conversation_starters": ["<starter1>", "<starter2>"]
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        
        return null;
    } catch (error) {
        console.error('Gemini compatibility calculation error:', error);
        return null;
    }
}