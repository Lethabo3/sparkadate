// Sign up
router.post('/signup', async (req, res) => {
    try {
        const { email, password, display_name, age, gender, seeking, location } = req.body;

        // Check if user exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // Create user
        const { data: user, error } = await supabase
            .from('users')
            .insert({
                email,
                password_hash,
                display_name,
                age,
                gender,
                seeking,
                location
            })
            .select()
            .single();

        if (error) throw error;

        // Create empty personality profile
        await supabase
            .from('personality_profiles')
            .insert({ user_id: user.id });

        // Create default preferences
        await supabase
            .from('user_preferences')
            .insert({ user_id: user.id });

        // Generate token
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            user: {
                id: user.id,
                email: user.email,
                display_name: user.display_name
            },
            token
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Failed to create account' });
    }
});