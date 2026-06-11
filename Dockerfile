# Stage 1: Build the Angular application
FROM node:20 AS angular-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration=production

# Stage 2: Serve Python Backend and static Angular files using Nginx
FROM python:3.10-slim

# Install system dependencies (including Nginx)
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy python dependencies and install them
COPY python-ai/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python backend code
COPY python-ai/ /app/python-ai/

# Copy built Angular files to Nginx default html directory
COPY --from=angular-builder /app/dist/dev-helper/browser /var/www/html

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Setup start script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 4201

ENTRYPOINT ["/app/entrypoint.sh"]
