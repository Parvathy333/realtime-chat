// server.js - Supports both MySQL (local) and PostgreSQL (Render)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();
const bcrypt = require('bcrypt');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;

// --- Database Connection (MySQL or PostgreSQL) ---
let dbConnection;
const isProduction = process.env.NODE_ENV === 'production';

async function connectToDatabase() {
    try {
        if (isProduction && process.env.DATABASE_URL) {
            // Production: Use PostgreSQL
            const { Pool } = require('pg');
            dbConnection = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            // Test connection
            const res = await dbConnection.query('SELECT NOW()');
            console.log('Connected to PostgreSQL database');
        } else {
            // Development: Use MySQL
            const mysql = require('mysql2/promise');
            const pool = mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_NAME || 'chat_app_db',
                port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });

            // Test connection
            const conn = await pool.getConnection();
            await conn.ping();
            conn.release();
            console.log('Connected to MySQL database (pool)');

            dbConnection = pool;
        }
    } catch (error) {
        console.error('Error connecting to database:', error);
        process.exit(1);
    }
}
connectToDatabase();

// Helper to execute queries (handles both MySQL and PostgreSQL)
async function executeQuery(query, params) {
    if (isProduction && process.env.DATABASE_URL) {
        // PostgreSQL
        return dbConnection.query(query, params);
    } else {
        // MySQL
        return dbConnection.execute(query, params);
    }
}

// --- Middleware Setup ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'a_very_strong_secret_key_for_session_encryption_replace_me_in_production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax'
    }
});
app.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        if (req.xhr || req.headers.accept.includes('json')) {
            res.status(401).json({ message: 'Unauthorized. Please log in.' });
        } else {
            res.redirect('/login.html');
        }
    }
}

// --- Express Routes ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        const checkResult = await executeQuery(
            isProduction && process.env.DATABASE_URL
                ? 'SELECT id FROM users WHERE username = $1'
                : 'SELECT id FROM users WHERE username = ?',
            [username]
        );

        const rows = isProduction && process.env.DATABASE_URL ? checkResult.rows : checkResult[0];

        if (rows.length > 0) {
            return res.status(409).json({ message: 'Username already taken.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await executeQuery(
            isProduction && process.env.DATABASE_URL
                ? 'INSERT INTO users (username, password) VALUES ($1, $2)'
                : 'INSERT INTO users (username, password) VALUES (?, ?)',
            [username, hashedPassword]
        );

        res.status(201).json({ message: 'User registered successfully!' });

    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        const result = await executeQuery(
            isProduction && process.env.DATABASE_URL
                ? 'SELECT id, username, password FROM users WHERE username = $1'
                : 'SELECT id, username, password FROM users WHERE username = ?',
            [username]
        );

        const rows = isProduction && process.env.DATABASE_URL ? result.rows : result[0];

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;

        res.status(200).json({ message: 'Logged in successfully!', redirectUrl: '/chat.html' });

    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).json({ message: 'Failed to log out.' });
        }
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Logged out successfully!', redirectUrl: '/login.html' });
    });
});

app.get('/user-info', isAuthenticated, (req, res) => {
    if (req.session.userId && req.session.username) {
        res.json({ userId: req.session.userId, username: req.session.username });
    } else {
        res.status(401).json({ message: 'User not authenticated.' });
    }
});

app.get('/chat.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.post('/generateRoomCode', isAuthenticated, async (req, res) => {
    const userId = req.session.userId;
    const username = req.session.username;

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized. User ID not found in session.' });
    }

    try {
        let roomCode;
        let isUnique = false;

        while (!isUnique) {
            roomCode = crypto.randomBytes(3).toString('hex').toUpperCase();
            const result = await executeQuery(
                isProduction && process.env.DATABASE_URL
                    ? 'SELECT id FROM rooms WHERE code = $1'
                    : 'SELECT id FROM rooms WHERE code = ?',
                [roomCode]
            );
            const rows = isProduction && process.env.DATABASE_URL ? result.rows : result[0];
            if (rows.length === 0) {
                isUnique = true;
            }
        }

        await executeQuery(
            isProduction && process.env.DATABASE_URL
                ? 'INSERT INTO rooms (code, name, created_by_user_id) VALUES ($1, $2, $3)'
                : 'INSERT INTO rooms (code, name, created_by_user_id) VALUES (?, ?, ?)',
            [roomCode, `Room by ${username}`, userId]
        );

        res.status(201).json({ message: 'Room code generated successfully!', roomCode: roomCode });

    } catch (error) {
        console.error('Error generating room code:', error);
        res.status(500).json({ message: 'Server error during room code generation.' });
    }
});

