// public/chat.js

// Initialize Socket.IO connection to the server
// `withCredentials: true` is crucial for sending HTTP cookies (session)
// with the WebSocket handshake, allowing the server to authenticate the user.
const socket = io({
    withCredentials: true
});

// --- DOM Element References ---
const logoutButton = document.getElementById('logoutButton');
const welcomeMessage = document.getElementById('welcomeMessage');
const generateRoomCodeButton = document.getElementById('generateRoomCodeButton');
const generatedCodeDisplay = document.getElementById('generatedCodeDisplay');
const displayRoomCode = document.getElementById('displayRoomCode');
const copyRoomCodeButton = document.getElementById('copyRoomCodeButton');
const enterRoomCodeInput = document.getElementById('enterRoomCodeInput');
const joinExistingRoomButton = document.getElementById('joinExistingRoomButton');
const messagesDiv = document.getElementById('messages'); // The container for chat messages
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const roomsListDiv = document.getElementById('roomsList'); // The container for listing available rooms

// --- Global State Variables ---
let currentUserId = null;    // Stores the database ID of the currently logged-in user
let currentUsername = 'Guest'; // Stores the username of the currently logged-in user
let currentRoomCode = null;  // Stores the code of the room the user is currently actively chatting in

// --- Utility Functions ---

/**
 * Appends a new message (chat or system) to the chat display area.
 * @param {object} msg - The message object.
 * - For system messages: { type: 'system', text: '...' }
 * - For chat messages: { username: '...', text: '...', timestamp: '...' }
 */
function appendMessage(msg) {
    const item = document.createElement('div');
    item.classList.add('message'); // Base class for all messages

    if (msg.type === 'system') {
        // Apply specific styling for system messages (e.g., user joined/left, errors)
        item.classList.add('system');
        item.textContent = msg.text;
    } else {
        // Handle regular chat messages
        const senderUsername = msg.username || 'Unknown';
        const messageText = msg.text || '';
        const timestamp = msg.timestamp || '';

        // Check if the message was sent by the current user to apply 'self' styling
        // This is crucial for distinguishing your own messages and for preventing
        // duplication when the server broadcasts your own message back to you.
        if (senderUsername === currentUsername) {
            item.classList.add('self');
            item.innerHTML = `<strong>You:</strong> ${messageText} <span class="timestamp">${timestamp}</span>`;
        } else {
            // Messages from other users appear on the left.
            item.innerHTML = `<strong>${senderUsername}:</strong> ${messageText} <span class="timestamp">${timestamp}</span>`;
        }
    }
    messagesDiv.appendChild(item); // Add the message element to the chat box
    // Automatically scroll to the very bottom of the chat box to show the latest message
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Copies a given text string to the client's clipboard.
 * Uses `document.execCommand('copy')` for broad compatibility in iframe environments.
 * Provides a simple alert for user feedback.
 * @param {string} text - The text content to be copied.
 */
function copyToClipboard(text) {
    // Create a temporary textarea element to hold the text
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea); // Append it to the document body temporarily
    textarea.select(); // Select the text within the textarea

    try {
        const successful = document.execCommand('copy'); // Attempt to copy the selected text
        const msg = successful ? 'copied' : 'failed to copy';
        alert(`Room code ${msg} to clipboard!`); // Inform the user
    } catch (err) {
        console.error('Oops, unable to copy', err);
        alert('Failed to copy room code. Please copy manually: ' + text); // Fallback for failure
    } finally {
        document.body.removeChild(textarea); // Remove the temporary textarea
    }
}

/**
 * Sends a DELETE request to the server to remove a specific chat room.
 * Provides confirmation dialog and user feedback.
 * @param {string} roomCode - The code of the room to delete.
 */
