// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mysql = require('mysql2/promise'); // Using promise-based version for async/await
const bcrypt = require('bcrypt'); // For password hashing
const session = require('express-session'); // For session management
const crypto = require('crypto'); // For generating random room codes

const app = express();
const server = http.createServer(app);

// Configure Socket.IO to allow cross-origin requests and session sharing
const io = new Server(server, {
    cors: {
        // Allow connection from your frontend URL (replace with your actual domain in production)
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true // Allow cookies to be sent (essential for session authentication)
    }
});

const PORT = process.env.PORT || 3000;

// --- Database Connection Configuration ---
const dbConfig = {
    host: 'localhost',   // Your MySQL host (usually 'localhost' for WAMP/XAMPP)
    user: 'root',      // Your MySQL username
    password: '',      // Your MySQL password (often empty for 'root' on WAMP/XAMPP)
    database: 'chat_app_db' // The name of the database you created
};

let dbConnection; // Declare a variable to hold the database connection pool/connection

/**
 * Establishes a connection to the MySQL database.
 * If connection fails, the process exits as database connectivity is critical.
 */
async function connectToDatabase() {
    try {
        dbConnection = await mysql.createConnection(dbConfig);
        console.log('Connected to MySQL database!');
    } catch (error) {
        console.error('Error connecting to database:', error);
        // Exit process if database connection fails, as it's a critical dependency
        process.exit(1);
    }
}
connectToDatabase(); // Call to establish connection when the server starts

// --- Middleware Setup ---

// Middleware to parse JSON request bodies
app.use(express.json());
// Middleware to parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true }));

// Configure express-session middleware
const sessionMiddleware = session({
    secret: 'a_very_strong_secret_key_for_session_encryption_replace_me_in_production', // A strong secret for session encryption (MUST be unique and kept secret)
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something is stored
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // Session lasts for 1 day (in milliseconds)
        httpOnly: true, // Prevent client-side JavaScript from accessing the cookie
        secure: process.env.NODE_ENV === 'production' // Use secure cookies (HTTPS) only in production
    }
});
app.use(sessionMiddleware); // Apply session middleware to all Express routes

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Middleware function to check if a user is authenticated.
 * If not authenticated, it sends a 401 response for API requests or redirects to login for page requests.
 */
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next(); // User is authenticated, proceed to the next middleware/route handler
    } else {
        // Determine if the request is an AJAX call or a direct page request
        if (req.xhr || req.headers.accept.includes('json')) {
            res.status(401).json({ message: 'Unauthorized. Please log in.' });
        } else {
            res.redirect('/login.html'); // Redirect to the login page for direct page access
        }
    }
}

// --- Express Routes ---

// Default route: redirects to the login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// User Registration Route
app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    // Basic input validation
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        // Check if the username already exists in the database
        const [rows] = await dbConnection.execute(
            'SELECT id FROM users WHERE username = ?',
            [username]
        );

        if (rows.length > 0) {
            return res.status(409).json({ message: 'Username already taken.' });
        }

        // Hash the password before storing it in the database for security
        const hashedPassword = await bcrypt.hash(password, 10); // 10 salt rounds recommended

        // Insert the new user into the 'users' table
        await dbConnection.execute(
            'INSERT INTO users (username, password) VALUES (?, ?)',
            [username, hashedPassword]
        );

        res.status(201).json({ message: 'User registered successfully!' });

    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// User Login Route
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    // Basic input validation
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        // Fetch the user from the database by username
        const [rows] = await dbConnection.execute(
            'SELECT id, username, password FROM users WHERE username = ?',
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }

        const user = rows[0];

        // Compare the provided password with the hashed password stored in the database
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }

        // Authentication successful: store user ID and username in the session
        req.session.userId = user.id;
        req.session.username = user.username;
        // console.log(`User ${user.username} (ID: ${user.id}) logged in. Session ID: ${req.session.id}`);

        res.status(200).json({ message: 'Logged in successfully!', redirectUrl: '/chat.html' });

    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

// User Logout Route
app.post('/logout', (req, res) => {
    // Destroy the user's session
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).json({ message: 'Failed to log out.' });
        }
        // Clear the session cookie from the client
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Logged out successfully!', redirectUrl: '/login.html' });
    });
});

// Route to get current user info (for displaying welcome message on chat page)
app.get('/user-info', isAuthenticated, (req, res) => {
    if (req.session.userId && req.session.username) {
        res.json({ userId: req.session.userId, username: req.session.username });
    } else {
        res.status(401).json({ message: 'User not authenticated.' });
    }
});

