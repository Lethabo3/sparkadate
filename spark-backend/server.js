import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import matchesRoutes from './routes/matches.js';
import messagesRoutes from './routes/messages.js';
import waitlistRoutes from './routes/waitlist.js';

dotenv.config();

const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET', 'GEMINI_API_KEY'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    console.error('Missing environment variables:', missingVars.join(', '));
    console.error('Please check your .env file');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: ['https://lethabo3.github.io', 'http://localhost:3000', 'http://sparkadate.online'],
    credentials: true
}));

app.use(express.json());

app.get('/api', (req, res) => {
    res.json({
        message: 'Spark API',
        version: '1.0.0',
        endpoints: {
            health: 'GET /api/health',
            auth: {
                signup: 'POST /api/auth/signup',
                login: 'POST /api/auth/login'
            },
            users: {
                me: 'GET /api/users/me',
                update: 'PATCH /api/users/me',
                preferences: 'PATCH /api/users/me/preferences',
                photos: 'POST /api/users/me/photos'
            },
            matches: {
                current: 'GET /api/matches/current',
                find: 'POST /api/matches/find',
                reveal: 'POST /api/matches/:matchId/reveal',
                exit: 'POST /api/matches/:matchId/exit'
            },
            messages: {
                send: 'POST /api/messages/:matchId',
                get: 'GET /api/messages/:matchId',
                analyze: 'POST /api/messages/:matchId/analyze'
            },
            waitlist: {
                join: 'POST /api/waitlist/join',
                count: 'GET /api/waitlist/count',
                position: 'POST /api/waitlist/position'
            }
        }
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/waitlist', waitlistRoutes);

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log(`Spark backend running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log('========================================');
});

server.on('error', (err) => {
    console.error('Server error:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});
