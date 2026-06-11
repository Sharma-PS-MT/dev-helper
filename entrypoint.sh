#!/bin/bash

# Start the Python FastAPI backend in the background
echo "Starting FastAPI backend..."
cd /app/python-ai
uvicorn main:app --host 0.0.0.0 --port 8000 &

# Start Nginx in the foreground
echo "Starting Nginx server on port 4201..."
nginx -g "daemon off;"
