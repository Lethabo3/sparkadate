const API_BASE_URL = 'http://localhost:3000/api';

function getToken() {
    return localStorage.getItem('sparkToken');
}

function setToken(token) {
    localStorage.setItem('sparkToken', token);
}

function removeToken() {
    localStorage.removeItem('sparkToken');
}

async function apiRequest(endpoint, options = {}) {
    const token = getToken();

    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
        },
        ...options
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

const auth = {
    async signup(userData) {
        const data = await apiRequest('/auth/signup', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
        setToken(data.token);
        localStorage.setItem('sparkUser', JSON.stringify(data.user));
        return data;
    },

    async login(email, password) {
        const data = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        setToken(data.token);
        localStorage.setItem('sparkUser', JSON.stringify(data.user));
        return data;
    },

    logout() {
        removeToken();
        localStorage.removeItem('sparkUser');
        localStorage.removeItem('sparkUserData');
        localStorage.removeItem('sparkCurrentMatch');
        window.location.href = 'index.html';
    },

    isLoggedIn() {
        return !!getToken();
    },

    getCurrentUser() {
        const user = localStorage.getItem('sparkUser');
        return user ? JSON.parse(user) : null;
    }
};

const users = {
    async getProfile() {
        return apiRequest('/users/me');
    },

    async updateProfile(updates) {
        return apiRequest('/users/me', {
            method: 'PATCH',
            body: JSON.stringify(updates)
        });
    },

    async updatePreferences(preferences) {
        return apiRequest('/users/me/preferences', {
            method: 'PATCH',
            body: JSON.stringify(preferences)
        });
    },

    async addPhoto(photoUrl, isPrimary = false) {
        return apiRequest('/users/me/photos', {
            method: 'POST',
            body: JSON.stringify({ photo_url: photoUrl, is_primary: isPrimary })
        });
    },

    async uploadPhoto(base64Data, index) {
        const response = await fetch(base64Data);
        const blob = await response.blob();

        const formData = new FormData();
        formData.append('photo', blob, `photo_${index}.jpg`);
        formData.append('is_primary', index === 0);
        formData.append('upload_order', index);

        const token = getToken();
        const res = await fetch(`${API_BASE_URL}/users/me/photos/upload`, {
            method: 'POST',
            headers: {
                ...(token && { 'Authorization': `Bearer ${token}` })
            },
            body: formData
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || 'Photo upload failed');
        }

        return res.json();
    },

    async deletePhoto(photoId) {
        return apiRequest(`/users/me/photos/${photoId}`, {
            method: 'DELETE'
        });
    }
};

const matches = {
    async getCurrent() {
        return apiRequest('/matches/current');
    },

    async findNew() {
        return apiRequest('/matches/find', { method: 'POST' });
    },

    async requestReveal(matchId) {
        return apiRequest(`/matches/${matchId}/reveal`, { method: 'POST' });
    },

    async exit(matchId) {
        return apiRequest(`/matches/${matchId}/exit`, { method: 'POST' });
    },

    async getMatchPhotos(matchId) {
        return apiRequest(`/matches/${matchId}/photos`);
    }
};

const messages = {
    async getAll(matchId) {
        return apiRequest(`/messages/${matchId}`);
    },

    async send(matchId, content) {
        return apiRequest(`/messages/${matchId}`, {
            method: 'POST',
            body: JSON.stringify({ content })
        });
    },

    async analyzeConversation(matchId) {
        return apiRequest(`/messages/${matchId}/analyze`, { method: 'POST' });
    }
};

const SparkAPI = {
    auth,
    users,
    matches,
    messages
};