// Protected Chat HTML Page: only accessible after successful login
app.get('/chat.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Route to generate a new unique room code
app.post('/generateRoomCode', isAuthenticated, async (req, res) => {
    const userId = req.session.userId;
    const username = req.session.username;

    if (!userId) { // Extra check, though isAuthenticated middleware should prevent this
        return res.status(401).json({ message: 'Unauthorized. User ID not found in session.' });
    }

    try {
        let roomCode;
        let isUnique = false;
        // Loop until a unique 6-character alphanumeric code is generated
        while (!isUnique) {
            roomCode = crypto.randomBytes(3).toString('hex').toUpperCase(); // Generates 6 hex characters
            const [rows] = await dbConnection.execute('SELECT id FROM rooms WHERE code = ?', [roomCode]);
            if (rows.length === 0) {
                isUnique = true;
            }
        }

        // Insert the new room into the 'rooms' table
        const [result] = await dbConnection.execute(
            'INSERT INTO rooms (code, name, created_by_user_id) VALUES (?, ?, ?)',
            [roomCode, `Room by ${username}`, userId] // Default room name: "Room by [Creator's Username]"
        );

        res.status(201).json({ message: 'Room code generated successfully!', roomCode: roomCode });

    } catch (error) {
        console.error('Error generating room code:', error);
        res.status(500).json({ message: 'Server error during room code generation.' });
    }
});

// Route to get all generated rooms
app.get('/rooms', isAuthenticated, async (req, res) => {
    try {
        // Select rooms and join with users table to get the creator's username
        const [rows] = await dbConnection.execute(
            'SELECT r.code, r.name, r.created_at, u.username as created_by_username, r.created_by_user_id ' +
            'FROM rooms r JOIN users u ON r.created_by_user_id = u.id ORDER BY r.created_at DESC'
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching rooms:', error);
        res.status(500).json({ message: 'Server error fetching rooms.' });
    }
});

// Route to delete a specific room - NOW ALLOWS ANY AUTHENTICATED USER TO DELETE
app.delete('/rooms/:roomCode', isAuthenticated, async (req, res) => {
    const { roomCode } = req.params; // Get room code from URL parameters
    // const userId = req.session.userId; // Get current user's ID from session - NOT USED FOR CHECK

    try {
        // First, verify if the room exists
        const [rows] = await dbConnection.execute(
            'SELECT id FROM rooms WHERE code = ?', // Removed created_by_user_id from select
            [roomCode]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Room not found.' });
        }

        // Removed the check: if (rows[0].created_by_user_id !== userId) { ... }
        // Now, any authenticated user can delete the room.

        // Delete the room from the database
        await dbConnection.execute('DELETE FROM rooms WHERE code = ?', [roomCode]);

        // Inform all connected clients in that room that the room has been closed
        io.to(roomCode).emit('message', { type: 'system', text: `Room '${roomCode}' has been closed by the owner.` });
        // Force all sockets connected to this room to leave it
        io.socketsLeave(roomCode);

        res.status(200).json({ message: 'Room deleted successfully.' });

    } catch (error) {
        console.error('Error deleting room:', error);
        res.status(500).json({ message: 'Server error during room deletion.' });
    }
});


// --- Socket.IO Integration ---

// Make Express session middleware available to Socket.IO for authentication
io.engine.use(sessionMiddleware);

// Event listener for new Socket.IO connections
io.on('connection', async (socket) => {
    // Access session data from the underlying HTTP request object
    const session = socket.request.session;
    const userId = session.userId;
    const username = session.username;

    // Disconnect socket if no valid user session is found
    if (!userId || !username) {
        console.log('Unauthenticated Socket.IO connection attempted. Disconnecting.');
        socket.disconnect(true); // 'true' closes the underlying connection
        return;
    }

    console.log(`User ${username} (ID: ${userId}) connected via Socket.IO: ${socket.id}`);

    // Store user info directly on the socket object for easy access in other event handlers
    socket.userId = userId;
    socket.username = username;
    socket.currentRoom = null; // Initialize current room tracking for this socket

    // Event listener for 'joinRoomByCode' from client
    socket.on('joinRoomByCode', async (roomCode) => {
        if (!roomCode) {
            socket.emit('message', { type: 'system', text: 'Please provide a room code.' });
            return;
        }

        try {
            // Check if the room code exists in the database
            const [rows] = await dbConnection.execute('SELECT id, name FROM rooms WHERE code = ?', [roomCode]);

            if (rows.length === 0) {
                socket.emit('message', { type: 'system', text: `Room '${roomCode}' does not exist.` });
                return;
            }

            const room = rows[0]; // Get room details

            // If the user is already in another room, make them leave it first
            if (socket.currentRoom && socket.currentRoom !== roomCode) {
                socket.leave(socket.currentRoom);
                // Inform other users in the old room that this user has left
                socket.to(socket.currentRoom).emit('message', { type: 'system', text: `${socket.username} has left the room.` });
                console.log(`${socket.username} left room: ${socket.currentRoom}`);
            }

            // Join the new Socket.IO room
            socket.join(roomCode);
            socket.currentRoom = roomCode; // Update the socket's current room tracking

            console.log(`${socket.username} joined room: ${roomCode}`);
            // Send confirmation message to the joining user
            socket.emit('message', { type: 'system', text: `You have joined room: ${room.name || roomCode}` });
            // Inform other users in the new room that a new user has joined
            socket.to(roomCode).emit('message', { type: 'system', text: `${socket.username} has joined this room.` });

        } catch (error) {
            console.error('Error joining room by code:', error);
            socket.emit('message', { type: 'system', text: 'Error joining room. Please try again.' });
        }
    });

    // Event listener for 'chatMessage' from client
    socket.on('chatMessage', ({ roomCode, message }) => {
        if (!roomCode || !message) {
            socket.emit('message', { type: 'system', text: 'Message or room code missing.' });
            return;
        }
        // Ensure the user is actually in the room they claim to be sending a message to
        if (socket.currentRoom !== roomCode) {
             socket.emit('message', { type: 'system', text: 'You are not in the specified room. Please join it first.' });
             return;
        }

        console.log(`Message in room ${roomCode} from ${socket.username}: ${message}`);
        // Broadcast the message to all clients in the specified room, including the sender
        io.to(roomCode).emit('message', {
            username: socket.username,
            text: message,
            timestamp: new Date().toLocaleTimeString(),
            isSelf: false // This flag is client-side only for styling; server doesn't use it directly
        });
    });

    // Event listener for socket disconnection
    socket.on('disconnect', () => {
        if (socket.currentRoom) {
            // Inform other users in the room that this user has disconnected
            socket.to(socket.currentRoom).emit('message', { type: 'system', text: `${socket.username} has left the room.` });
            console.log(`${socket.username} disconnected from room: ${socket.currentRoom}`);
        }
        console.log(`User ${username} (ID: ${userId}) disconnected: ${socket.id}`);
    });
});

// Start the HTTP server and listen for incoming requests
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