app.get('/rooms', isAuthenticated, async (req, res) => {
    try {
        const result = await executeQuery(
            isProduction && process.env.DATABASE_URL
                ? 'SELECT r.code, r.name, r.created_at, u.username as created_by_username, r.created_by_user_id FROM rooms r JOIN users u ON r.created_by_user_id = u.id ORDER BY r.created_at DESC'
                : 'SELECT r.code, r.name, r.created_at, u.username as created_by_username, r.created_by_user_id FROM rooms r JOIN users u ON r.created_by_user_id = u.id ORDER BY r.created_at DESC',
            []
        );
        const rows = isProduction && process.env.DATABASE_URL ? result.rows : result[0];
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching rooms:', error);
        res.status(500).json({ message: 'Server error fetching rooms.' });
    }
});

app.delete('/rooms/:roomCode', isAuthenticated, async (req, res) => {
    const { roomCode } = req.params;

    try {
        const result = await executeQuery(
            isProduction && process.env.DATABASE_URL
                ? 'SELECT id FROM rooms WHERE code = $1'
                : 'SELECT id FROM rooms WHERE code = ?',
            [roomCode]
        );
        const rows = isProduction && process.env.DATABASE_URL ? result.rows : result[0];

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Room not found.' });
        }

        await executeQuery(
            isProduction && process.env.DATABASE_URL
                ? 'DELETE FROM rooms WHERE code = $1'
                : 'DELETE FROM rooms WHERE code = ?',
            [roomCode]
        );

        io.to(roomCode).emit('message', { type: 'system', text: `Room '${roomCode}' has been closed.` });
        io.socketsLeave(roomCode);

        res.status(200).json({ message: 'Room deleted successfully.' });

    } catch (error) {
        console.error('Error deleting room:', error);
        res.status(500).json({ message: 'Server error during room deletion.' });
    }
});

// --- Socket.IO Integration ---

io.engine.use(sessionMiddleware);

io.on('connection', async (socket) => {
    const session = socket.request.session;
    const userId = session.userId;
    const username = session.username;

    if (!userId || !username) {
        console.log('Unauthenticated Socket.IO connection attempted. Disconnecting.');
        socket.disconnect(true);
        return;
    }

    console.log(`User ${username} (ID: ${userId}) connected via Socket.IO: ${socket.id}`);

    socket.userId = userId;
    socket.username = username;
    socket.currentRoom = null;

    socket.on('joinRoomByCode', async (roomCode) => {
        if (!roomCode) {
            socket.emit('message', { type: 'system', text: 'Please provide a room code.' });
            return;
        }

        try {
            const result = await executeQuery(
                isProduction && process.env.DATABASE_URL
                    ? 'SELECT id, name FROM rooms WHERE code = $1'
                    : 'SELECT id, name FROM rooms WHERE code = ?',
                [roomCode]
            );
            const rows = isProduction && process.env.DATABASE_URL ? result.rows : result[0];

            if (rows.length === 0) {
                socket.emit('message', { type: 'system', text: `Room '${roomCode}' does not exist.` });
                return;
            }

            const room = rows[0];

            if (socket.currentRoom && socket.currentRoom !== roomCode) {
                socket.leave(socket.currentRoom);
                socket.to(socket.currentRoom).emit('message', { type: 'system', text: `${socket.username} has left the room.` });
                console.log(`${socket.username} left room: ${socket.currentRoom}`);
            }

            socket.join(roomCode);
            socket.currentRoom = roomCode;

            console.log(`${socket.username} joined room: ${roomCode}`);
            socket.emit('message', { type: 'system', text: `You have joined room: ${room.name || roomCode}` });
            socket.to(roomCode).emit('message', { type: 'system', text: `${socket.username} has joined this room.` });

        } catch (error) {
            console.error('Error joining room by code:', error);
            socket.emit('message', { type: 'system', text: 'Error joining room. Please try again.' });
        }
    });

    socket.on('chatMessage', ({ roomCode, message }) => {
        if (!roomCode || !message) {
            socket.emit('message', { type: 'system', text: 'Message or room code missing.' });
            return;
        }
        if (socket.currentRoom !== roomCode) {
            socket.emit('message', { type: 'system', text: 'You are not in the specified room. Please join it first.' });
            return;
        }

        console.log(`Message in room ${roomCode} from ${socket.username}: ${message}`);
        io.to(roomCode).emit('message', {
            username: socket.username,
            text: message,
            timestamp: new Date().toLocaleTimeString(),
            isSelf: false
        });
    });

    socket.on('disconnect', () => {
        if (socket.currentRoom) {
            socket.to(socket.currentRoom).emit('message', { type: 'system', text: `${socket.username} has left the room.` });
            console.log(`${socket.username} disconnected from room: ${socket.currentRoom}`);
        }
        console.log(`User ${username} (ID: ${userId}) disconnected: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
