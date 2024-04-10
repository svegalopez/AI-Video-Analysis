#!/bin/bash

# Navigate to backend directory and start the server
cd backend && npm start &

# Navigate to client directory and start the vite app
cd ../client && npm run dev &

# Wait for any process to exit
wait

# Kill all child processes
trap "exit" INT TERM ERR
trap "kill 0" EXIT
