// public/auth.js

document.addEventListener('DOMContentLoaded', () => {
    // Get references to the login and registration forms and their message display areas
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginMessageDiv = document.getElementById('loginMessage');
    const registerMessageDiv = document.getElementById('registerMessage');

    /**
     * Displays a message to the user in a specified message box.
     * @param {HTMLElement} element - The DOM element (div) to display the message in.
     * @param {string} message - The text message to display.
     * @param {'error' | 'success'} type - The type of message (determines styling).
     */
    function showMessage(element, message, type) {
        element.textContent = message; // Set the message text
        element.className = `message-box ${type}`; // Apply CSS classes for styling (e.g., 'error' or 'success')
        element.style.display = 'block'; // Make the message box visible
    }

    // --- Login Form Handling ---
    if (loginForm) { // Check if the login form exists on the current page
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault(); // Prevent default form submission (page reload)

            // Get username and password from the form inputs
            const username = loginForm.loginUsername.value;
            const password = loginForm.loginPassword.value;

            try {
                // Send a POST request to the '/login' endpoint
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json', // Indicate that the request body is JSON
                    },
                    body: JSON.stringify({ username, password }), // Send username and password as JSON
                });

                const data = await response.json(); // Parse the JSON response from the server

                if (response.ok) {
                    // If login is successful (HTTP 200 OK)
                    showMessage(loginMessageDiv, data.message, 'success');
                    // Redirect to the chat page as indicated by the server response
                    if (data.redirectUrl) {
                        window.location.href = data.redirectUrl;
                    }
                } else {
                    // If login fails (e.g., 401 Unauthorized, 400 Bad Request)
                    showMessage(loginMessageDiv, data.message || 'Login failed.', 'error');
                }
            } catch (error) {
                // Handle network errors or issues with the fetch request
                console.error('Login error:', error);
                showMessage(loginMessageDiv, 'Network error. Please try again.', 'error');
            }
        });
    }

    // --- Register Form Handling ---
    if (registerForm) { // Check if the registration form exists on the current page
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault(); // Prevent default form submission (page reload)

            // Get username and password from the form inputs
            const username = registerForm.registerUsername.value;
            const password = registerForm.registerPassword.value;

            try {
                // Send a POST request to the '/register' endpoint
                const response = await fetch('/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json', // Indicate that the request body is JSON
                    },
                    body: JSON.stringify({ username, password }), // Send username and password as JSON
                });

                const data = await response.json(); // Parse the JSON response from the server

                if (response.ok) {
                    // If registration is successful (HTTP 201 Created)
                    showMessage(registerMessageDiv, data.message, 'success');
                    // Redirect to the login page after a short delay
                    setTimeout(() => {
                        window.location.href = '/login.html';
                    }, 2000); // Redirect after 2 seconds
                } else {
                    // If registration fails (e.g., 409 Conflict, 400 Bad Request)
                    showMessage(registerMessageDiv, data.message || 'Registration failed.', 'error');
                }
            } catch (error) {
                // Handle network errors or issues with the fetch request
                console.error('Registration error:', error);
                showMessage(registerMessageDiv, 'Network error. Please try again.', 'error');
            }
        });
    }
});