async function deleteRoom(roomCode) {
    // Ask for user confirmation before proceeding with deletion
    if (!confirm(`Are you sure you want to delete room "${roomCode}"? This action cannot be undone.`)) {
        return; // If user cancels, stop here
    }

    try {
        // Send a DELETE request to the server's endpoint for deleting rooms
        const response = await fetch(`/rooms/${roomCode}`, {
            method: 'DELETE', // Use DELETE HTTP method
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json(); // Parse the JSON response from the server

        if (response.ok) {
            // If deletion is successful (HTTP 200 OK)
            appendMessage({ type: 'system', text: `Room '${roomCode}' deleted successfully.` });
            fetchAndDisplayRooms(); // Refresh the list of available rooms

            // If the deleted room was the one the user is currently in, reset chat state
            if (currentRoomCode === roomCode) {
                currentRoomCode = null; // Clear the active room
                messagesDiv.innerHTML = ''; // Clear chat messages for the deleted room
                messageInput.disabled = true; // Disable message input
                messageInput.placeholder = 'Room closed. Please join or generate a new room.';
            }
        } else {
            // If deletion fails (e.g., 403 Forbidden, 404 Not Found)
            alert('Failed to delete room: ' + (data.message || 'Server error.'));
            appendMessage({ type: 'system', text: `Failed to delete room '${roomCode}': ${data.message || 'Server error.'}` });
        }
    } catch (error) {
        // Handle network errors during the delete request
        console.error('Error deleting room:', error);
        alert('Network error deleting room. Please try again.');
        appendMessage({ type: 'system', text: 'Network error deleting room.' });
    }
}


/**
 * Fetches the list of all available chat rooms from the server and renders them in the UI.
 * Each room item will include a 'Join' button and a 'Delete' button.
 */
async function fetchAndDisplayRooms() {
    // Display a loading message while fetching rooms
    roomsListDiv.innerHTML = '<p class="loading-message">Loading rooms...</p>';
    try {
        const response = await fetch('/rooms'); // Send GET request to fetch rooms
        if (!response.ok) {
            throw new Error('Failed to fetch rooms'); // Throw error if response is not OK
        }
        const rooms = await response.json(); // Parse the JSON array of rooms

        roomsListDiv.innerHTML = ''; // Clear the loading message or previous room list

        if (rooms.length === 0) {
            // Display a message if no rooms have been created yet
            roomsListDiv.innerHTML = '<p class="no-rooms-message">No rooms created yet. Generate one!</p>';
            return;
        }

        // Iterate over each room and create its corresponding HTML element
        rooms.forEach(room => {
            const roomElement = document.createElement('div');
            roomElement.classList.add('room-item'); // Apply styling class

            // Determine the display name for the room
            const roomName = room.name && room.name !== `Room by ${room.created_by_username}` ? room.name : `Room by ${room.created_by_username}`;
            const createdAt = new Date(room.created_at).toLocaleString(); // Format the creation timestamp for display

            roomElement.innerHTML = `
                <div class="room-details">
                    <span class="room-code">${room.code}</span>
                    <span class="room-name">${roomName}</span>
                    <span class="room-meta">Created: ${createdAt} by ${room.created_by_username}</span>
                </div>
                <div class="room-buttons-container"> <!-- New container for buttons to force new line -->
                    <button class="join-room-button" data-room-code="${room.code}">Join</button>
                    <button class="delete-room-button" data-room-code="${room.code}">Delete</button>
                </div>
            `;
            roomsListDiv.appendChild(roomElement); // Add the room element to the list container
        });

        // Attach event listeners to all dynamically created 'Join' buttons
        roomsListDiv.querySelectorAll('.join-room-button').forEach(button => {
            button.addEventListener('click', (event) => {
                const roomCode = event.target.dataset.roomCode; // Get room code from data attribute
                enterRoomCodeInput.value = roomCode; // Pre-fill the "Enter existing room code" input
                joinExistingRoomButton.click(); // Programmatically trigger the 'Join Room' button click
            });
        });

        // Attach event listeners to all 'Delete' buttons (now always present)
        roomsListDiv.querySelectorAll('.delete-room-button').forEach(button => {
            button.addEventListener('click', (event) => {
                const roomCode = event.target.dataset.roomCode; // Get room code from data attribute
                deleteRoom(roomCode); // Call the deleteRoom function
            });
        });

    } catch (error) {
        // Handle errors during fetching or displaying rooms
        console.error('Error fetching and displaying rooms:', error);
        roomsListDiv.innerHTML = '<p class="error-message">Failed to load rooms.</p>';
    }
}


// --- Initial Setup on Document Load ---
document.addEventListener('DOMContentLoaded', () => {
    // Fetch logged-in user information (userId and username) from the server.
    fetch('/user-info')
        .then(response => {
            if (!response.ok) {
                // If authentication fails (e.g., session expired, not logged in),
                // redirect the user back to the login page.
                if (response.status === 401) {
                    window.location.href = '/login.html';
                }
                throw new Error('Failed to fetch user info'); // Propagate other errors
            }
            return response.json(); // Parse the JSON response
        })
        .then(data => {
            if (data.userId && data.username) {
                currentUserId = data.userId; // Set global user ID
                currentUsername = data.username; // Set global username
                welcomeMessage.textContent = `Welcome, ${currentUsername}!`; // Display personalized welcome
                // Once user info is successfully loaded, fetch and display the available chat rooms.
                fetchAndDisplayRooms();
            } else {
                welcomeMessage.textContent = `Welcome! (Could not fetch username)`; // Fallback message
            }
        })
        .catch(error => {
            console.error('Error fetching user info:', error);
            welcomeMessage.textContent = `Welcome! (Could not fetch username)`;
            // If there's a severe error fetching user info, you might still want to redirect
            // window.location.href = '/login.html';
        });
});

// --- Event Listeners for UI Interactions ---

// Event listener for the Logout button
logoutButton.addEventListener('click', async () => {
    try {
        const response = await fetch('/logout', {
            method: 'POST', // Send a POST request to the logout endpoint
        });
        const data = await response.json(); // Parse the response

        if (response.ok) {
            // If logout is successful, redirect to the login page
            if (data.redirectUrl) {
                window.location.href = data.redirectUrl;
            }
        } else {
            console.error('Logout failed:', data.message);
            alert('Logout failed: ' + (data.message || 'Server error.')); // Inform user of failure
        }
    } catch (error) {
        console.error('Logout error:', error);
        alert('Network error during logout. Please try again.'); // Handle network errors
    }
});

// Event listener for the 'Generate New Room Code' button
generateRoomCodeButton.addEventListener('click', async () => {
    appendMessage({ type: 'system', text: 'Generating new room code...' }); // Provide immediate feedback
    try {
        const response = await fetch('/generateRoomCode', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        const data = await response.json(); // Parse the response

        if (response.ok) {
            const newRoomCode = data.roomCode;
            displayRoomCode.textContent = newRoomCode; // Display the generated code
            generatedCodeDisplay.style.display = 'flex'; // Show the display area for the code

            appendMessage({ type: 'system', text: `New room code generated: ${newRoomCode}. Joining this room...` });
            // Automatically attempt to join the newly generated room
            socket.emit('joinRoomByCode', newRoomCode);
            currentRoomCode = newRoomCode; // Update the client's current room state
            messageInput.disabled = false; // Enable the message input field
            messageInput.placeholder = `Type your message in room ${currentRoomCode}...`; // Update placeholder
            fetchAndDisplayRooms(); // Refresh the list of rooms to include the new one
        } else {
            alert('Failed to generate room code: ' + (data.message || 'Server error.'));
            appendMessage({ type: 'system', text: 'Failed to generate room code.' });
        }
    } catch (error) {
        console.error('Error generating room code:', error);
        alert('Network error generating room code. Please try again.');
        appendMessage({ type: 'system', text: 'Network error generating room code.' });
    }
});

// Event listener for the 'Copy Code' button
copyRoomCodeButton.addEventListener('click', () => {
    const codeToCopy = displayRoomCode.textContent; // Get the code displayed
    if (codeToCopy) {
        copyToClipboard(codeToCopy); // Call the copy utility
    } else {
        alert('No room code to copy!');
    }
});

// Event listener for the 'Join Room' button (for existing codes)
joinExistingRoomButton.addEventListener('click', () => {
    const roomCodeToJoin = enterRoomCodeInput.value.trim().toUpperCase(); // Get and clean the input code
    if (roomCodeToJoin) {
        appendMessage({ type: 'system', text: `Attempting to join room: ${roomCodeToJoin}...` });
        socket.emit('joinRoomByCode', roomCodeToJoin); // Emit event to server to join room
        currentRoomCode = roomCodeToJoin; // Optimistically update client's current room
        messageInput.disabled = false; // Enable message input
        messageInput.placeholder = `Type your message in room ${currentRoomCode}...`;
        enterRoomCodeInput.value = ''; // Clear the input field after attempting to join
    } else {
        alert('Please enter a room code.');
    }
});


// Message form submission handler
messageForm.addEventListener('submit', (e) => {
    e.preventDefault(); // Prevent default browser form submission

    const message = messageInput.value.trim(); // Get and clean the message text

    // Check if there's a message and the user is in a room
    if (message && currentRoomCode) {
        // Emit the chat message to the server, including the current room code
        socket.emit('chatMessage', { roomCode: currentRoomCode, message: message });
        // Immediately append the message to the local chat display.
        // This provides instant feedback to the user. The server will broadcast
        // this message back, but our `socket.on('message')` handler will prevent
        // duplicating it.
        appendMessage({ username: currentUsername, text: message, timestamp: new Date().toLocaleTimeString() });
        messageInput.value = ''; // Clear the message input field
    } else if (!currentRoomCode) {
        // Warn user if they try to send a message without being in a room
        alert('Please join or generate a room first to send messages.');
    }
});

// --- Socket.IO Event Handlers (Receiving Events from Server) ---

// Listener for all incoming 'message' events from the server
socket.on('message', (msg) => {
    // This is the core logic to prevent message duplication:
    // Only append the message if it's a system message OR if it's a message
    // from *another* user. Messages from the current user are already appended
    // locally when sent (`messageForm` submit handler).
    if (msg.type === 'system' || msg.username !== currentUsername) {
        appendMessage(msg);
    }
});

// Listener for 'connect' event (when socket successfully connects to server)
socket.on('connect', () => {
    // console.log('Connected to Socket.IO server as:', socket.id);
    // You could potentially try to rejoin the last active room here if needed,
    // but for simplicity, we rely on user actions after page load.
});

// Listener for 'disconnect' event (when socket loses connection to server)
socket.on('disconnect', () => {
    // console.log('Disconnected from Socket.IO server.');
    appendMessage({ type: 'system', text: 'Disconnected from chat server.' });
    currentRoomCode = null; // Reset current room state
    messageInput.disabled = true; // Disable chat input
    messageInput.placeholder = 'Disconnected. Refresh or rejoin.';
    generatedCodeDisplay.style.display = 'none'; // Hide generated code display
});

// Listener for 'connect_error' event (when socket fails to connect)
socket.on('connect_error', (err) => {
    console.error('Socket.IO connection error:', err);
    appendMessage({ type: 'system', text: 'Connection error. Please check server status.' });
    messageInput.disabled = true;
    messageInput.placeholder = 'Connection error.';
});
